"""SSE live-stream of backend boot log events for the desktop splash screen.

Mirrors the existing poll-based generator pattern in
app/job_spooler/sse_router.py — no new dependency, same precedent. The
desktop bootEventBridge only subscribes once phase 6 (backend-health-live)
has succeeded, since this endpoint is naturally unavailable before the
process is serving at all.
"""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.boot_state import get_boot_state_store

router = APIRouter(prefix="/boot", tags=["boot"])

_POLL_INTERVAL = 0.5
_KEEPALIVE_INTERVAL = 15.0


@router.get("/stream")
async def stream_boot_events() -> StreamingResponse:
    return StreamingResponse(_event_generator(), media_type="text/event-stream")


async def _event_generator():
    store = get_boot_state_store()
    cursor = 0
    last_keepalive = time.monotonic()

    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        now = time.monotonic()

        entries, cursor = store.logs_since(cursor)
        for entry in entries:
            payload = json.dumps(entry)
            try:
                yield f"data: {payload}\n\n"
            except GeneratorExit:
                raise
            except Exception:
                return

        if now - last_keepalive >= _KEEPALIVE_INTERVAL:
            try:
                yield ": keepalive\n\n"
            except GeneratorExit:
                raise
            except Exception:
                return
            last_keepalive = now
