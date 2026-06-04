# Deploy inventory-image-import Edge Function to Supabase.
# Prerequisite: supabase login  OR  set SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$projectRef = 'bunxqkvirdultswdrhnx'
$envPath = Join-Path $repoRoot '.env'
if (Test-Path $envPath) {
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*VITE_SUPABASE_URL\s*=\s*(.+)') {
      $url = $Matches[1].Trim().Trim('"')
      if ($url -match 'https://([a-z0-9]+)\.supabase\.co') {
        $projectRef = $Matches[1]
      }
    }
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host 'Missing SUPABASE_ACCESS_TOKEN. Run: supabase login' -ForegroundColor Yellow
  Write-Host 'Or: $env:SUPABASE_ACCESS_TOKEN = "sbp_..."  then rerun this script.' -ForegroundColor Yellow
  exit 1
}

Write-Host "Deploying inventory-image-import to project $projectRef ..."
npx supabase functions deploy inventory-image-import --project-ref $projectRef
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Done.' -ForegroundColor Green
