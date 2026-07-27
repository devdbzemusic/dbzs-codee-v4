# Coding Assistant Test Workspace

Mini-Projekt fuer automatische Capability-Tests des DBZS Coding Assistants.

## Struktur

- `src/calculator.ts` — einfache Mathe-Funktionen (absichtlicher Bug in `subtract`)
- `src/greet.ts` — String-Hilfsfunktion
- `src/utils/format.ts` — Formatierung
- `src/calculator.test.ts` — Vitest-Tests fuer Calculator
- `scenarios.json` — zentraler Use-Case-Katalog (Vitest, E2E, Live, Backend)

## Use Cases (scenarios.json)

| ID | Kategorie | Layer |
|----|-----------|-------|
| `explain-bug` | Analyse | vitest, e2e, live |
| `fix-subtract` | Patch | vitest, e2e |
| `add-multiply` | Patch | vitest, e2e |
| `refactor-greet` | Patch | vitest |
| `list-files` | Tools | vitest, e2e |
| `run-tests` | Policy | vitest, live |
| `preset-plan` | Agent | vitest, e2e |
| `explain-divide-edge` | Analyse | vitest, e2e, live |
| `preset-debug` / `preset-implement` / `preset-docs` / `preset-scan` | Agent-Skills | vitest, e2e |
| `multi-file-patch` | Patch (2 Dateien) | vitest, e2e |
| `add-multiply-test` | Test-Patch | vitest |
| `read-greet` | Tools | vitest |
| `policy-git-status` / `policy-pipe-shell-forbidden` / `policy-destructive-del-prompt` | Exec-Policy | vitest |
| `chat-empty-blocked` | Chat-Guard | vitest |

Vollstaendige Liste: `scenarios.json`

## Tests ausfuehren

```bash
# Capability Suite (deterministisch, mocked LLM) — auch in CI required-gates
RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities

# Vollstaendiges lokales CI (= GitHub required-gates)
pnpm ci:local          # Linux/macOS
# pnpm ci:local:win    # Windows

# Integration inkl. Backend-Capability-Tests
pnpm test:capabilities

# E2E Renderer (Playwright + Test-Bridge)
pnpm test:capabilities:e2e

# Alles inkl. E2E
pnpm test:capabilities:all

# Live-Runtime (echtes Modell, Backend auf :8876, Runtime running)
$env:DBZS_LIVE_RUNTIME="1"
pnpm test:capabilities:live

# Report nach test-results/capability-report.txt
RUN_CAPABILITY_SUITE=1 CAPABILITY_REPORT=1 pnpm --filter @dbzs/desktop test:capabilities
```

Bei fehlgeschlagenen Live- oder Capability-Tests: `test-results/*-capability-report.txt` enthaelt Improvement-Backlog.
