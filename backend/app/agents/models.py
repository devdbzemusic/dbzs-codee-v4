from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AgentRuntimeState = Literal["stopped", "running", "error"]
AgentLogLevel = Literal["info", "warning", "error"]
AgentRole = Literal["planner", "coder", "tester", "reviewer", "debugger", "docs"]


class AgentHealthInfo(BaseModel):
    agent_id: str
    pid: int | None
    state: AgentRuntimeState
    uptime_seconds: float | None
    error_count_1h: int
    last_log: str | None
    last_log_at: str | None


class AgentExecutionStatus(BaseModel):
    state: AgentRuntimeState = "stopped"
    pid: int | None = None
    message: str = ""
    updated_at: str


class AgentLogEntry(BaseModel):
    id: int
    agent_id: str
    level: AgentLogLevel
    message: str
    created_at: str


class AgentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=2, max_length=120)
    role: AgentRole = "coder"
    description: str = Field(default="", max_length=1024)
    command: str = Field(min_length=1, max_length=260)
    args: list[str] = Field(default_factory=list)
    cwd: str | None = None
    enabled: bool = True
    max_job_attempts: int = Field(default=3, ge=1, le=20)
    created_at: str
    updated_at: str
    status: AgentExecutionStatus


class AgentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=2, max_length=120)
    role: AgentRole = "coder"
    description: str = Field(default="", max_length=1024)
    command: str = Field(min_length=1, max_length=260)
    args: list[str] = Field(default_factory=list)
    cwd: str | None = None
    enabled: bool = True
    max_job_attempts: int = Field(default=3, ge=1, le=20)


class AgentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=120)
    role: AgentRole | None = None
    description: str | None = Field(default=None, max_length=1024)
    command: str | None = Field(default=None, min_length=1, max_length=260)
    args: list[str] | None = None
    cwd: str | None = None
    enabled: bool | None = None
    max_job_attempts: int | None = Field(default=None, ge=1, le=20)
