# Agent Runner Phase 2A — LLM + Safe Patch

Extends Phase 1A with runtime-backed patch proposals and desktop apply flow.

## Flow

1. `POST /agent-runner/run-once` claims a coder/implementation job
2. Context pack + read-only tools (unchanged)
3. If runtime is running: `/runtime/chat` with coder prompt
4. Parse JSON patch proposals → artifacts `llm_response.md`, `patch_proposals.json`
5. Jobs with patches enter `waiting_verification`
6. Desktop Job Monitor: **Run once** + **Patch anwenden** via Safe Patch Pipeline

## LLM activation

- `task_type` in `coder`, `implementation`, `patch`, `coding`
- or `input_payload.enable_llm: true`
- disable with `enable_llm: false`
- `analysis` jobs stay read-only

## Desktop

- IPC: `getAgentRunnerStatus`, `runAgentOnce`
- Store: `useAgentRunnerStore`
- UI: `JobMonitorPanel` Phase 2A section
- **Job Monitor → „Im Runtime Chat fortsetzen“** übergibt Job-Titel, Workspace und Artefakt-Hinweise als `contextHint` an den Runtime Chat

## Runtime split (P0)

| Pfad | Verantwortung |
|------|----------------|
| **Backend Agent Runner** | Read-only: Context Pack, `filesystem.list_dir` / `filesystem.read_text`, LLM-Patch-Vorschläge als Artefakte |
| **Desktop RuntimeKernel** | Interaktive Tools (read/write/patch/terminal) über `apps/desktop/src/runtime/` + IPC-Bridge |

Der Job-Runner schreibt **nicht** in den Workspace. Patches werden im Desktop über Restore Points angewendet (Runtime Chat oder Job Monitor).

## Safety

- No backend workspace writes
- Patch paths validated under workspace root
- Apply only through Electron restore-point pipeline
