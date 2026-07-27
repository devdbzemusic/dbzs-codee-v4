from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


JobStatus = Literal[
    "queued",
    "claimed",
    "running",
    "waiting_verification",
    "completed",
    "failed",
    "cancelled",
]

WaypointType = Literal[
    "submitted",
    "claimed",
    "assigned",
    "started",
    "progress",
    "checkpoint",
    "waiting_verification",
    "verification_passed",
    "verification_failed",
    "completed",
    "failed",
    "requeued",
]

ArtifactKind = Literal["input", "intermediate", "output", "log", "evidence"]
VerificationVerdict = Literal["passed", "failed"]


class JobRecord(BaseModel):
    id: str
    title: str
    task_type: str
    priority: int
    status: JobStatus
    assigned_agent_role: str | None
    assigned_worker: str | None
    attempt_count: int
    max_attempts: int
    lease_expires_at: str | None
    input_payload: dict[str, Any]
    output_payload: dict[str, Any] | None
    error_message: str | None
    created_at: str
    updated_at: str
    completed_at: str | None


class JobEvent(BaseModel):
    id: int
    job_id: str
    worker_id: str | None
    waypoint: WaypointType
    message: str
    progress: int | None
    metadata: dict[str, Any]
    created_at: str


class JobArtifact(BaseModel):
    id: int
    job_id: str
    worker_id: str | None
    kind: ArtifactKind
    name: str
    content: str
    metadata: dict[str, Any]
    created_at: str


class JobVerification(BaseModel):
    id: int
    job_id: str
    worker_id: str
    verdict: VerificationVerdict
    reranker_score: float | None
    reason: str
    evidence: dict[str, Any]
    created_at: str


class JobDetail(BaseModel):
    job: JobRecord
    events: list[JobEvent]
    artifacts: list[JobArtifact]
    verifications: list[JobVerification]


class JobEnqueueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=2, max_length=220)
    task_type: str = Field(default="generic", min_length=2, max_length=80)
    priority: int = Field(default=3, ge=1, le=5)
    assigned_agent_role: str | None = Field(default=None, min_length=2, max_length=80)
    input_payload: dict[str, Any] = Field(default_factory=dict)
    max_attempts: int = Field(default=3, ge=1, le=10)


class JobClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=2, max_length=120)
    supported_roles: list[str] = Field(default_factory=list, max_length=64)
    lease_seconds: int = Field(default=120, ge=30, le=3600)


class JobClaimResponse(BaseModel):
    job: JobRecord | None


class JobHeartbeatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=2, max_length=120)
    lease_seconds: int = Field(default=120, ge=30, le=3600)


class JobWaypointRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=2, max_length=120)
    waypoint: WaypointType
    message: str = Field(default="", max_length=4000)
    progress: int | None = Field(default=None, ge=0, le=100)
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobArtifactCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str | None = Field(default=None, min_length=2, max_length=120)
    kind: ArtifactKind
    name: str = Field(min_length=2, max_length=180)
    content: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=2, max_length=120)
    verdict: VerificationVerdict
    reranker_score: float | None = Field(default=None, ge=0, le=1)
    reason: str = Field(default="", max_length=4000)
    evidence: dict[str, Any] = Field(default_factory=dict)


class JobCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=2, max_length=120)
    output_payload: dict[str, Any] = Field(default_factory=dict)
    summary: str = Field(default="", max_length=4000)


class JobFailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=2, max_length=120)
    error_message: str = Field(min_length=2, max_length=4000)
