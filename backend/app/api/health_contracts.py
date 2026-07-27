from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


BootComponentState = Literal[
    "pending",
    "waiting",
    "running",
    "success",
    "warning",
    "failed",
    "retrying",
    "blocked",
    "skipped",
]

BootRunStatus = Literal["starting", "ready", "degraded", "failed"]


class BootComponentErrorModel(BaseModel):
    code: str
    technicalDetail: str | None = None
    exitCode: int | None = None
    stderrTail: str | None = None


class BootReadinessComponentModel(BaseModel):
    state: BootComponentState
    progress: float | None = None
    total: float | None = None
    message: str | None = None
    error: BootComponentErrorModel | None = None
    data: dict[str, object] | None = None


class ResidentModelDataModel(BaseModel):
    modelId: str
    modelName: str | None = None
    slotId: str | None = None
    provider: str | None = None
    pid: int | None = None
    port: int | None = None


class BootStartupResponseModel(BaseModel):
    status: BootRunStatus
    ready: bool
    progress: int
    instanceId: str
    components: dict[str, BootReadinessComponentModel]


class BootReadyResponseModel(BaseModel):
    status: BootRunStatus
    ready: bool
    instanceId: str
    requiredComponents: dict[str, BootComponentState] | None = None
    optionalComponents: dict[str, BootComponentState] | None = None
