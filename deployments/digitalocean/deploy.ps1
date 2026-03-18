param(
  [string]$ConfigPath = "$(Split-Path -Parent $MyInvocation.MyCommand.Definition)\.env.deploy"
)

$ErrorActionPreference = 'Stop'

function Write-Info($message) {
  Write-Host "[INFO] $message" -ForegroundColor Cyan
}

function Write-Warn($message) {
  Write-Host "[WARN] $message" -ForegroundColor Yellow
}

function Load-Config($path) {
  $config = @{}
  if (Test-Path $path) {
    Write-Info "Loading configuration from $path"
    Get-Content $path | ForEach-Object {
      if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
      $pair = $_ -split '=', 2
      if ($pair.Length -eq 2) {
        $key = $pair[0].Trim()
        $value = $pair[1].Trim()
        $config[$key] = $value
      }
    }
  } else {
    Write-Warn "Config file $path not found. Falling back to environment variables."
  }
  return $config
}

function Get-Setting($config, $key, $default = $null, [switch]$Required) {
  if ($config.ContainsKey($key)) {
    return $config[$key]
  }
  $value = [Environment]::GetEnvironmentVariable($key)
  if ($value) {
    return $value
  }
  if ($null -ne $default) {
    return $default
  }
  if ($Required) {
    throw "Missing required setting '$key'. Add it to the config file or set it as an environment variable."
  }
  return $null
}

function Ensure-Doctl {
  $command = Get-Command doctl -ErrorAction SilentlyContinue
  if ($command) {
    Write-Info "Found existing doctl at $($command.Source)"
    return $command.Source
  }

  Write-Info "doctl not found. Downloading the CLI..."
  $version = '1.111.0'
  $downloadUrl = "https://github.com/digitalocean/doctl/releases/download/v$version/doctl-$version-windows-amd64.zip"
  $binDir = Join-Path $PSScriptRoot 'bin'
  if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir | Out-Null
  }
  $zipPath = Join-Path $binDir 'doctl.zip'

  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $binDir -Force
  Remove-Item $zipPath

  $doctlPath = Join-Path $binDir 'doctl.exe'
  if (-not (Test-Path $doctlPath)) {
    throw "Failed to extract doctl from $downloadUrl"
  }

  Write-Info "doctl downloaded to $doctlPath"
  $env:PATH = "$binDir;$env:PATH"
  return $doctlPath
}

function New-SpecFile($templatePath, $outputPath, $replacements) {
  if (-not (Test-Path $templatePath)) {
    throw "Spec template not found at $templatePath"
  }
  $content = Get-Content $templatePath -Raw
  foreach ($key in $replacements.Keys) {
    $content = $content.Replace($key, $replacements[$key])
  }
  Set-Content -Path $outputPath -Value $content -Encoding UTF8
  Write-Info "Generated spec file at $outputPath"
}

# -----------------------------------------------------------------------------
# Main flow
# -----------------------------------------------------------------------------

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$config = Load-Config $ConfigPath

# Optional: if Supabase not in .env.deploy, try project .env or scanner-app/.env
$supabaseUrl = Get-Setting $config 'VITE_SUPABASE_URL' $null
$supabaseAnonKey = Get-Setting $config 'VITE_SUPABASE_ANON_KEY' $null
if (-not $supabaseUrl -or -not $supabaseAnonKey) {
  foreach ($envPath in @((Join-Path $repoRoot '.env'), (Join-Path $repoRoot 'scanner-app\.env'))) {
    if (Test-Path $envPath) {
      $envConfig = Load-Config $envPath
      if (-not $supabaseUrl) { $supabaseUrl = Get-Setting $envConfig 'VITE_SUPABASE_URL' $null }
      if (-not $supabaseAnonKey) { $supabaseAnonKey = Get-Setting $envConfig 'VITE_SUPABASE_ANON_KEY' $null }
      if ($supabaseUrl -and $supabaseAnonKey) {
        Write-Info "Using Supabase URL/key from $envPath"
        break
      }
    }
  }
}

if (-not $supabaseUrl -or -not $supabaseAnonKey) {
  throw "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to deployments/digitalocean/.env.deploy or to your project .env / scanner-app/.env"
}
$doAccessToken = Get-Setting $config 'DO_ACCESS_TOKEN' $null -Required
$aftershipKey = Get-Setting $config 'VITE_AFTERSHIP_API_KEY' ''
$metabaseSiteUrl = Get-Setting $config 'VITE_METABASE_SITE_URL' $null
$metabaseSecretKey = Get-Setting $config 'VITE_METABASE_SECRET_KEY' $null
$metabaseQuestionId = Get-Setting $config 'VITE_METABASE_QUESTION_ID' $null
$appName = Get-Setting $config 'DO_APP_NAME' 'cursor-test-project-app'
$region = Get-Setting $config 'DO_REGION' 'nyc'
$githubRepo = Get-Setting $config 'DO_GITHUB_REPO' 'Paeddle/CursorTestProjectApp'
$githubBranch = Get-Setting $config 'DO_GITHUB_BRANCH' 'main'

$env:DIGITALOCEAN_ACCESS_TOKEN = $doAccessToken

$doctlPath = Ensure-Doctl

Write-Info "Installing dependencies (npm install)"
npm install | Out-Null

Write-Info "Running build (npm run build)"
npm run build | Out-Null

$specTemplate = Join-Path $PSScriptRoot 'digitalocean-app-spec.template.yaml'
$specGenerated = Join-Path $PSScriptRoot 'digitalocean-app-spec.generated.yaml'

$replacements = @{
  '__APP_NAME__' = $appName
  '__REGION__' = $region
  '__VITE_AFTERSHIP_API_KEY__' = $aftershipKey
  '__VITE_SUPABASE_URL__' = $supabaseUrl
  '__VITE_SUPABASE_ANON_KEY__' = $supabaseAnonKey
  '__VITE_METABASE_SITE_URL__' = if ($metabaseSiteUrl) { $metabaseSiteUrl } else { '' }
  '__VITE_METABASE_SECRET_KEY__' = if ($metabaseSecretKey) { $metabaseSecretKey } else { '' }
  '__VITE_METABASE_QUESTION_ID__' = if ($metabaseQuestionId) { $metabaseQuestionId } else { '' }
  '__GITHUB_REPO__' = $githubRepo
  '__GITHUB_BRANCH__' = $githubBranch
}

New-SpecFile -templatePath $specTemplate -outputPath $specGenerated -replacements $replacements

$appIdFile = Join-Path $PSScriptRoot '.do-app-id'

if (Test-Path $appIdFile) {
  $appId = (Get-Content $appIdFile | Select-Object -First 1).Trim()
  if (-not $appId) {
    Remove-Item $appIdFile
    throw "Stored app ID is empty. Delete $appIdFile and rerun the script."
  }
  Write-Info "Updating existing DigitalOcean App ($appId)"
  & $doctlPath apps update $appId --spec $specGenerated | Out-Null
  Write-Info "Creating new deployment to use latest commit..."
  & $doctlPath apps create-deployment $appId --force-rebuild | Out-Null
} else {
  Write-Info "Creating new DigitalOcean App ($appName in $region)"
  $createOut = & $doctlPath apps create --spec $specGenerated --format ID --no-header 2>&1
  $appId = if ($createOut) { $createOut.ToString().Trim() } else { $null }
  if (-not $appId) {
    throw "Failed to create DigitalOcean App. Add DO_ACCESS_TOKEN to deployments/digitalocean/.env.deploy (get one at https://cloud.digitalocean.com/account/api/tokens) and run this script again."
  }
  Set-Content -Path $appIdFile -Value $appId
  Write-Info "Created App with ID $appId (stored in $appIdFile)"
}

Write-Info "Waiting for deployment to finish..."
& $doctlPath apps wait $appId | Out-Null

$defaultIngress = (& $doctlPath apps get $appId --format DefaultIngress --no-header).Trim()
if ($defaultIngress) {
  Write-Info "Deployment complete. Live URL: https://$defaultIngress"
} else {
  Write-Warn "Deployment finished, but the live URL could not be retrieved. Check the DigitalOcean dashboard."
}

