# Runtime Resource Audit

Snapshot of how `ctx-size`, `n_gpu_layers`, and related launch parameters are actually
determined today (branch `feat/runtime-cache-context-spooler`, based on `main`). This is the
baseline the Runtime Resource Planner (Phase 1) replaces. All line numbers verified by direct
read of the cited commit.

## 1. Where `ctx-size` / `n_gpu_layers` are set

- `backend/app/runtime/launch.py::build_runtime_command` (lines 225-271) is the only place that
  emits the actual llama-server CLI flags. Precedence: `config_override` dict (`context_size`/`ctx`,
  `n_gpu_layers`/`gpu_layers`, `n_threads`/`threads`, `parallel`/`n_parallel`) beats
  `model.runtime.ctx`/`model.runtime.gpu_layers` (`ModelRuntimeHints`, static per-model catalog
  hints) beats hardcoded fallback (`ctx=4096`, `gpu_layers=0`). Only `--ctx-size`, `--gpu-layers`,
  `--parallel`, and (if provided) `--threads` are ever emitted. `--batch-size`, `--ubatch-size`,
  `--cache-type-k`, `--cache-type-v`, `--cache-reuse`, `--prompt-cache` are never emitted anywhere
  in the codebase — confirmed zero occurrences of these flag names outside doc/spec files.
- `backend/app/runtime/service.py::start_model` (lines 294-483) is the only caller that builds the
  `config_override` dict passed into `build_runtime_command` via `build_launch_plan`. The **only**
  slot-specific override today is for `quality_cpu` (lines 359-363): forces `context_size=16384`
  (if not already set) and `gpu_layers=0`. There is **no** override for `fast_gpu` or `utility` —
  `detect_gpu()` / `gpu_detect` is not imported or called anywhere in `service.py`. This means
  `fast_gpu` gpu-layer count today comes purely from `model.runtime.gpu_layers` (a static catalog
  hint) or an explicit caller override, defaulting to `0` if neither is set. There is no
  hardware-VRAM-aware computation of GPU layers in the launch path at all.
- `backend/app/runtime/gpu_detect.py::_estimate_gpu_layers` (lines 136-150) is a standalone
  VRAM-tier lookup table (24GB→99, 16GB→48, 12GB→36, 8GB→24, 6GB→16, 4GB→8, else→0). It is called
  only from within `gpu_detect.py` itself (by `_try_nvidia`/`_try_amd` to populate
  `GpuInfo.recommended_gpu_layers`) and by `backend/app/api/models.py`'s `/gpu` diagnostics route
  (hardware-info display) — it is **not** wired into the actual launch path in `service.py`.

## 2. Profile fields that are silently dropped at real launch

`backend/app/models/profiles.py` defines `GPUConfig{n_gpu_layers, n_threads, batch_size}` and
`ContextConfig{context_size, cache_size_mb, max_response_tokens}`, consumed by
`MultiServerManager._start_single_model` to build a config dict passed to
`RuntimeService.start_model_with_config`.

- `GPUConfig.batch_size` never reaches the CLI — there is no `--batch-size` flag anywhere in
  `build_runtime_command`, so this field is pure dead weight today.
- `ContextConfig.cache_size_mb` reaches the config dict (`multi_server_manager.py`) but
  `build_runtime_command` has no code path reading a `cache_size_mb` key — it is silently dropped.
  It is used only for the VRAM *estimation* math in
  `profile_service.py::estimate_resource_usage_for_profile` (lines 283-333), not for any real CLI
  flag, since no `--cache-type-*` flag exists to consume it.
- `ContextConfig.max_response_tokens` is never wired into the actual chat request's `max_tokens`
  (that comes from `RuntimeChatRequest.max_tokens`, unrelated).
- `ServerProfile.auto_restart_on_error` and `fallback_to_cpu` are declared but never read anywhere
  outside their own class definition — no restart-on-crash supervision loop exists.

## 3. Where char-limits substitute for token budgets

- `apps/desktop/src/stores/runtimeChatStore.ts` (`MAX_CONTEXT_CHARS`, `MAX_HISTORY_MESSAGES`) —
  hard character/message-count cutoffs, no token counting.
- `apps/desktop/src/runtime/context/contextRankingEngine.ts::estimateTokens` —
  `Math.ceil(value.length / 4)`, a char/4 heuristic.
- `backend/app/context_pack/service.py` (`_build_repo_map`) — `size_bytes // 4` heuristic used to
  fit files into a token budget for repo-map generation. Unrelated to runtime launch, but the only
  other token-budget code in the backend and useful prior art for style/location.

## 4. Runtime restart behavior

`start_model` reuses the existing process for a slot only when
`current.state == "running" and current.model_id == model_id` (lines 339-345); otherwise it stops
the running process and starts a new one. There is no finer-grained comparison (context size, GPU
layers, batch size, cache types) — two launches of the *same* model with *different* resource
parameters are currently treated as "already satisfied," which the Residency Cache (Phase 2) will
correct via a real launch fingerprint.

## 5. OOM, timeout, and crash handling

- `describe_process_exit_code` (`launch.py`, lines 378-395) only special-cases a Windows
  DLL-load-failure exit code (`0xC0000135` / `-1073741515`) and a stderr substring for
  architecture-mismatch (`"unknown model architecture"` / `"unsupported model architecture"`). No
  CUDA/ggml out-of-memory pattern is matched anywhere in the codebase today.
- `wait_for_runtime_endpoint` (`launch.py`, lines 398-425) polls `process.poll()` during warmup;
  on crash it surfaces `describe_process_exit_code`'s message plus a stderr tail. On timeout
  (`DBZS_RUNTIME_WARMUP_TIMEOUT_SECONDS`, default 600s) it returns a generic "not ready" message.
- `start_model`'s retry loop (`ordered_candidate_ids = [model_id, *fallback_candidate_ids]`, line
  348) retries with **different candidate models** (an architecture-compatibility fallback via
  `_fallback_model_candidates`, lines 961-1014 — a Gemma/Qwen name-based scoring heuristic), not
  with a reduced resource plan for the *same* model. There is no OOM-triggered
  "reduce GPU layers and retry the same model" loop at all — this is the gap Phase 1's OOM
  detection + capped retry loop fills.

## 6. Batch / ubatch / KV-cache / prompt-cache support

None of `--batch-size`, `--ubatch-size`, `--cache-type-k`, `--cache-type-v`, `--cache-reuse`, or
`--prompt-cache` are ever emitted by `build_runtime_command`. `RuntimeToolRegistry`
(`tool_registry.py`) discovers `llama-server`/`llama-cli`/`llama-bench`/`llama-tokenize` and parses
the first 10 `--`-prefixed lines of each tool's `--help` output generically (`_get_tool_commands`,
lines 160-197) — it does not check for these specific flags by name, and its result
(`RuntimeService.tool_registry`, instantiated at init) is never read again anywhere else in
`service.py`. There is currently no mechanism that gates flag usage on actual llama-server
capability — moot today only because no such flags are ever emitted, but this must be fixed before
Phase 1 starts emitting them.
