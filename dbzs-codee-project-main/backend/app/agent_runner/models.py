"""Agent job runner — connects Job Spooler and Orchestration."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AgentRunnerState = Literal["idle", "running", "failed"]


class AgentPatchProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_path: str = Field(min_length=1, max_length=600)
    proposed_content: str = Field(min_length=1)
    summary: str = Field(default="", max_length=2000)


class AgentRunOnceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=2, max_length=120)
    workspace_root: str | None = Field(default=None, max_length=600)
    supported_roles: list[str] = Field(default_factory=lambda: ["coder", "planner", "reviewer"])


class AgentRunResult(BaseModel):
    state: AgentRunnerState
    agent_id: str
    job_id: str | None = None
    message: str
    artifacts: list[str] = Field(default_factory=list)
    patch_proposals: list[AgentPatchProposal] = Field(default_factory=list)
    llm_skipped: bool = False


class AgentRunnerStatus(BaseModel):
    state: AgentRunnerState
    agent_id: str | None = None
    last_job_id: str | None = None
    last_message: str = ""
    last_run_at: str | None = None
