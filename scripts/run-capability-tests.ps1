param(
  [switch]$SkipE2E,
  [switch]$SkipBackend,
  [switch]$ReportOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=== DBZS Coding Assistant Capability Tests ===" -ForegroundColor Cyan
Write-Host "Fixture: fixtures/coding-assistant-workspace" -ForegroundColor DarkGray

Write-Host "`n[1/3] Desktop integration (Vitest)..." -ForegroundColor Yellow
pnpm --filter @dbzs/desktop test:capabilities
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipBackend) {
  Write-Host "`n[2/3] Backend scenarios (pytest)..." -ForegroundColor Yellow
  Push-Location backend
  uv run pytest tests/test_coding_assistant_capabilities.py tests/test_coding_assistant_scenarios.py -q
  $backendExit = $LASTEXITCODE
  Pop-Location
  if ($backendExit -ne 0) { exit $backendExit }
} else {
  Write-Host "`n[2/3] Backend skipped (-SkipBackend)" -ForegroundColor DarkGray
}

if (-not $SkipE2E) {
  Write-Host "`n[3/3] E2E (Playwright)..." -ForegroundColor Yellow
  pnpm --filter @dbzs/desktop e2e e2e/runtime-chat.spec.ts e2e/coding-assistant.spec.ts e2e/agent-capabilities.spec.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "`n[3/3] E2E skipped (-SkipE2E)" -ForegroundColor DarkGray
}

Write-Host "`nAll capability tests passed." -ForegroundColor Green
