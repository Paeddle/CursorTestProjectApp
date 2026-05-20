# Run the DYMO print agent from repo root (double-click or: powershell -File scripts/run-print-agent.ps1)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path 'package.json')) {
  Write-Host 'Error: Run this from the Order Tracker project root (folder with package.json).' -ForegroundColor Red
  exit 1
}

Write-Host "Project: $root" -ForegroundColor Cyan
Write-Host 'Starting print agent (npm run print-agent)...' -ForegroundColor Cyan
Write-Host 'Leave this window open. Queue labels from PO Info on your tablet.' -ForegroundColor Gray
Write-Host ''

npm run print-agent
