Write-Host '=== DBZS Codee Smoke-Test ===' -ForegroundColor Cyan

Write-Host '[1/5] Typecheck...' -ForegroundColor Yellow
pnpm typecheck
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL' -ForegroundColor Red; exit 1 }
Write-Host '  ✓ OK' -ForegroundColor Green

Write-Host '[2/5] Tests (Shared + Desktop)...' -ForegroundColor Yellow
pnpm --filter @dbzs/shared test
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL' -ForegroundColor Red; exit 1 }
pnpm --filter @dbzs/desktop test
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL' -ForegroundColor Red; exit 1 }
Write-Host '  ✓ OK' -ForegroundColor Green

Write-Host '[3/5] Build...' -ForegroundColor Yellow
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL' -ForegroundColor Red; exit 1 }
Write-Host '  ✓ OK' -ForegroundColor Green

Write-Host '[4/5] Backend Core Tests...' -ForegroundColor Yellow
Push-Location backend
uv run pytest tests/test_health.py tests/test_runtime_api.py tests/test_runtime_launch.py tests/test_model_profiles.py -v
Pop-Location
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL' -ForegroundColor Red; exit 1 }
Write-Host '  ✓ OK' -ForegroundColor Green

Write-Host '[5/5] Backend Doctor...' -ForegroundColor Yellow
pnpm doctor:backend
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL' -ForegroundColor Red; exit 1 }
Write-Host '  ✓ OK' -ForegroundColor Green

Write-Host ''
Write-Host '=== SMOKE-TEST PASSED ===' -ForegroundColor Green
Write-Host ''
Write-Host 'Ready for manual test:' -ForegroundColor Cyan
Write-Host '  1. pnpm dev' -ForegroundColor White
Write-Host '  2. Workspace öffnen' -ForegroundColor White
Write-Host '  3. Mission Control: Backend prüfen' -ForegroundColor White
Write-Host '  4. Runtime: Modell starten' -ForegroundColor White
Write-Host '  5. Runtime-Chat testen' -ForegroundColor White
Write-Host '  6. Job Monitor: Coder-Job enqueuen' -ForegroundColor White
