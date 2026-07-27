# TODO — Agent Workbench (3A–3G)

Verknüpfung: `DBZS_CODEE_CURSOR_IMPLEMENTATION_PACK_2026-06-20/`

## Phase 0 — Baseline & Tracking

- [x] Baseline-Gates (typecheck OK, build OK; 1 flaky desktop test pre-existing)
- [x] `docs/HANDOVER_AGENT_WORKBENCH.md`
- [x] `docs/TODO_AGENT_WORKBENCH.md`
- [x] Desktop-Runtime-Änderungen separat committen (`fa20e13`)
- Commit: `a50b40e`

## Phase 3A — Agent Run Backbone

- Prompt: `PROMPTS/01_PHASE_3A_AGENT_RUN_BACKBONE.md`
- [x] `backend/app/agent_workbench/` Backbone
- [x] Tabellen `agent_runs`, `agent_steps`
- [x] `tests/test_agent_workbench_backbone.py`
- Commit: `8384c72` (backend 3A–3G gebündelt)

## Phase 3B — Event Spine & Worker

- Prompt: `PROMPTS/02_PHASE_3B_EVENT_SPINE_WORKER.md`
- [x] `agent_events`, SSE, Worker, Demo-Run
- Gate: SSE-Reconnect-Test grün (10)

## Phase 3C — Context & Tools

- Prompt: `PROMPTS/03_PHASE_3C_CONTEXT_AND_TOOLS.md`
- [x] `agent_tool_calls`, Tool-Loop, Context Budget
- Gate: Tool-Persistenz + Sandbox (11)

## Phase 3D — Adapters & Host Actions

- Prompt: `PROMPTS/04_PHASE_3D_PROJECT_ADAPTERS_HOST_ACTIONS.md`
- [x] `project_adapters/`, `host_actions`, Desktop Executor
- Gate: 3 Adapter + Host round-trip (9)

## Phase 3E — Patch/Review/Test Loop

- Prompt: `PROMPTS/05_PHASE_3E_PATCH_REVIEW_TEST_LOOP.md`
- [x] Closed loop, Review Gates `run_id`/`step_id`, Auto-Apply deaktiviert
- Gate: E2E Patch-Loop (7)

## Phase 3F — Workbench UI

- Prompt: `PROMPTS/06_PHASE_3F_AGENT_WORKBENCH_UI.md`
- [x] Tab `agent-workbench`, SSE, Review Dock
- Commit: `898684b`

## Phase 3G — Follow-up & Hardening

- Prompt: `PROMPTS/07_PHASE_3G_FOLLOWUP_RESUME_HARDENING.md`
- [x] Follow-ups, Recovery, Tests
- [x] Daily-Use Acceptance automatisiert (`tests/test_agent_workbench_acceptance.py`: 3 Runs + Review-Recovery + Backend-Recovery)
- [ ] Daily-Use mit Electron + lokalem LLM (manuell)
- Gate: pytest acceptance grün (56 gesamt workbench); Electron manuell offen
