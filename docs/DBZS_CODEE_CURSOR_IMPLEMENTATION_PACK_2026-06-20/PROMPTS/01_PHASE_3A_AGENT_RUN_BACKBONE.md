# Cursor Auftrag — Phase 3A: Persistenter Agent Run Backbone

## Ziel

Führe einen persistenten Backendkern für AgentRuns und AgentSteps ein.

Noch kein echter LLM-Worker, keine Patch-Anwendung und keine neue große UI.

## Vorhandenen Code prüfen

- `backend/app/job_spooler/`
- `backend/app/agent_runner/`
- `backend/app/agent_loop/autonomous_controller.py`
- `backend/app/review_gates/`
- `backend/app/trajectories/`
- `backend/app/main.py`

## Neue Struktur

```text
backend/app/agent_workbench/
  __init__.py
  models.py
  repository.py
  service.py
  router.py
  migrations.py
```

## Implementieren

### Modelle

- `AgentRun`
- `AgentStep`
- Create/Update/Response Schemas
- Run- und Step-Status als Literals/Enums
- Transition Validation

### SQLite

Tabellen:

- `agent_runs`
- `agent_steps`

Additive, idempotente Migration.

Datenbank unter bestehendem App-Data-Verzeichnis.

### Service

- Run erstellen
- Run lesen/listen
- Plan/Steps setzen
- Runstatus ändern
- Stepstatus ändern
- Pause/Resume/Cancel
- Recovery-Markierung nach Neustart
- maximal ein aktiver Step je Run

### API

```text
POST /agent-workbench/runs
GET  /agent-workbench/runs
GET  /agent-workbench/runs/{run_id}
POST /agent-workbench/runs/{run_id}/plan
POST /agent-workbench/runs/{run_id}/start
POST /agent-workbench/runs/{run_id}/pause
POST /agent-workbench/runs/{run_id}/resume
POST /agent-workbench/runs/{run_id}/cancel
```

Router in `backend/app/main.py` registrieren.

## Migration vorhandener Konzepte

- `job_id` optional am Run
- AutonomousLoopController noch nicht löschen
- AgentRunner noch nicht ändern
- keine Parallel-State-Machine im Renderer ergänzen

## Tests

- Migration
- CRUD
- erlaubte Übergänge
- verbotene Übergänge
- ein aktiver Step
- Recovery
- fehlender Workspace
- ungültige IDs

## DoD

```powershell
cd backend
uv run pytest -q
```

Zusätzlich Root-Gates:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## Abschlussbericht

Keine Behauptung über einen funktionierenden autonomen Agenten. Diese Phase liefert nur den persistenten Backbone.
