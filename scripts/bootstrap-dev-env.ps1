# Bootstrap a fresh machine/checkout for this repo.
#
# Automates what a 2026-08-04 cold-start session did by hand: neither pnpm
# nor uv were on PATH, `pip install -e .[dev]` silently skipped pytest
# (fixed separately in backend/pyproject.toml), and the backend venv didn't
# exist yet. This script makes those steps repeatable instead of tribal
# knowledge. Safe to re-run -- every step is idempotent.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/bootstrap-dev-env.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Test-CommandExists([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# --- 1. Node / npm (hard prerequisite, not auto-installed) ---
Write-Step "Checking node/npm"
if (-not (Test-CommandExists node) -or -not (Test-CommandExists npm)) {
  Write-Host "FEHLER: node/npm nicht gefunden. Bitte Node.js zuerst installieren: https://nodejs.org/" -ForegroundColor Red
  exit 1
}
Write-Host "node $(node --version), npm $(npm --version)" -ForegroundColor Green

# --- 2. pnpm ---
Write-Step "Checking pnpm"
$pnpmVersion = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).packageManager -replace '^pnpm@', ''
if (Test-CommandExists pnpm) {
  Write-Host "pnpm bereits installiert: $(pnpm --version)" -ForegroundColor Green
} else {
  Write-Host "pnpm nicht gefunden, installiere pnpm@$pnpmVersion global..." -ForegroundColor Yellow
  npm install -g "pnpm@$pnpmVersion"
  if (-not (Test-CommandExists pnpm)) {
    Write-Host "WARNUNG: pnpm-Installation gemeldet, aber nicht im PATH. Nutze 'npx pnpm@$pnpmVersion' als Fallback fuer diese Session." -ForegroundColor Yellow
  }
}

# --- 3. Python (>=3.13 per backend/pyproject.toml) ---
Write-Step "Checking Python"
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
  Write-Host "FEHLER: python nicht im PATH gefunden. Bitte Python >=3.13 installieren: https://python.org/" -ForegroundColor Red
  exit 1
}
Write-Host "python: $python ($(& $python --version))" -ForegroundColor Green

# --- 4. uv ---
Write-Step "Checking uv"
if (Test-CommandExists uv) {
  Write-Host "uv bereits installiert: $(uv --version)" -ForegroundColor Green
} else {
  Write-Host "uv nicht im PATH, installiere via pip..." -ForegroundColor Yellow
  & $python -m pip install --quiet uv
  $pythonScripts = Join-Path (Split-Path -Parent $python) "Scripts"
  $uvExe = Join-Path $pythonScripts "uv.exe"
  if (Test-Path $uvExe) {
    Write-Host "uv installiert unter: $uvExe (nicht im PATH -- Scripts-Verzeichnis zum PATH hinzufuegen oder '$uvExe' direkt nutzen)" -ForegroundColor Yellow
  } else {
    Write-Host "WARNUNG: uv-Installation gemeldet, aber Binary nicht gefunden. Backend-Setup faellt auf pip zurueck." -ForegroundColor Yellow
  }
}

# --- 5. JS workspace deps ---
Write-Step "Installing JS workspace dependencies"
if (Test-CommandExists pnpm) {
  pnpm install
} else {
  npx --yes "pnpm@$pnpmVersion" install
}

# --- 6. Backend venv + deps ---
Write-Step "Setting up backend Python environment"
$backendVenvPython = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $backendVenvPython)) {
  Write-Host "Erstelle backend/.venv..." -ForegroundColor Yellow
  & $python -m venv (Join-Path $Root "backend\.venv")
}
$uvExeForSync = if (Test-CommandExists uv) { "uv" } else {
  $candidate = Join-Path (Split-Path -Parent $python) "Scripts\uv.exe"
  if (Test-Path $candidate) { $candidate } else { $null }
}
if ($uvExeForSync) {
  Write-Host "Nutze uv fuer backend-Sync..." -ForegroundColor Green
  Push-Location (Join-Path $Root "backend")
  & $uvExeForSync sync
  Pop-Location
} else {
  Write-Host "uv nicht verfuegbar, falle auf pip zurueck (deckt [project.optional-dependencies].dev ab)..." -ForegroundColor Yellow
  & $backendVenvPython -m pip install --quiet --upgrade pip
  & $backendVenvPython -m pip install --quiet -e (Join-Path $Root "backend") --config-settings editable_mode=compat 2>$null
  & $backendVenvPython -m pip install --quiet -e "$(Join-Path $Root 'backend')[dev]"
}

Write-Step "Bootstrap complete"
Write-Host "pnpm dev            -> App aus diesem Checkout starten (start-dev.ps1)" -ForegroundColor Green
Write-Host "pnpm ci:local:win   -> Vollen lokalen CI-Gate-Lauf ausfuehren" -ForegroundColor Green
