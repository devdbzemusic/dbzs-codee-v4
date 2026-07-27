"""ATIF-light trajectory event models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


TrajectoryEventType = Literal[
    "job_created",
    "loop_started",
    "step_started",
    "step_completed",
    "tool_call",
    "finding",
    "patch_proposed",
    "review_gate_created",
    "review_approved",
    "review_rejected",
    "auto_apply_checked",
    "error",
    "completed",
    "cancelled",
]

RiskLevel = Literal["none", "low", "medium", "high", "critical"]

ATIF_LIGHT_SCHEMA_VERSION = "atif-light-v1"


@dataclass
class TrajectoryEvent:
    id: str
    job_id: str
    step_number: int | None
    event_type: TrajectoryEventType
    agent_role: str | None
    model: str | None
    summary: str
    files: list[str] = field(default_factory=list)
    risk_level: RiskLevel | None = None
    metadata: dict = field(default_factory=dict)
    created_at: str = ""


@dataclass
class TrajectoryEventCreate:
    job_id: str
    event_type: TrajectoryEventType
    summary: str
    step_number: int | None = None
    agent_role: str | None = None
    model: str | None = None
    files: list[str] | None = None
    risk_level: RiskLevel | None = None
    metadata: dict | None = None


@dataclass
class TrajectoryEventListResponse:
    schema_version: str
    events: list[TrajectoryEvent]
