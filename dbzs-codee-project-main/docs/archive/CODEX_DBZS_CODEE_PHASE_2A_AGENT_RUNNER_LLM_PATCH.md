# Phase 2A — Agent Runner + LLM + Safe Patch

Stand: 2026-06-12  
Ziel: Vom read-only Agent Runner (1A) zur **LLM-gestützten Patch-Vorschlags-Schleife** mit **Safe Patch Pipeline** (1D) auf Desktop-Seite.

---

## Ausgangslage

Phase 1A (`AgentRunnerService`) macht heute:

1. Job claimen  
2. Context Pack bauen  
3. Read-only Tools (`list_dir`, `read_text`)  
4. Artefakte `context_pack.md`, `run_summary.md`  
5. Job abschließen oder `waiting_verification`

**Lücke:** Kein LLM-Aufruf, keine Patch-Vorschläge, kein UI-Weg zum Anwenden.

---

## Zielbild Phase 2A

```text
Job (task_type: coder|implementation|patch)
  → Context Pack (bestehend)
  → Runtime /runtime/chat (wenn running)
  → JSON Patch-Vorschläge parsen + validieren
  → Artefakte: llm_response.md, patch_proposals.json
  → waiting_verification bei Patches
  → Desktop: Job Monitor „Run once“ + „Patch anwenden“ via Safe Patch Pipeline
```

### Nicht in Scope (Phase 2B+)

- Autonomes Multi-Step-Agent-Loop ohne User-Review  
- Shell-Befehle im Runner  
- Backend-seitiges Schreiben in den Workspace  
- Auto-Apply ohne Restore Point  

---

## Backend

### LLM-Aktivierung

LLM-Schritt wenn:

- `task_type` ∈ `{coder, implementation, patch, coding}`, **oder**
- `input_payload.enable_llm === true`

Deaktiviert wenn `input_payload.enable_llm === false`.

`task_type=analysis` bleibt read-only (Abwärtskompatibilität).

### Runtime

- Injektion `RuntimeService` in `AgentRunnerService`
- Wenn Runtime **nicht** `running`: Waypoint `llm_skipped`, Job endet mit Context-only (`llm_skipped: true`)
- Wenn Runtime running: `POST`-äquivalent via `RuntimeService.chat()`

### Prompt & Antwortformat

System-Prompt fordert **nur JSON**:

```json
{
  "patches": [
    {
      "file_path": "relative/path/from/workspace/root",
      "proposed_content": "vollständiger Dateiinhalt nach Änderung",
      "summary": "kurze Begründung"
    }
  ]
}
```

Parser akzeptiert JSON in Markdown-Fences oder als Rohtext.

### Validierung

- `file_path` relativ zum Workspace, kein `..`, muss unter `workspace_root` auflösbar sein
- Max. 5 Patches pro Run
- Max. 64 KB `proposed_content` pro Patch

### API-Erweiterung `AgentRunResult`

```json
{
  "state": "idle",
  "agent_id": "...",
  "job_id": "...",
  "message": "needs_review",
  "artifacts": ["context_pack.md", "llm_response.md", "patch_proposals.json"],
  "patch_proposals": [{ "file_path": "...", "proposed_content": "...", "summary": "..." }],
  "llm_skipped": false
}
```

---

## Desktop

### Bridge / IPC

- `GET /agent-runner/status` → `dbzs:agent-runner:status`
- `POST /agent-runner/run-once` → `dbzs:agent-runner:run-once`

### Job Monitor

- Button **„Agent Run once“** (Worker-ID, Workspace aus Store)
- Anzeige `patch_proposals.json` aus Job-Artefakten
- Pro Patch: **Preview** (optional) + **Anwenden** via `applyPatchWithRestorePoint`

---

## Tests

| Bereich | Test |
|---------|------|
| `patch_parser` | JSON in Fence, invalid paths, leere patches |
| `agent_runner` | LLM happy path mit Fake Runtime |
| `agent_runner` | Runtime stopped → llm_skipped |
| API | coder job + mock runtime → patch_proposals artifact |
| Desktop | agentRunnerStore + JobMonitor Run-once Button |

---

## Abnahme

```powershell
pnpm typecheck
pnpm test
cd backend && uv run pytest tests/test_patch_parser.py tests/test_agent_runner_llm.py tests/test_agent_runner_api.py -q
pnpm acceptance:live
```

Manuell: Runtime starten → Coder-Job enqueuen → Run once → Patch im Job Monitor anwenden → Restore Point prüfen.
