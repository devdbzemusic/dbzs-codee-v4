# Cursor Auftrag — Phase 3B: Event Spine und Single Worker

## Voraussetzung

Phase 3A ist grün.

## Ziel

Jeder Run und Step erzeugt persistente, typisierte Events. Ein einfacher Single Worker kann Runs starten, pausieren, fortsetzen und abbrechen.

Noch keine Dateiänderungen.

## Neue/erweiterte Dateien

```text
backend/app/agent_workbench/
  events.py
  worker.py
  event_stream.py
```

## Implementieren

### Agent Events

Tabelle `agent_events` mit streng steigender Sequence pro Run.

Eventtypen entsprechend `07_EVENT_AND_SSE_CONTRACT.md`.

Statusänderung und Event atomar speichern.

### SSE

```text
GET /agent-workbench/runs/{run_id}/stream
GET /agent-workbench/runs/{run_id}/events
```

- `after_sequence`
- Reconnect
- Heartbeat
- keine Events verlieren
- SQLite als Source of Truth

### Worker

- ein lokaler Worker
- nur ein schreibender Run gleichzeitig
- Read-only Demo-Step
- Pause zwischen Steps
- Cancel kooperativ
- max_steps
- Timeout
- Retry Count
- Recovery nach Backend-Neustart

### Plan

In dieser Phase darf ein Plan über API übergeben werden.

Keinen komplexen LLM-Planner einführen.

## Tests

- Event Sequence
- SSE replay
- Pause/Resume
- Cancel
- Timeout
- max_steps
- Restart Recovery
- keine doppelten Step Starts

## UI

Nur minimale Service-/Store-Anbindung für Debugging, noch keine Workbench.

## DoD

Ein Integrationstest muss einen Run mit drei Read-only-Demo-Steps vollständig durchlaufen und alle Events in richtiger Reihenfolge prüfen.
