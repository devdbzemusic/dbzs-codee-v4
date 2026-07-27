"""SSE live-stream for job-spooler events."""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.job_spooler.service import JobSpoolerService

router = APIRouter(prefix="/job-spooler", tags=["job-spooler-sse"])

_svc = JobSpoolerService()
_POLL_INTERVAL = 0.5
_KEEPALIVE_INTERVAL = 15.0


@router.get("/stream")
async def stream_job_events() -> StreamingResponse:
    return StreamingResponse(_event_generator(), media_type="text/event-stream")


async def _event_generator():
    last_seen: dict[str, str] = {}
    last_keepalive = time.monotonic()

    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        now = time.monotonic()

        try:
            jobs = _svc.list_jobs(limit=50)
        except Exception:
            # Bei DB-Problemen einfach im nächsten Zyklus versuchen
            continue

        for job in jobs:
            prev_status = last_seen.get(job.id)
            if prev_status != job.status:
                last_seen[job.id] = job.status
                payload = json.dumps({
                    "type": "job_updated",
                    "job": {
                        "id": job.id,
                        "title": job.title,
                        "status": job.status,
                        "assigned_agent_role": job.assigned_agent_role,
                        "priority": job.priority,
                        "created_at": job.created_at,
                        "updated_at": job.updated_at,
                    },
                })
                try:
                    yield f"data: {payload}\n\n"
                except GeneratorExit:
                    # Expliziter Abbruch des Generators durch FastAPI/StreamingResponse
                    raise
                except Exception:
                    # Wenn Senden fehlschlägt, ist die Verbindung abgebrochen -> Schleife beenden
                    return

        if now - last_keepalive >= _KEEPALIVE_INTERVAL:
            try:
                yield ": keepalive\n\n"
            except GeneratorExit:
                raise
            except Exception:
                return
            last_keepalive = now
