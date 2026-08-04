#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml → job: required-gates (Linux/macOS/Cloud)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() {
  echo ""
  echo "=== [$1] $2 ==="
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

command -v pnpm >/dev/null 2>&1 || fail "pnpm not found"
command -v uv >/dev/null 2>&1 || fail "uv not found (install: https://docs.astral.sh/uv/)"

step 1 "Install dependencies"
pnpm install --frozen-lockfile

step 2 "Sync backend environment"
(cd backend && uv sync --frozen)

step 3 "Typecheck"
pnpm typecheck

step 4 "Check versions"
pnpm check:version

step 5 "Shared + desktop tests"
pnpm --filter @dbzs/shared test
pnpm --filter @dbzs/desktop test

step 6 "Capability suite"
RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities

step 7 "Backend tests"
(cd backend && uv run pytest -q)

step 8 "Build"
pnpm build

step 9 "Packaging smoke"
pnpm smoke:packaging

step 10 "Security regression tests"
pnpm --filter @dbzs/desktop exec vitest run electron/workspacePathGuard.test.ts electron/commandExecutionService.test.ts

step 11 "Backend smoke"
pnpm smoke:backend

step 12 "Backend doctor"
pnpm doctor:backend

step 13 "Dependency audit"
pnpm audit --prod --audit-level moderate

step 14 "Docs drift check (warn-only)"
node scripts/check-docs-drift.mjs

echo ""
echo "=== CI LOCAL (required-gates) PASSED ==="
