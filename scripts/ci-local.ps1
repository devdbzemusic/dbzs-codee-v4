# Local mirror of .github/workflows/ci.yml → job: required-gates (Windows)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step([int]$n, [string]$label) {
  Write-Host ""
  Write-Host "=== [$n] $label ===" -ForegroundColor Cyan
}

function Run([string]$label, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) {
    throw "$label failed (exit $LASTEXITCODE)"
  }
}

Step 1 "Install dependencies"
Run "pnpm install" { pnpm install --frozen-lockfile }

Step 2 "Sync backend environment"
Run "uv sync" { Push-Location backend; uv sync --frozen; Pop-Location }

Step 3 "Typecheck"
Run "typecheck" { pnpm typecheck }

Step 4 "Check versions"
Run "check:version" { pnpm check:version }

Step 5 "Shared + desktop tests"
Run "shared tests" { pnpm --filter @dbzs/shared test }
Run "desktop tests" { pnpm --filter @dbzs/desktop test }

Step 6 "Capability suite"
$env:RUN_CAPABILITY_SUITE = "1"
Run "capability suite" { pnpm --filter @dbzs/desktop test:capabilities }
Remove-Item Env:RUN_CAPABILITY_SUITE -ErrorAction SilentlyContinue

Step 7 "Backend tests"
Run "backend pytest" { Push-Location backend; uv run pytest -q; Pop-Location }

Step 8 "Build"
Run "build" { pnpm build }

Step 9 "Packaging smoke"
Run "smoke:packaging" { pnpm smoke:packaging }

Step 10 "Security regression tests"
Run "security tests" {
  pnpm --filter @dbzs/desktop exec vitest run electron/workspacePathGuard.test.ts electron/commandExecutionService.test.ts
}

Step 11 "Backend smoke"
Run "smoke:backend" { pnpm smoke:backend }

Step 12 "Backend doctor"
Run "doctor:backend" { pnpm doctor:backend }

Step 13 "Dependency audit"
Run "audit" { pnpm audit --prod --audit-level moderate }

Step 14 "Docs drift check (warn-only)"
# Non-strict by design (see scripts/check-docs-drift.mjs) -- surfaces "Stand:"-
# date drift across README.md/TODO.md/HANDOVER.md/docs/STATUS_TODAY.md in
# every local CI run instead of only when someone remembers to run it
# manually, without blocking the gate on doc staleness alone.
node scripts/check-docs-drift.mjs

Write-Host ""
Write-Host "=== CI LOCAL (required-gates) PASSED ===" -ForegroundColor Green
