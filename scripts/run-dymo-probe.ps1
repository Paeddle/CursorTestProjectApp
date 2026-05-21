# Probe DYMO paper templates from repo root (double-click or: powershell -File scripts/run-dymo-probe.ps1)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path 'package.json')) {
  Write-Host 'Error: Run this from the Order Tracker project root (folder with package.json).' -ForegroundColor Red
  exit 1
}

Write-Host "Project: $root" -ForegroundColor Cyan
Write-Host 'Probing DYMO Connect (npm run dymo-probe)...' -ForegroundColor Cyan
Write-Host ''

npm run dymo-probe
