# DBZS Codee Status Matrix

Stand: 2026-07-23

Erlaubte Statuswerte: `REAL`, `PARTIAL`, `MOCK`, `BLOCKED`, `DEPRECATED`.

| Modul | Status | Implementierungsnachweis | Testnachweis | Bekannte Grenzen | Owner |
|-------|--------|--------------------------|--------------|------------------|-------|
| Desktop Shell | REAL | `apps/desktop/src`, Electron Main/Preload/Renderer getrennt | `pnpm --filter @dbzs/desktop test`, `pnpm build` | Playwright-E2E läuft grün, lokale Live-Abnahme bleibt optional | Desktop |
| Runtime Communication Spine | REAL | RequestId-Cancel, AbortController-Map, Streaming-Reader-Cancel | `pnpm test`, `pnpm smoke-test` | Live-Verhalten hängt vom gestarteten Modell ab | Runtime |
| Model Selection Broker | PARTIAL | Broker-Decision mit Slot, Modell, Fallback-Policy, Decision-Id | Broker-/Runtime-Tests, `pnpm typecheck` | Cloud-Routing ist kontrolliert, aber nicht als Default aktiv | Runtime |
| Runtime Fallback Policy | REAL | Request-Policy gewinnt über globale Default-Policy | `backend/tests/test_runtime_service.py` | `allow_cloud_fallback` ist Vertragswert; lokale Runtime entscheidet nicht heimlich cloud | Runtime |
| Context Pack / Repo Map | REAL | Deterministische Repo-Map mit Imports, Exports, Symbols, Tests, Configs | `backend/tests/test_context_pack.py` | Kein semantischer RAG-Index, bewusst kompakt | Context |
| Safe Patch Pipeline | REAL | Restore-Point, Preview, Safety-Limits, Review-Gate-Pflicht | `apps/desktop/electron/patchPipelineService.test.ts` | Multi-File-Apply bleibt über orchestrierende Dienste gruppiert | Desktop |
| Coding Loop Harness | REAL | `test-fixtures/coding-capability-project`, Offline-Repair-Loop | `pnpm test:coding-loop` | Simuliert deterministisch, kein Live-LLM-Gate | Agent |
| Desktop Capability Suite | REAL | `fixtures/coding-assistant-workspace`, `capabilityScenarios.ts` | `RUN_CAPABILITY_SUITE=1 pnpm --filter @dbzs/desktop test:capabilities` (30/30); CI + `pnpm ci:local` | Harness mockt Broker/Slots/Clarification; kein Live-LLM | Agent |
| Agent Runner | REAL | Backend Runner, Job-Spooler, Patch-Artefakte | `backend/tests/test_agent_runner*.py`, `pnpm test` | Qualität live abhängig vom Modell | Agent |
| Agent Workbench | PARTIAL | Persistente Runs, Tools, Host Actions, Review/Test-Loop | Backend + Desktop Unit Tests | Live-Langläufe und UI-E2E separat abnehmen | Agent |
| Review Gates | REAL | Backend-API, Desktop-Service/UI | `backend/tests/test_review_gates.py`, Desktop Tests | UX hängt von aktiver Workbench-Ansicht ab | Agent |
| Runtime Slot Management | PARTIAL | Slot-Services und UI | Runtime- und Desktop-Tests | Hardware- und Modellpfade lokal unterschiedlich | Runtime |
| Cloud Providers | PARTIAL | Provider-Abstraktion für OpenAI/Anthropic | Unit-/Service-Tests | Erfordert gültige lokale Secrets, keine Secrets im Repo | Runtime |
| Security Hardening | PARTIAL | Workspace-Path-Guard und Secret-Redaction erweitert | `pnpm --filter @dbzs/desktop exec vitest run apps/desktop/electron/workspacePathGuard.test.ts`, `uv run pytest tests/test_workspace_paths.py tests/test_secret_redaction.py -q` | Vollständige Pfad-/Symlink-Matrix und Terminal-Policy bleiben offen | Security |

Keine `Production Ready`-Aussage ist gültig, wenn die dazugehörigen automatisierten und manuellen Gates nicht mit Datum dokumentiert sind.

# RC-Hardening-Hinweis

Context Intelligence: **PARTIAL — Release Candidate Hardening**. Context Contracts,
Orchestrator, Retrieval Trace, inkrementeller Index, Tokenbudget und Resume-
Revalidierung sind vorhanden. Semantische Utility-Pipeline, vollständige Fixtures,
Diagnostics Panel und Certification Harness bleiben offen. Details stehen in
`docs/audits/CODEE_75_POINT_READINESS_REPORT.md`.
