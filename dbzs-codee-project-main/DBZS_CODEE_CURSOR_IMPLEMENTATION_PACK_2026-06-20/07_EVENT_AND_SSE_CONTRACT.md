# Event- und SSE-Vertrag

## Ziel

Der Activity Stream ist keine formatierte Logdatei. Er basiert auf typisierten, persistenten Events.

## Eventtypen

### Run

- `run.created`
- `run.planning_started`
- `run.plan_ready`
- `run.started`
- `run.paused`
- `run.resumed`
- `run.cancelled`
- `run.failed`
- `run.completed`
- `run.recovered`

### Step

- `step.created`
- `step.started`
- `step.progress`
- `step.blocked`
- `step.waiting_review`
- `step.completed`
- `step.failed`
- `step.skipped`
- `step.retrying`

### Tools

- `tool.requested`
- `tool.started`
- `tool.output`
- `tool.completed`
- `tool.failed`
- `tool.cancelled`

### Dateien

- `file.read`
- `file.search_match`
- `file.change_proposed`
- `file.change_approved`
- `file.change_rejected`
- `file.change_applying`
- `file.created`
- `file.modified`
- `file.renamed`
- `file.deleted`
- `file.rollback`

### Review

- `review.requested`
- `review.approved`
- `review.rejected`

### Commands und Diagnostik

- `command.requested`
- `command.started`
- `command.output`
- `command.completed`
- `command.failed`
- `diagnostic.created`
- `diagnostic.cleared`

### Follow-up

- `followup.received`
- `followup.applied`
- `followup.rejected`
- `plan.revised`

## SSE-Endpunkt

```text
GET /agent-workbench/runs/{run_id}/stream?after_sequence=123
```

Response:

```text
id: 124
event: agent_event
data: { ... }
```

## Reconnect

- Renderer speichert letzte `sequence`.
- Bei Reconnect wird `after_sequence` gesetzt.
- Backend liefert fehlende Events nach.
- SSE ist Transport, SQLite bleibt Quelle der Wahrheit.

## Event-Payload-Grundsätze

- kleine strukturierte Daten
- keine vollständigen Geheimnisse oder Env-Werte
- große Outputs als Artifact/Log-Referenz
- Dateiinhalte nicht standardmäßig im Event
- stdout/stderr als begrenzter Tail
- jeder Event enthält `run_id`, optional `step_id`
