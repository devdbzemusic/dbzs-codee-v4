"""SSE event stream for agent runs."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.agent_workbench.service import get_agent_workbench_service

router = APIRouter(tags=["agent-workbench-sse"])

_POLL_INTERVAL = 0.5
_KEEPALIVE_INTERVAL = 15.0


def _event_to_sse(event: Any) -> str:
    payload = {
        "sequence": event.sequence,
        "id": event.id,
        "run_id": event.run_id,
        "step_id": event.step_id,
        "event_type": event.event_type,
        "severity": event.severity,
        "summary": event.summary,
        "payload": json.loads(event.payload_json or "{}"),
        "created_at": event.created_at,
    }
    data = json.dumps(payload, ensure_ascii=False)
    return f"id: {event.sequence}\nevent: agent_event\ndata: {data}\n\n"


@router.get("/runs/{run_id}/stream")
async def stream_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
) -> StreamingResponse:
    svc = get_agent_workbench_service()
    try:
        svc.get_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return StreamingResponse(
        _event_generator(run_id, after_sequence),
        media_type="text/event-stream",
    )


async def _event_generator(run_id: str, after_sequence: int):
    svc = get_agent_workbench_service()
    cursor = after_sequence
    last_keepalive = time.monotonic()

    while True:
        events = svc.list_events(run_id, after_sequence=cursor)
        for event in events:
            cursor = event.sequence
            yield _event_to_sse(event)

        run = svc.get_run(run_id)
        if run.status in {"completed", "cancelled", "failed"} and not events:
            final = svc.list_events(run_id, after_sequence=cursor)
            for event in final:
                cursor = event.sequence
                yield _event_to_sse(event)
            break

        now = time.monotonic()
        if now - last_keepalive >= _KEEPALIVE_INTERVAL:
            yield ": heartbeat\n\n"
            last_keepalive = now

        await asyncio.sleep(_POLL_INTERVAL)
