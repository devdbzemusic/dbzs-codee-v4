from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


TaskStatus = Literal["todo", "in_progress", "done"]


class TaskBoardItem(BaseModel):
    id: str
    title: str
    description: str
    status: TaskStatus
    priority: int
    created_at: str
    updated_at: str
    job_ids: list[str] = Field(default_factory=list)


class TaskJobLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(min_length=1, max_length=64)


class TaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default="", max_length=8_000)
    priority: int = Field(default=3, ge=1, le=5)


class TaskUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=8_000)
    status: TaskStatus | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
