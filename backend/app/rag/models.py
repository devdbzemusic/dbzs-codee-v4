"""DBZS – API-Modelle für Workspace-RAG, Embedding Cache und Execution Trace."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

Intent = Literal["chat", "coding", "review", "planning", "debugging", "documentation"]


class IndexSyncRequest(BaseModel):
    workspace_root: str
    changed_paths: list[str] = Field(default_factory=list)
    reason: str = "manual"
    force: bool = False


class RetrievalQuery(BaseModel):
    id: str
    workspace_id: str
    workspace_root: str | None = None
    query: str
    intent: Intent
    active_file_path: str | None = None
    mentioned_paths: list[str] = Field(default_factory=list)
    mentioned_symbols: list[str] = Field(default_factory=list)
    max_candidates: int = Field(default=30, ge=1, le=100)
    max_final_items: int = Field(default=5, ge=1, le=20)
    token_budget: int = Field(default=1800, ge=64, le=100_000)
    created_at: str
    query_embedding: list[float] | None = None
    embedding_model_id: str | None = None


class EmbeddingUpsert(BaseModel):
    source_id: str
    content_hash: str
    embedding_model_id: str
    vector: list[float] = Field(min_length=1)
    token_count: int = Field(ge=0)


class EmbeddingUpsertBody(BaseModel):
    entries: list[EmbeddingUpsert]


class EmbeddingCacheProbe(BaseModel):
    source_id: str
    content_hash: str


class EmbeddingCacheProbeBody(BaseModel):
    embedding_model_id: str
    entries: list[EmbeddingCacheProbe]


class TraceEventBody(BaseModel):
    id: str
    message_id: str | None = None
    kind: str
    title: str
    summary: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    source_refs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: int | None = None


class TraceEventsBody(BaseModel):
    events: list[TraceEventBody]
