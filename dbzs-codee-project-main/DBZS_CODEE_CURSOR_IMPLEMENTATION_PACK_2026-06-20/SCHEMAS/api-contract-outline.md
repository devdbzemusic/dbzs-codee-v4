# API Contract Outline

## Runs

```text
POST   /agent-workbench/runs
GET    /agent-workbench/runs
GET    /agent-workbench/runs/{run_id}
POST   /agent-workbench/runs/{run_id}/plan
POST   /agent-workbench/runs/{run_id}/start
POST   /agent-workbench/runs/{run_id}/pause
POST   /agent-workbench/runs/{run_id}/resume
POST   /agent-workbench/runs/{run_id}/cancel
POST   /agent-workbench/runs/{run_id}/followups
GET    /agent-workbench/runs/{run_id}/events
GET    /agent-workbench/runs/{run_id}/stream
```

## Review

Bestehende `/review-gates/*`-Endpoints erweitern, nicht duplizieren.

## Host Actions

```text
GET    /agent-workbench/host-actions/next
POST   /agent-workbench/host-actions/{action_id}/claim
POST   /agent-workbench/host-actions/{action_id}/complete
POST   /agent-workbench/host-actions/{action_id}/fail
```

## Konfliktcodes

- `404` unbekannte Entität
- `409` ungültiger Zustandsübergang oder Hash-Konflikt
- `422` ungültiger Contract
- `503` Desktop Host nicht verfügbar

## Idempotency

Create-/Action-Endpunkte akzeptieren optional:

`Idempotency-Key`

Für Host Actions ist die `action_id` selbst idempotent.
