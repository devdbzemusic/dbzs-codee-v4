# Settings Inventory & Contract Audit

**Repository:** `dbzs-codee-project`  
**Branch:** `feat/settings-notebook-and-settings-audit`  
**Base:** `main` (fast-forwarded)  
**Date:** 2026-07-23  
**Phase:** P0 notebook + audit UX complete on branch (awaiting commit)  
**Machine-readable:** [`settings-inventory.json`](./settings-inventory.json)

---

## Implementation status (2026-07-23)

Completed on `feat/settings-notebook-and-settings-audit`:

| Area | Status |
|------|--------|
| Shared ↔ backend field align (`conversationControlV2`, `legacyStructuredMarkupParser`, defaults) | Done |
| `schemaVersion` / `revision` / `updatedAt` | Done |
| Atomic save + corrupt backup | Done |
| `PATCH /settings` + revision conflict 409 | Done |
| `GET /settings/diagnostics` (secrets redacted) | Done |
| `settingsRegistry` + draft/source/validation | Done |
| Settings Notebook extracted from `App.tsx` | Done |
| Controlled Idle-Unload (0–240) via registry number + patch | Done |
| Slots/ports readonly (no free-text Literals) | Done |
| Import / Export (secrets redacted) + diff preview | Done |
| Reset field / tab / global + diff preview | Done |
| Idle-Unload live diagnostics strip (Runtime tab) | Done |
| Orphans demoted to `readonly` + Diagnose-Hinweis | Done |
| Backend tests `test_settings.py` | 9 passed |
| Desktop settings + transfer + idle diagnostics tests | 22 passed |
| Desktop `tsc` web | passed |

Still open / follow-ups:

- API-Keys: empfohlen über EnvVars (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`); Settings-Felder nur optionaler Override
- Optionally wire orphaned consumers later (`autoSave`, `terminalShell`, …) — currently demoted, not removed
- Full desktop E2E regression beyond unit coverage
- Commit only on explicit request

---

## Executive verdict

Settings today are a full-object PUT to `%LOCALAPPDATA%\DBZS\CodeAssistant\settings.json` (or `DBZS_APP_DATA_DIR`), edited almost entirely inside `App.tsx` (`SettingsPanel`). Roughly **one third of `AppSettings` keys have no UI**, several UI fields are **uncontrolled** or **literal-locked but look editable**, **~10 keys are orphaned** (persisted / shown but not consumed), and the **TS↔Python contract already diverges** (`conversationControlV2`, `legacyStructuredMarkupParser` missing on backend; defaults for `modelsPath` / `ollamaBaseUrl` / `defaultModelName` differ). Persistence has **no PATCH, no revision, no schemaVersion, no atomic write**.

All ten expected audit findings from the master prompt are **confirmed**.

---

## 1. Git / branch state

| Item | Value |
|------|-------|
| Working branch | `feat/settings-notebook-and-settings-audit` (created from updated `main`) |
| Persistence path | `<app-data-dir>/settings.json` |
| API | `GET /settings`, `PUT /settings` only |
| Settings UI | `apps/desktop/src/App.tsx` → `SettingsPanel` (~4 sections, not tabs) |

Unrelated dirty work from `fix/remediation-state-tool-protocol-budget` was stashed before branching.

---

## 2. Contract mismatches (blocking for notebook)

| Issue | Shared TS | Backend Python | Impact |
|-------|-----------|----------------|--------|
| `conversationControlV2` | present, default `true` | **missing** (`extra="forbid"`) | PUT with this key → 422 |
| `legacyStructuredMarkupParser` | present, default `false` | **missing** | same; also **orphaned** (no consumer) |
| `modelsPath` default | `D:\Models` | machine-specific repo `models/` path | first-run inconsistency |
| `ollamaBaseUrl` default | `http://127.0.0.1:11434` | `""` | silent drift |
| `defaultModelName` default | `"Default Model"` | `""` | display/fallback drift |
| `modelDiscoveryMode` fallback | AppSettings `project_local_strict` | `get_model_discovery_mode()` → `local_with_ollama` if missing | effective mode ≠ configured |

---

## 3. Persistence & overrides map

| Concern | Current state |
|---------|---------------|
| Path | `get_app_data_dir() / settings.json` |
| Atomic write | **No** — direct `write_text` |
| schemaVersion / revision | **None** in file; Zustand `settingsRevision` is client-only |
| PATCH | **Missing** — every save is full PUT |
| Secrets | `openaiApiKey` / `anthropicApiKey` plaintext in JSON |
| Env | `DBZS_APP_DATA_DIR`, `DBZS_MODELS_DIR`, `DBZS_OLLAMA_DIR`, `DBZS_OLLAMA_MODELS_DIR`, `OLLAMA_MODELS` |
| UI visibility of path/overrides | **None** |
| Hardcoded Ollama default | `G:/Ollama` in `config.py` when env unset |

---

## 4. UI exposure summary

| Category | Count (approx.) |
|----------|-----------------|
| Fully editable | ~38 |
| Display-only / partial | 3 (`defaultModelName`, `ragEnabled` status, `orchestratorRuntimeSlot`) |
| Missing from UI | ~21 |
| Uncontrolled `defaultValue` | 7 (idle-unload, slots/ports, orchestrator model/port) |
| Literal-locked but free text | `chatRuntimeSlot`, `codingRuntimeSlot` |

**Missing UI (user-relevant / advanced):**  
`safeCommandConfirmation`, `cloudModelsEnabled`, `preferLocalModels`, `localOnlyModels`, `localOnly`, `ollamaBaseUrl`, `anthropicApiKey`, `openaiApiKey`, `maxAutonomousSteps`, `maxDebugRetries`, `maxFailedTaskRetries`, `modelDiscoveryMode`, `contextSpoolerEnabled`, `hybridRetrievalEnabled`, `reasoningTraceEnabled`, token-budget ratios, `conversationControlV2`, `legacyStructuredMarkupParser`, `defaultModelId`, `telemetryEnabled` (hard invariant `false`).

**No:** import, export, reset-to-defaults, settings-path display, env-override badges, sticky dirty footer.

---

## 5. Consumer / orphan summary

### Orphaned or misleading (persist/UI without real effect)

| Key | Classification | Notes |
|-----|----------------|-------|
| `autoSave` | orphaned | Checkbox only |
| `terminalShell` | orphaned | Electron terminal hardcodes PowerShell |
| `agentExecutionEnabled` | orphaned | Never gates execution |
| `runtimeChatUseBroker` | orphaned | Broker always authoritative |
| `legacyStructuredMarkupParser` | orphaned + contract gap | No reader; not in Python |
| `chatRuntimeSlot` / `codingRuntimeSlot` / `orchestratorRuntimeSlot` | orphaned UI | Real slots from `runtime-slots.json` |
| `chatRuntimePort` / `codingRuntimePort` / `orchestratorRuntimePort` | orphaned UI | Ports from slot contract |
| `autoStartVisionRuntime` / `autoStartReviewRuntime` | orphaned | Not read by start logic |
| `ollamaBaseUrl` | orphaned (desktop) | Provider path never refreshed |
| `runtimeChatCanaryPercent` | partial | Labels only; no canary gating |

### Consumed but no / weak UI

| Key | Consumer | Restart |
|-----|----------|---------|
| `idleUnloadWorkModelsMinutes` | `lazyRuntimePolicy.ts` | none (should be immediate) |
| `safeCommandConfirmation` | `runtimeChatAgentRunner.ts` | next_run |
| `contextSpoolerEnabled`, RAG/hybrid/trace, token ratios, `conversationControlV2` | `runtimeChatStore.ts` | next_run |
| `maxAutonomousSteps` / debug / failed retries | `autonomousSessionService.ts` | next_run |
| `modelDiscoveryMode` | backend discovery | backend_restart / next discovery |
| API keys | `cloud_client.py` | next_run |

---

## 6. Hardcoding audit (P0.2) — highlights

| Topic | Value | Class | Action |
|-------|-------|-------|--------|
| First-token timeout | settings `timeoutFirstTokenSeconds` (default 90s) | **A** Runtime | Editable |
| Stream idle | settings `timeoutStreamIdleSeconds` (default 30s) | **A** Runtime | Editable |
| CPU-safe stream/first/generation | `timeoutCpuSafe*` (180/120/600s) | **A** Runtime | Editable; applied when gpuLayers=0 |
| Token reserve ratios | 0.22 / 0.07 / 0.05 | **A** | Expose (already settings) |
| Absolute output reserves | 512–1536 | **B** | Optional advanced later |
| Review batch 3–8 | hardcoded | **B** | Advanced |
| RAG top-k 30 / final 5 | hardcoded in chat | **B** | Advanced |
| Idle unload | settings 0–240 | **A** | Fix UX (P0.11) |
| Agent step/retry limits | settings | **A** | Expose UI |
| Workspace path guards | realpath | **D** | Never editable |
| Shell metachar blocks | `|&;<>()$\`"'` | **D** | Never editable |
| Schema versions | review=2, etc. | **D** | Diagnostics read-only |
| Approval / destructive gates | policy | **D** | Summary only |
| Settings schemaVersion | **missing** | gap | Add in P0.9 |

Full constant list: see §Hardcoding in JSON (`hardcodingAudit`).

---

## 7. Contract Matrix (P0.15 preview)

Legend: UI = exposed · C = consumed · P = persisted · OK / GAP / ORPHAN / MISMATCH

| Key | UI | C | P | Class (proposed) | Status |
|-----|----|---|---|------------------|--------|
| theme | ✓ | ✓ | ✓ | user_tunable | OK |
| autoSave | ✓ | ✗ | ✓ | orphaned → fix or deprecate | ORPHAN |
| reasoningDisplayMode | ✓ | ✓ | ✓ | user_tunable | OK |
| editorFontSize | ✓ | ✓ | ✓ | user_tunable | OK |
| terminalShell | ✓ | ✗ | ✓ | orphaned | ORPHAN |
| safeCommandConfirmation | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| telemetryEnabled | ✗ | ✓ | ✓ | hard_invariant | OK (locked) |
| modelsPath | ✓ | ✓ | ✓ | user_tunable | OK (+ env override invisible) |
| defaultModelId | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| defaultChatModelId | ✓ | ✓ | ✓ | user_tunable | OK |
| backendUrl | ✓ | ✓ | ✓ | user_tunable | OK |
| agentExecutionEnabled | ✓ | ✗ | ✓ | orphaned | ORPHAN |
| safeMode | ✓ | ✓ | ✓ | user_tunable | OK |
| maxAgentRuntimeSeconds | ✓ | ✓ | ✓ | user_tunable | OK |
| maxFileScanCount | ✓ | ✓ | ✓ | user_tunable | OK |
| cloudModelsEnabled | ✗ | ✓ | ✓ | advanced_user_tunable | GAP UI |
| preferLocalModels | ✗ | partial | ✓ | advanced / legacy | GAP |
| localOnlyModels | ✗ | partial | ✓ | advanced_user_tunable | GAP |
| ollamaBaseUrl | ✗ | ✗ | ✓ | advanced → wire or orphan | ORPHAN |
| anthropicApiKey | ✗ | ✓ | ✓ | secret | GAP UI |
| openaiApiKey | ✗ | ✓ | ✓ | secret | GAP UI |
| defaultPlanner/Coder/Reviewer/Debug ModelId | ✓ | ✓ | ✓ | user_tunable | OK |
| autoStartChat/CodingRuntime | ✓ | ✓ | ✓ | user_tunable | OK |
| autoStartVision/ReviewRuntime | ✓ | ✗ | ✓ | orphaned | ORPHAN |
| idleUnloadWorkModelsMinutes | ✓* | ✓ | ✓ | user_tunable | UX GAP (*uncontrolled) |
| chat/coding RuntimeSlot | ✓* | ✗ | ✓ | hard_invariant / readonly | MISLEADING |
| chat/coding RuntimePort | ✓* | ✗ | ✓ | read_only_diagnostic | ORPHAN UI |
| stopDesktopRuntimesOnExit | ✓ | ✓ | ✓ | user_tunable | OK |
| maxAutonomousSteps | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| maxDebugRetries | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| maxFailedTaskRetries | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| localOnly | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| defaultModelName | partial | ✓ | ✓ | user_tunable | OK-ish |
| modelDiscoveryMode | ✗ | ✓ | ✓ | user_tunable | GAP UI |
| runtimeChatUseBroker | ✓ | ✗ | ✓ | orphaned | ORPHAN |
| runtimeChatEnable* / shadow / stop | ✓ | ✓ | ✓ | advanced_user_tunable | OK |
| runtimeChatCanaryPercent | ✓ | partial | ✓ | advanced | PARTIAL |
| contextSpoolerEnabled | ✗ | ✓ | ✓ | advanced_user_tunable | GAP UI |
| ragEnabled | status only | ✓ | ✓ | user_tunable | GAP toggle |
| hybridRetrievalEnabled | ✗ | ✓ | ✓ | advanced_user_tunable | GAP UI |
| reasoningTraceEnabled | ✗ | ✓ | ✓ | advanced_user_tunable | GAP UI |
| tokenBudget*Ratio | ✗ | ✓ | ✓ | advanced_user_tunable | GAP UI |
| conversationControlV2 | ✗ | ✓ | ✗? | internal_feature_flag | MISMATCH |
| legacyStructuredMarkupParser | ✗ | ✗ | ✗? | deprecated/orphaned | MISMATCH+ORPHAN |
| defaultOrchestratorModelId | ✓* | ✓ | ✓ | user_tunable | UX (*uncontrolled) |
| autoStartOrchestratorRuntime | ✓ | ✓ | ✓ | user_tunable | OK |
| orchestratorRuntimeSlot | display | ✗ | ✓ | hard_invariant | OK display |
| orchestratorRuntimePort | ✓* | ✗ | ✓ | read_only_diagnostic | ORPHAN UI |

---

## 8. Expected findings — verification

| # | Expected | Result |
|---|----------|--------|
| 1 | idleUnload UX/persist display weak | **Confirmed** — uncontrolled `defaultValue`, onBlur only |
| 2 | Chat/Coding slot free text despite Literal | **Confirmed** |
| 3 | AppSettings without UI | **Confirmed** (~21) |
| 4 | Feature flags partially visible | **Confirmed** |
| 5 | Env overrides invisible | **Confirmed** |
| 6 | Full object not Patch | **Confirmed** — PUT only |
| 7 | No schema/revision/migration | **Confirmed** |
| 8 | Settings path invisible | **Confirmed** |
| 9 | No import/export/reset | **Confirmed** |
| 10 | Too much in App.tsx | **Confirmed** — sole SettingsPanel |

---

## 9. Änderungsplan (implementation order)

**No commits/pushes/PRs without explicit approval.**

### Phase A — Contract & registry (before UI polish)

1. Align shared ↔ backend: add `conversationControlV2` / `legacyStructuredMarkupParser` to Python **or** strip them from client PUT until decided; unify defaults (`modelsPath`, `ollamaBaseUrl`, `defaultModelName`).
2. Add `settingsRegistry.ts` + audit types (`SettingDefinition`, classifications).
3. Implement `PATCH /settings` with `baseRevision`, atomic temp+replace save, `schemaVersion` + `revision` + `updatedAt`.
4. Diagnostics endpoint / payload (no secrets): paths, overrides, orphaned list, hardcoded snapshot.
5. Contract gate test (matrix assertions).

### Phase B — Extract Settings Notebook

6. New tree under `apps/desktop/src/settings/` (notebook, tabs, field, footer, draft store, source resolver, validation).
7. Mount from `App.tsx` only; delete inline `SettingsPanel` body.
8. Tabs per master prompt (Allgemein, Modelle, Runtime, Agenten/Sicherheit, Kontext/RAG, Workspace/Editor, Backend/Integrationen, Erweitert, Diagnose).
9. Controlled inputs + sticky dirty footer; toggles immediate or explicit Apply for text/number/path.
10. Idle-Unload: controlled 0–240, save → reload → show effective; diagnostic strip (watcher/active run).

### Phase C — Wire / demote orphans

11. For each orphan: **wire consumer**, **demote to readonly/diagnostic**, or **remove from UI** with classification `orphaned`/`deprecated`.
12. Slots/ports: select from `RUNTIME_SLOT_DEFINITIONS` or readonly from contract — never free text.
13. Secrets: mask in UI; document plaintext gap; prefer OS credential store follow-up.
14. Env override badges via `settingsSourceResolver`.

### Phase D — Search, reset, import/export

15. Settings search → navigate to field.
16. Reset field/tab/global with diff preview.
17. Export (secrets redacted) / import (validate + diff).

### Phase E — Verify

18. Re-run inventory; idle-unload E2E; contract tests; typecheck; desktop + backend tests; build.
19. Abschlussbericht including non-editable invariants (**D**).

### Explicitly non-editable (D) — document in Diagnose tab

- Workspace path containment  
- Shell metachar / dangerous command blocks  
- Schema versions  
- Destructive approval obligations  
- Patch/package size safety caps  
- `telemetryEnabled === false`  

---

## 10. Proposed UI component plan

```text
apps/desktop/src/settings/
├── SettingsNotebook.tsx
├── SettingsTabBar.tsx
├── SettingsPageHeader.tsx
├── SettingsFooter.tsx          # dirty count + Verwerfen/Speichern
├── SettingsSearch.tsx
├── SettingField.tsx
├── SettingStatusBadge.tsx      # Quelle / Dirty / Applied
├── settingsRegistry.ts
├── settingsDraftStore.ts
├── settingsAudit.ts
├── settingsValidation.ts
├── settingsSourceResolver.ts
└── tabs/
    ├── GeneralSettingsTab.tsx
    ├── ModelsSettingsTab.tsx
    ├── RuntimeSettingsTab.tsx
    ├── AgentsSafetySettingsTab.tsx
    ├── ContextRagSettingsTab.tsx
    ├── WorkspaceEditorSettingsTab.tsx
    ├── BackendIntegrationsSettingsTab.tsx
    ├── AdvancedSettingsTab.tsx
    └── DiagnosticsStorageSettingsTab.tsx
```

Reuse: `settingsStore`, `backendClient`, Electron IPC, existing model selects / RAG actions — no parallel architecture.

---

## 11. Migrationsplan (P0.9)

1. Introduce envelope: `{ schemaVersion, revision, updatedAt, settings: AppSettings }` **or** flat fields + metadata keys — prefer flat metadata siblings to minimize churn if validators expect flat today; decide in Phase A with schema gate.
2. On load: if no `schemaVersion`, treat as v0 → migrate to v1 (fill defaults, strip unknown after backup).
3. Save: validate → write `settings.json.tmp` → fsync if available → atomic replace → re-read validate.
4. Corrupt file: rename to `settings.json.corrupt.<timestamp>` then recreate defaults; never silent overwrite of corrupt payload.
5. Revision: increment on every successful patch; reject stale `baseRevision` with `settings_revision_conflict`.

---

## 12. Status

Phases A–C notebook + remaining UX (transfer/reset/idle/orphans) are implemented on this branch. No commit until you ask.
