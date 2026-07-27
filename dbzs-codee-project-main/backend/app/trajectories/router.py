"""ATIF-light trajectory API router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.trajectories.models import ATIF_LIGHT_SCHEMA_VERSION, TrajectoryEventCreate
from app.trajectories.service import get_trajectory_service

router = APIRouter(prefix="/trajectories", tags=["trajectories"])
_service = get_trajectory_service()


class TrajectoryEventCreateBody(BaseModel):
    job_id: str
    event_type: str
    summary: str
    step_number: int | None = None
    agent_role: str | None = None
    model: str | None = None
    files: list[str] = Field(default_factory=list)
    risk_level: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def _serialize_event(event) -> dict[str, Any]:
    return {
        "schema_version": ATIF_LIGHT_SCHEMA_VERSION,
        "id": event.id,
        "job_id": event.job_id,
        "step_number": event.step_number,
        "event_type": event.event_type,
        "agent_role": event.agent_role,
        "model": event.model,
        "summary": event.summary,
        "files": event.files,
        "risk_level": event.risk_level,
        "metadata": event.metadata,
        "created_at": event.created_at,
    }


@router.post("/events")
def record_event(body: TrajectoryEventCreateBody):
    request = TrajectoryEventCreate(
        job_id=body.job_id,
        event_type=body.event_type,  # type: ignore[arg-type]
        summary=body.summary,
        step_number=body.step_number,
        agent_role=body.agent_role,
        model=body.model,
        files=body.files,
        risk_level=body.risk_level,  # type: ignore[arg-type]
        metadata=body.metadata,
    )
    event = _service.record_event(request)
    return {"event": _serialize_event(event)}


@router.get("/jobs/{job_id}")
def list_job_events(job_id: str):
    events = _service.list_events_for_job(job_id)
    return {
        "schema_version": ATIF_LIGHT_SCHEMA_VERSION,
        "events": [_serialize_event(event) for event in events],
    }


@router.get("/recent")
def list_recent_events(limit: int = 100):
    events = _service.list_recent_events(limit=limit)
    return {
        "schema_version": ATIF_LIGHT_SCHEMA_VERSION,
        "events": [_serialize_event(event) for event in events],
    }
