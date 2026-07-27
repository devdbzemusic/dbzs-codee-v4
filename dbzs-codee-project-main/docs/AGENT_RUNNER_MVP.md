# Agent Runner MVP

Phase 1A connects Job Spooler, Orchestration, and Context Pack into one read-only run loop.

## Flow

1. `POST /agent-runner/run-once` claims the next queued job
2. Waypoints: `started`, `checkpoint` (`context_prepared`)
3. Context Pack is built for the workspace
4. Tools: `filesystem.list_dir`, `filesystem.read_text` only
5. Artifacts: `context_pack.md`, `run_summary.md`
6. Job completes or fails with visible waypoints

## API

- `GET /agent-runner/status`
- `POST /agent-runner/run-once`

## Safety

- No shell commands
- No workspace writes
- No web fetch in runner path
- Workspace root required in job `input_payload.workspace_root`
