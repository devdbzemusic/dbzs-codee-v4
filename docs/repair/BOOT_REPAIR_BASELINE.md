# Boot Repair Baseline

## Commit

`0730070` (branch `repair/boot-orchestrator-deterministic`, branched from `main`)

## Desktop

- install: OK (`pnpm install`, workspace already up to date)
- typecheck: **FAIL** — 1 pre-existing error, unrelated to boot orchestrator:
  `electron/settingsSecurity.ts(50,45): error TS2345: Argument of type 'string | number | boolean | null | undefined' is not assignable to parameter of type 'string'.`
  This file is not touched by the boot repair; left as-is per repair-plan instructions (document, don't fix incidentally).
- tests: OK — `@dbzs/shared`: 3 files / 9 tests passed. `@dbzs/desktop`: 152 files / 889 tests passed, 2 files / 36 tests skipped.
- build: OK — `pnpm build` (shared `tsc` + desktop `electron-vite build`) completed cleanly, no errors.

## Backend

- dependency sync: OK — `uv sync` via a locally-installed `uv` (had to install `uv` via `pip install uv` first; neither `uv` nor a working `python`/`py` launcher was on this shell's `PATH` even though the previous session ran the backend successfully — likely a different shell/session had it configured). Used `python -m uv` throughout since the `uv.exe` script entry point itself wasn't placed in a `PATH`-visible directory.
- tests: **16 of 393 failed**, all pre-existing and unrelated to the boot orchestrator:
  - 15 failures in `test_residency_cache.py`, `test_runtime_api.py`, `test_runtime_service.py`, `test_runtime_warmup.py` — all `AttributeError: 'RuntimeService' object has no attribute '_shared_slot_bindings'`. Root cause: these tests construct `RuntimeService.__new__(RuntimeService)` directly (bypassing `__init__`) and never touched by this session's changes (`runtime/service.py` is untouched by the boot repair). Matches a known, previously-documented issue from the prior session.
  - 1 new failure: `test_task_manifest.py::test_paused_resume_requires_explicit_workspace_change_acceptance` — `PermissionError: [WinError 5] Zugriff verweigert` on `Path.replace()` of a temp file under `tests/.pytest-local-tmp/...`. Windows-specific file-locking flake (likely AV/indexer holding a handle on the temp file), unrelated to `agent_workbench`/boot logic. Not touched by this repair; noted for potential separate follow-up.

## Bereits bekannte Fehler

- `apps/desktop/electron/settingsSecurity.ts:50` — pre-existing type error, not part of boot orchestrator scope.
- 15 pre-existing `RuntimeService` test failures (missing `_shared_slot_bindings` on manually-constructed test instances) — confirmed unrelated, `runtime/service.py` out of scope for this repair.
- 1 Windows file-locking flake in `test_task_manifest.py` — confirmed unrelated, `agent_workbench` out of scope for this repair.

None of the above block the boot-orchestrator repair; per the repair plan's abort condition, only failures that block the boot repair itself are to be fixed as part of this work.
