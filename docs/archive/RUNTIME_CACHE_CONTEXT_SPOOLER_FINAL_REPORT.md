# Runtime Cache & Context Spooler — Abschlussbericht

Branch: `feat/runtime-cache-context-spooler` (6 commits on top of `main`, none direct to `main`).
Spec: `CLAUDE_RUNTIME_CACHE_CONTEXT_SPOOLER.md`.

## 1. Root Cause

Local model serving was slow/unstable and context handling was naive because:

- `n_gpu_layers`/`ctx-size` came from a static per-model catalog hint or a hardcoded slot
  default (`quality_cpu` always 16384/0), never from a real VRAM/model-size computation. The
  only VRAM-aware code (`gpu_detect.py::_estimate_gpu_layers`) was a crude tier table, not wired
  into the launch path for most slots.
- No OOM detection existed beyond a Windows-DLL-failure special case — a too-large `gpu_layers`
  value crashed the process with no recovery.
- `--batch-size`/`--ubatch-size`/`--cache-type-k/v`/`--cache-reuse` were never emitted, because
  nothing checked whether the installed `llama-server` binary actually supported them.
- "Residency" was incidental: a slot reused its process only if the *same model id* was
  requested again — a different context size or profile for the same model silently reused a
  stale process instead of restarting.
- Chat history was truncated with a hardcoded `slice(-12)` messages and a `16,000`-character cap,
  with zero token awareness; "compaction" discarded everything but the last 4 messages behind a
  flat "N compacted" string, and tool output shown to the model was the same 300–500-char string
  shown to the user, so repair loops saw mutilated error messages.
- Two dead-code TypeScript interfaces (`RuntimeTokenBudget`, `ToolOutputLayers`) from a prior,
  incomplete attempt at this same spec existed on a sibling branch but were never merged or
  implemented against.

## 2. Ist- und Zielarchitektur

**Ist (before)**: `RuntimeService.start_model` built a launch command directly from static hints;
`RuntimeSlotPanel` displayed VRAM/error fields the backend never actually populated (silently
dropped by Pydantic — a real bug found and fixed in Phase 1); `runtimeChatStore.sendMessage`
assembled system+history messages ad hoc with char/count limits.

**Ziel (after)**: a `RuntimeResourcePlanner` computes a hardware-fit plan before every launch; a
`RuntimeResidencyRegistry` formalizes slot reuse around a real launch fingerprint; a
`ModelContextCacheStore` caches hash-keyed prompt assemblies; a `ContextSpooler` enforces a real
per-lane token budget in the chat send path; llama-server capability probing gates every new CLI
flag; and the UI surfaces the real numbers the backend now computes.

## 3. Resource Planner (Phase 1, `81f1b20`)

- `backend/app/runtime/resource_planner.py` — `RuntimeResourcePlanner.plan()` computes
  `gpu_layers` by iterating downward from the VRAM-tier ceiling until the estimated model+KV
  cache+compute-buffer footprint fits within `available_vram - safety_reserve` (512 MB floor,
  768 MB when VRAM ≤ 4.5 GB, else 15% of available). `reduce_for_oom()` halves layers per retry.
  Fast/Balanced/Large Context/CPU Safe profiles are overlays on the same computation (no separate
  `runtime_profiles.py` module — kept inline since nothing else needed to import it).
- `backend/app/runtime/hardware_fingerprint.py` — OS/CPU/RAM/GPU snapshot + stable hash, used to
  scope a persisted "last good" plan to the hardware it was measured on.
- `tool_registry.py::detect_capabilities()` — probes the *full* `llama-server --help` text for
  exact flag names (the pre-existing `_get_tool_commands` parse was capped at the first 10
  `--`-lines and would miss flags appearing later in the output).
- `launch.py::build_runtime_command` only emits `--batch-size`/`--ubatch-size`/`--cache-type-k/v`
  when `capabilities` confirms support — never blind. `classify_exit_failure`/`is_oom_stderr` add
  real CUDA/ggml OOM detection (previously only a DLL-missing case existed).
- `service.py::start_model` runs a capped (3-retry) OOM loop: on OOM stderr, reduce layers and
  relaunch; persists the working plan (`_save_last_good_command`) keyed by hardware-fingerprint
  hash in the existing `models.runtime.json`, and reuses that persisted `gpu_layers` on the next
  launch so the same OOM loop doesn't repeat.

## 4. Runtime Residency Cache (Phase 2, `784f282`)

- `backend/app/runtime/residency.py` — `compute_launch_fingerprint()` hashes model id + a
  path/size proxy for the model file + runtime version + every launch parameter (ctx, gpu_layers,
  batch/ubatch, parallel, cache types, backend). `RuntimeResidencyRegistry` wraps (does not
  replace) `RuntimeService._slots`/`_statuses`, tracking `active_requests` and idle/busy state.
- The reuse check in `start_model` now compares the *fingerprint*, not just the model id: a
  same-model request with a different profile/context now correctly restarts.
- `chat()`/`chat_stream()` increment/decrement `active_requests` around the request; a new
  `sweep_idle_slots()` stops `idle_evict`-policy slots (`utility`) past a timeout —
  `keep_resident` slots (`fast_gpu`, `quality_cpu`) are never auto-evicted.
- New endpoints: `GET /runtime/slots/{slot_id}/residency`, `POST /runtime/slots/{slot_id}/evict`,
  `POST /runtime/slots/sweep-idle`.

## 5. Model Context Cache (Phase 3, `e9c4536`)

- `backend/app/context_pack/context_cache.py` — `ModelContextCacheStore`, JSON-persisted,
  keyed by `model_id + role + workspace_id + (system prompt / tool contract / project memory /
  architecture / AGENTS.md) hashes`. `invalidate_by_hash_change()` removes every entry for a
  workspace whose tracked hash no longer matches — hash-based, not TTL-based.
- `POST /context-pack/cache/{lookup,store,invalidate,clear}`.
- `apps/desktop/src/services/modelContextCacheClient.ts` — tested fetch wrapper. **Not yet wired
  into `runtimeChatStore.ts`'s live send path** — deliberately deferred to Phase 4, where the new
  spooler pipeline was a lower-risk integration point than retrofitting the existing function.

## 6. Context Spooler (Phase 4, `257be45`)

- Completed (did not need to "complete a stub" — the prior attempt's stub lived on a sibling
  branch, never merged) `RuntimeTokenBudget`/added `ContextLane`/`ContextManifest` in
  `packages/shared/src/index.ts`.
- `apps/desktop/src/runtime/context/contextSpooler.ts` — six lanes (`mandatory`, `active_task`,
  `relevant_code`, `recent_conversation`, `retrieved_memory`, `overflow`). Mandatory is **never**
  trimmed; the other four lanes split whatever's left of the input budget *after* mandatory's
  real size is subtracted (not a fixed share), so a large system/tool-contract payload doesn't
  silently overflow the total budget. History trims from the oldest turn first (reverses, fits
  newest-first via the now-exported/generic `trimByTokenBudget` from `contextPipeline.ts`, restores
  order) so the newest turns always survive.
- `runtimeChatStore.ts`: replaced `MAX_HISTORY_MESSAGES=12`/`MAX_CONTEXT_CHARS=16000` slicing in
  the live `sendMessage` path with spooler-driven assembly, gated behind a
  `contextSpoolerEnabled` flag (default **on**) with the old path kept as a fallback. Verified
  against all 26 pre-existing `runtimeChatStore` tests (all pass unchanged) plus 9 new spooler
  tests and 4 new `compactConversation` tests.
- `compactConversation()` now keeps messages carrying approval actions, tool errors, or
  error/correction keywords *literally* instead of discarding everything but the last 4 messages.
- `ToolOutputLayers` (displaySummary / agentContext / fullLogRef) implemented in
  `runtimeChatAgentRunner.ts::summarizeToolOutput`: `agentContext` keeps actual error/exception
  lines (not an arbitrary character cutoff); `fullLogRef` points into a capped in-memory store
  (`toolOutputLogStore.ts`) — **not yet persisted to disk** (known limitation, see §11).

## 7. llama.cpp Prompt/KV Cache (Phase 5, `b2b9e6d`)

- `--cache-reuse` gated on `capabilities.supports_cache_reuse`, safe unconditionally once
  supported because the Residency Cache already guarantees a fresh process on any
  fingerprint mismatch (no cross-model/cross-config reuse).
- `POST /runtime/slots/{slot_id}/tokenize` proxies to the running slot's own llama-server
  `/tokenize`; `llamaTokenizerClient.ts` falls back to the `chars/4` heuristic (now documented as
  a fallback, not the primary path) whenever the slot isn't reachable.
- Real `usage` (prompt/completion tokens) threaded from llama-server's streaming response
  (`stream_options.include_usage`) through a new additive `on_usage` callback — no existing
  `ChatClient.stream()` caller's behavior changed — into the SSE stream's `done` event.

## 8. UI + Telemetry (Phase 6, `47f4d65`)

`RuntimeSlotPanel.tsx` now shows GPU-Layer/Kontext/Antwortreserve/Batch/UBatch/KV-Cache/
Runtime-Cache-state per slot — all real values from the same resource plan the backend already
computes, not placeholders (several of these fields, e.g. VRAM%/error message, were silently
dead before Phase 1 because the backend never declared them on the response Pydantic model).
Added a profile selector, "Neu vermessen" (preview without launching), "Profil speichern"
(restart with the selected profile), and "Cache leeren" (Model Context Cache clear).

## 9. Geänderte Dateien (39 total)

Backend (new): `resource_planner.py`, `hardware_fingerprint.py`, `residency.py`,
`context_pack/context_cache.py`. Backend (modified): `service.py`, `launch.py`,
`gpu_detect.py`-adjacent (`_estimate_gpu_layers` kept, demoted to fallback), `tool_registry.py`,
`schemas.py`, `chat_stream.py`, `api/runtime.py`, `api/context_pack.py`,
`context_pack/models.py`. Desktop (new): `contextSpooler.ts`, `modelContextCacheClient.ts`,
`llamaTokenizerClient.ts`, `toolOutputLogStore.ts`. Desktop (modified): `runtimeChatStore.ts`,
`runtimeChatAgentRunner.ts`, `runtimeSlotManager.ts`, `runtimeSlotValidator.ts`,
`contextPipeline.ts`, `RuntimeSlotPanel.tsx`. Shared: `packages/shared/src/index.ts`.
Plus 12 test files (7 new, 5 extended) and `docs/RUNTIME_RESOURCE_AUDIT.md`.

## 10. Testresultate

- Backend: **273/273** passing (`pytest backend/tests/`), up from 243 at the start of this work
  (30 new tests across `test_resource_planner.py`, `test_residency_cache.py`,
  `test_model_context_cache.py`, `test_tool_registry_capabilities.py`, plus extensions to
  `test_runtime_service.py`, `test_runtime_launch.py`, `test_runtime_chat_stream.py`).
- Desktop: **496 passing / 3 pre-existing failures (confirmed via `git diff` against `main` on
  untouched files) / 36 pre-existing skips**, up from 489 passing at the start (35 new tests
  across `contextSpooler.test.ts`, `modelContextCacheClient.test.ts`,
  `llamaTokenizerClient.test.ts`, `runtimeChatAgentRunner.toolOutputLayers.test.ts`,
  `RuntimeSlotPanel.test.tsx`, plus extensions to `runtimeSlotManager.test.ts` and
  `runtimeChatStore.test.ts`).
- `tsc --noEmit` shows the same 7 pre-existing errors throughout every phase (confirmed
  unrelated via `git diff main` on each affected file) — zero new type errors introduced.

## 11. Bekannte Einschränkungen

1. **Model Context Cache is not yet wired into `runtimeChatStore.ts`'s live send path.** The
   backend store + API + desktop client are complete and tested; the actual cache-lookup/store
   calls around system-prompt/tool-contract/AGENTS.md assembly were deliberately deferred to
   avoid a second high-risk retrofit into the same function Phase 4 already touched.
2. **`fullLogRef` is an in-memory reference (capped at 200 entries), not a file on disk.** No
   verified IPC path for renderer-side file writes was found in this session; wiring one up is
   the natural next step once confirmed.
3. **KV-cache-byte estimation is a coarse per-token proxy** (`context_size // 4`, scaled by cache
   type), not a per-model exact formula — the model index doesn't carry layer/head-count
   metadata needed for an exact calculation. Flagged via a `kv_cache_estimate_approximate`
   warning on every computed plan.
4. **No Context Cache hit-rate telemetry yet** — the store doesn't track cumulative hit/miss
   counts, so the UI doesn't show a hit-rate percentage (better to omit than fabricate).
5. **Ollama usage/token stats are out of scope** — Phase 5's usage-threading only covers
   llama-server's OpenAI-compatible streaming endpoint, per the spec's explicit scope.
6. Two items the original spec doc flagged as pre-existing bugs (a `DEFAULT_SLOT_PORTS` dict
   inconsistency and an unused `port` field sent by the frontend) were investigated and found to
   **not exist** on this branch — verified directly against the code rather than assumed.

## 12. Nächste Optimierung

- Wire the Model Context Cache into `runtimeChatStore.ts` (Phase 3's deferred item) — now that
  the Context Spooler's assembly pipeline exists, this is a lower-risk integration than before.
- Persist `fullLogRef` to disk once an IPC file-write path is confirmed available.
- Track Context Cache hit/miss counts for the UI's hit-rate display.
- Consider exact per-model KV-cache sizing if/when the model index gains layer/head-count
  metadata (e.g. parsed from GGUF headers).
