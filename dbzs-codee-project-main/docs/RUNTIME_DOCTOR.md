# Runtime Doctor

Phase 1B liefert strukturierte Runtime-Diagnose ohne Auto-Start. Phase 0.4 macht den Doctor in **Mission Control** bedienbar.

## Endpoints

- `GET /runtime/doctor` — checks, model entries (provider, compatibility, runnable), suggested profiles
- `POST /runtime/doctor/dry-run` — command preview for a model id
- `POST /runtime/doctor/probe` — disabled unless `allow_start: true`; returns structured `stderr_tail` / `stdout_tail` on failure
- `GET /runtime/logs` — current runtime process stderr/stdout tail

## Endpoint warmup

Runtime start waits for the first successful response on:

1. `{endpoint}/`
2. `{endpoint}/health`
3. `{endpoint}/v1/models`

## Suggested profiles

- `safe_cpu_coder` — gpu_layers 0, ctx 4096, threads 6
- `hybrid_gtx1650_coder` — conservative GPU layers for 4 GB VRAM
- `tiny_review_agent` — low context review preset

Profiles are suggestions only; nothing is started automatically.

## Mission Control UI

In **DBZS Codee Mission Control** (`RuntimeDoctorSection`):

- System checks from `GET /runtime/doctor`
- Per-model cards: provider, runtime_launcher, format, compatibility, blockers, warnings, command_preview
- Actions: **Dry Run**, **Probe Start**, **Start Runtime**, **Stop Runtime**
- Result panel with dry-run command preview and stderr on failure
- **Logs aktualisieren** → `GET /runtime/logs`

Golden Path: Dry Run → Probe → Start → Runtime Chat.

## PowerShell smoke

```powershell
Invoke-RestMethod http://127.0.0.1:8876/runtime/doctor
Invoke-RestMethod http://127.0.0.1:8876/runtime/logs
```

See [`LOCAL_ACCEPTANCE.md`](LOCAL_ACCEPTANCE.md) for the full acceptance sequence.
