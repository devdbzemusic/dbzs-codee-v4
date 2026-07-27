# DBZS Code Assistant - Dev-Start (Direct Electron)
$node       = "C:\Users\ralle\AppData\Local\Zed\node\node-v24.11.0-win-x64\node.exe"
$backendDir = Join-Path $PSScriptRoot "backend"
$desktopDir = Join-Path $PSScriptRoot "apps\desktop"
$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"

function Test-BackendHealth {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8876/health" -UseBasicParsing -TimeoutSec 2
    return $response.Content -match '"status":"ok"'
  } catch { return $false }
}

if (!(Test-Path $backendPython)) { Write-Host "FEHLER: Backend Python nicht gefunden" -ForegroundColor Red; exit 1 }

Write-Host ">>> DBZS Backend starten..." -ForegroundColor Cyan
$backendHealthy = Test-BackendHealth
$forceRestart = $env:DBZS_RESTART_BACKEND -eq "1"
if ($backendHealthy -and -not $forceRestart) {
  # Stale backends without PATCH break the Settings Notebook (405).
  # Restart when OpenAPI lacks patch so start-dev stays usable after pulls.
  $hasPatch = $false
  try {
    $openapi = (Invoke-WebRequest -Uri "http://127.0.0.1:8876/openapi.json" -UseBasicParsing -TimeoutSec 2).Content | ConvertFrom-Json
    $hasPatch = $null -ne $openapi.paths.'/settings'.patch
  } catch { $hasPatch = $false }

  if ($hasPatch) {
    Write-Host ">>> Backend läuft bereits" -ForegroundColor Green
  } else {
    Write-Host ">>> Backend veraltet (kein PATCH /settings) — Neustart..." -ForegroundColor Yellow
    $forceRestart = $true
  }
}

if ($forceRestart -or -not $backendHealthy) {
  Get-NetTCPConnection -LocalPort 8876 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {}
    }
  Start-Sleep -Seconds 1
  Start-Process $backendPython -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8876" -WorkingDirectory $backendDir -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

Write-Host ">>> Warte auf Backend..." -ForegroundColor Yellow
for ($i = 0; $i -lt 60; $i++) {
  if (Test-BackendHealth) { break }
  Start-Sleep -Milliseconds 500
  Write-Host -NoNewline "."
}
Write-Host ""

Set-Location $desktopDir

# Build first
Write-Host ">>> Building..." -ForegroundColor Cyan
& $node "node_modules/electron-vite/bin/electron-vite.js" build

# Find electron binary
$electronPath = Get-ChildItem -Path (Join-Path $PSScriptRoot "node_modules") -Filter "electron.exe" -Recurse -File | Select-Object -First 1 -ExpandProperty FullName

if ($electronPath) {
  Write-Host ">>> Starte Electron mit: $electronPath" -ForegroundColor Green
  Start-Process $electronPath -ArgumentList "out/main/main.js" -WorkingDirectory $desktopDir
} else {
  Write-Host ">>> Electron Binary nicht gefunden, starte mit npx..." -ForegroundColor Yellow
  & npx electron "out/main/main.js"
}