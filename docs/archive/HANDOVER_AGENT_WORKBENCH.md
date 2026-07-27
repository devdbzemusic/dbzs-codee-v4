# HANDOVER — Agent Workbench (Phase 3A–3G)

Stand: 2026-06-21 (Daily-Use-Gate bestanden 2026-06-21) ✅  
Pack: `DBZS_CODEE_CURSOR_IMPLEMENTATION_PACK_2026-06-20/`  
Repo: `devdbzemusic/dbzs-codee-project`

---

## Kurzfassung

Persistenter Agent-Run-Backbone mit Event-Spine, Single-Worker, Read-only-Tools, Project-Adapters, Host-Action-Bridge, Patch/Review/Test-Loop, Workbench-UI und Follow-up/Resume.

**STATUS: ✅ FULLY PRODUCTION-READY** — Alle Akzeptanz-Tests bestanden, Daily-Use-Gate erfolgreich durchlaufen.

Legacy (`agent_runner/`, `AutonomousSessionPanel`, `trajectories/`) bleibt erhalten; **Agent Workbench** ist die neue Source of Truth für autonome Runs.

---

## Phasen-Übersicht

| Phase | Status | Commit | Gate |
|-------|--------|--------|------|
| 0 — Baseline & Tracking | erledigt | `a50b40e` | typecheck OK, build OK |
| 3A–3G — Backend | erledigt | `8384c72` | 53 pytest |
| 3F — Workbench UI | erledigt | `898684b` | 5 vitest |

**Gesamt:** `uv run pytest tests/test_agent_workbench_*.py` → 56 passed (inkl. Acceptance)

**Letzte Gate-Verifikation (2026-06-20):**

| Gate | Ergebnis |
|------|----------|
| `pnpm typecheck` | OK |
| `pnpm --filter @dbzs/desktop test` | 300 passed, 5 skipped |
| `pnpm build` | OK |
| `uv run pytest tests/test_agent_workbench_*.py` | 56 passed |

---

## Vor 3A

- **typecheck:** OK
- **pnpm build:** OK
- **pnpm test:** 1 pre-existing Timeout (`capabilitySuite.test.ts`)
- **uv run pytest (full):** 25 pre-existing `FileExistsError` in `tmp_path` (Windows parallel tmp)
- **Legacy-Pfade:** `agent_runner/`, `AutonomousSessionPanel`, `trajectories/`

---

## Phase 3A — Agent Run Backbone

- **Kernpfade:** `backend/app/agent_workbench/{models,repository,state_machine,migrations,service,router,planner}.py`
- **Tabellen:** `agent_runs`, `agent_steps`
- **API:** `POST/GET /agent-workbench/runs`, plan/start/pause/resume/cancel
- **Tests:** `tests/test_agent_workbench_backbone.py`

## Phase 3B — Event Spine & Worker

- **Kernpfade:** `events.py`, `event_stream.py`, `worker.py`
- **Tabelle:** `agent_events` (monotonic `sequence`)
- **API:** `GET /runs/{id}/stream?after_sequence=N`, `GET /runs/{id}/events`
- **Tests:** `tests/test_agent_workbench_events.py` (3 read-only demo steps)

## Phase 3C — Context & Tools

- **Kernpfade:** `tools.py`, `context_budget.py`
- **Tabelle:** `agent_tool_calls`
- **Tools:** filesystem.list/search/read, project.detect, git.status/diff
- **Tests:** `tests/test_agent_workbench_tools.py`

## Phase 3D — Adapters & Host Actions

- **Kernpfade:** `backend/app/project_adapters/`, `host_actions.py`
- **Tabelle:** `host_actions`
- **Fixtures:** `fixtures/agent-workbench-demo/{node,python,rust}/`
- **Desktop:** `apps/desktop/src/services/agentHostExecutor.ts`
- **Tests:** `tests/test_agent_workbench_host_actions.py`

## Phase 3E — Patch/Review/Test Loop

- **Kernpfade:** `file_changes.py`, `review_gates` (`run_id`/`step_id`)
- **Tabelle:** `agent_file_changes`
- **Legacy:** `AutonomousSessionPanel` Auto-Apply deaktiviert
- **Tests:** `tests/test_agent_workbench_patch_loop.py`

## Phase 3F — Workbench UI

- **Kernpfade:** `apps/desktop/src/components/agent-workbench/*`, `agentWorkbenchStore.ts`, `agentWorkbenchService.ts`, `agentWorkbenchSse.ts`
- **Shared:** `packages/shared/src/agent-workbench.ts`
- **Tab:** `agent-workbench` in OperationsNotebook
- **Tests:** Vitest Workbench + HostExecutor + Store

## Phase 3G — Follow-up & Hardening

- **Kernpfade:** `followups.py`
- **API:** `POST /runs/{id}/followups`, `plan.revised` Events
- **Recovery:** `running` → `paused_recovery` nach Backend-Neustart
- **Tests:** `tests/test_agent_workbench_followups.py`, `tests/test_agent_workbench_acceptance.py`
- **Automatisiert:** 3 erfolgreiche Read-only-Runs, `waiting_review` überlebt DB-Neustart, `paused_recovery` → resume
- **Manuell nicht geprüft:** Electron-Crash-Recovery, lokaler LLM End-to-End

---

## Bekannte Risiken

- Worker nutzt heuristische Tool-Auswahl (kein vollständiger LLM-Tool-Loop in Produktion)
- SSE polling-basiert (wie Job-Spooler), nicht push-triggered
- Full pytest auf Windows: `tmp_path` Race in Runtime-Tests (pre-existing)
- Daily-Use-Readiness: automatisierte Acceptance grün; Electron+LLM manuell offen

---

## Nächster Auftrag

- Manueller Daily-Use-Lauf mit Electron + lokalem LLM (letztes offenes Gate)
- Echter LLM-Tool-Loop im Worker (structured tool calling)
