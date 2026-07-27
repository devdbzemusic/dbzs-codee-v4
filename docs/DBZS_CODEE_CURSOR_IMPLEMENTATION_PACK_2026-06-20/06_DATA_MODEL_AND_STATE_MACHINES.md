# Datenmodell und Zustandsmaschinen

## AgentRun

```text
id
job_id optional
workspace_root
workspace_name
goal
status
execution_mode
provider
model_id
current_step_id
max_steps
created_at
updated_at
started_at
finished_at
pause_reason
error_message
schema_version
```

`execution_mode` zunächst:

- `supervised`
- `read_only`

Später optional:

- `trusted_local`

## AgentStep

```text
id
run_id
ordinal
title
description
status
role
depends_on_json
tool_policy_json
attempt_count
max_attempts
input_summary
output_summary
created_at
started_at
finished_at
error_message
```

## AgentEvent

```text
sequence
id
run_id
step_id optional
event_type
severity
summary
payload_json
created_at
```

`sequence` muss pro Run streng aufsteigend sein.

## AgentToolCall

```text
id
run_id
step_id
tool_id
status
arguments_json
result_json
stdout_tail
stderr_tail
exit_code
started_at
finished_at
error_message
```

## AgentFileChange

```text
id
run_id
step_id
file_path
operation
status
summary
before_hash
after_hash
diff
added_lines
removed_lines
restore_point_id
review_gate_id
created_at
updated_at
```

Operationen:

- `create`
- `modify`
- `rename`
- `delete`

Status:

- `proposed`
- `waiting_review`
- `approved`
- `rejected`
- `applying`
- `applied`
- `failed`
- `rolled_back`

## AgentFollowUp

```text
id
run_id
text
status
created_at
processed_at
effect_summary
```

Status:

- `pending`
- `applied`
- `rejected`

## HostAction

```text
id
run_id
step_id
action_type
status
payload_json
result_json
created_at
claimed_at
completed_at
error_message
```

Aktionstypen:

- `apply_patch`
- `run_command`
- `cancel_command`
- `git_create_branch`
- `git_commit`
- `refresh_workspace`

## Run-Zustandsmaschine

```text
created
  → planning
  → waiting_plan_review
  → ready
  → running
  → waiting_review
  → running
  → completed

Jeder aktive Zustand kann:
  → paused
  → cancelled
  → failed

paused → running
failed → retrying → running
```

Nicht erlaubte Übergänge müssen HTTP 409 liefern.

## Step-Zustandsmaschine

```text
pending
  → active
  → waiting_review
  → completed

active → failed
failed → retrying → active
pending → skipped
waiting_review → rejected
waiting_review → active nach genehmigter Host Action
```

## Persistenzregeln

- Jede Statusänderung und das zugehörige Event werden in einer Transaktion gespeichert.
- Ein Run darf höchstens einen `active` Step besitzen.
- Ein schreibender Run darf erst fortfahren, wenn die Host Action abgeschlossen ist.
- Nach Backend-Neustart werden `running` Runs zunächst auf `paused_recovery` gesetzt.
- Der User entscheidet über Resume.
