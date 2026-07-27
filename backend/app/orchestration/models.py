from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class UiLayoutContext(BaseModel):
    left_panel_collapsed: bool = False
    right_panel_collapsed: bool = False
    terminal_collapsed: bool = False
    bottom_panel: str | None = None


class WorkspaceContextSnapshot(BaseModel):
    root_path: str | None = None
    project_name: str | None = None
    active_file_path: str | None = None
    indexed_file_count: int = 0


class ContextPrepareRequest(BaseModel):
    user_request: str = Field(min_length=1, max_length=6000)
    ui: UiLayoutContext = Field(default_factory=UiLayoutContext)
    workspace: WorkspaceContextSnapshot = Field(default_factory=WorkspaceContextSnapshot)


class ToolCapability(BaseModel):
    id: str
    category: str
    description: str
    scopes: list[str] = Field(default_factory=list)
    enabled: bool = True


class OrchestrationWorkItem(BaseModel):
    id: str
    role: str
    objective: str
    depends_on: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)


class ContextPrepareResponse(BaseModel):
    intent_summary: str
    decomposition_steps: list[str]
    context_hints: list[str]
    suggested_agents: list[str]
    work_items: list[OrchestrationWorkItem]
    tool_capabilities: list[ToolCapability]


class ToolCatalogResponse(BaseModel):
    tools: list[ToolCapability]


ToolExecutionScope = Literal["read", "write", "network", "vision"]


class ToolExecutionRequest(BaseModel):
    tool_id: str = Field(min_length=3, max_length=120)
    scope: ToolExecutionScope
    workspace_root: str | None = None
    params: dict[str, str | int | bool | None] = Field(default_factory=dict)


class ToolExecutionResponse(BaseModel):
    tool_id: str
    scope: ToolExecutionScope
    status: Literal["ok", "error"]
    message: str
    output: dict[str, str | int | bool | None | list[str]] = Field(default_factory=dict)
