from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def _camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)

TaskType = Literal["casual_chat", "normal_chat", "planning", "architecture", "small_code_change",
                   "large_code_change", "debugging", "review", "test_analysis", "refactoring",
                   "embedding", "reranking", "indexing"]
SlotId = Literal["quality_cpu", "fast_gpu", "utility"]
ItemKind = Literal["file", "symbol", "definition", "reference", "test", "config", "documentation",
                   "git_diff", "diagnostic", "memory", "tool_result"]


class ContextRequest(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _camel(value), populate_by_name=True, extra="forbid")
    task_id: str = Field(min_length=1, max_length=200)
    task_type: TaskType
    user_query: str = Field(min_length=1, max_length=10000)
    workspace_root: str = Field(min_length=1, max_length=600)
    active_file: str | None = None
    selected_files: list[str] = Field(default_factory=list)
    max_tokens: int = Field(ge=256, le=200000)
    model_id: str = Field(min_length=1, max_length=300)
    slot_id: SlotId


class ContextItem(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _camel(value), populate_by_name=True)
    id: str
    kind: ItemKind
    source_path: str | None = None
    symbol: str | None = None
    content: str
    relevance_score: float = Field(ge=0, le=1)
    freshness_score: float = Field(ge=0, le=1)
    trust_score: float = Field(ge=0, le=1)
    token_estimate: int = Field(ge=0)
    reasons: list[str]


class OmittedItem(BaseModel):
    id: str
    reason: str


class RetrievalTrace(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _camel(value), populate_by_name=True)
    id: str
    schema_version: int = 1
    strategy: list[str]
    candidate_count: int
    selected_count: int
    duplicate_count: int
    started_at: str
    completed_at: str
    gaps: list[str]


class ContextPack(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _camel(value), populate_by_name=True)
    schema_version: int = 1
    task_id: str
    items: list[ContextItem]
    total_tokens: int
    omitted_items: list[OmittedItem]
    summary: str
    retrieval_trace_id: str
    trace: RetrievalTrace


class RepositoryIndexRequest(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True, extra="forbid")
    workspace_root: str = Field(min_length=1, max_length=600)
