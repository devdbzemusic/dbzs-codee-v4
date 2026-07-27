from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ContextPackBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_root: str = Field(min_length=1, max_length=600)
    user_request: str = Field(min_length=1, max_length=6000)
    active_file_path: str | None = Field(default=None, max_length=600)
    tokenizer_slot_id: str | None = Field(default=None, max_length=32)
    target_token_budget: int = Field(default=6000, ge=256, le=60000)
    max_files: int = Field(default=80, ge=1, le=500)
    max_bytes_per_file: int = Field(default=20000, ge=256, le=200000)
    repo_map_token_budget: int = Field(default=12000, ge=1000, le=60000)


class RepoMapSymbol(BaseModel):
    name: str
    kind: str
    line: int


class RepoMapFile(BaseModel):
    path: str
    language: str
    size_bytes: int
    imports: list[str] = Field(default_factory=list)
    exports: list[str] = Field(default_factory=list)
    symbols: list[RepoMapSymbol] = Field(default_factory=list)
    is_test: bool = False
    is_config: bool = False
    truncated: bool = False


class RepoMap(BaseModel):
    root_name: str
    files: list[RepoMapFile]
    entry_points: list[str]
    config_files: list[str]
    test_files: list[str]
    git_status: list[str]
    token_budget: int
    estimated_tokens: int
    truncated: bool = False


class ContextPackBuildResponse(BaseModel):
    project_name: str
    detected_stack: list[str]
    important_files: list[str]
    package_files: list[str]
    test_files: list[str]
    source_files_sample: list[str]
    todo_markers: list[str]
    risk_notes: list[str]
    recommended_commands: list[str]
    markdown_context: str
    repo_map: RepoMap
    metadata: dict[str, Any] = Field(default_factory=dict)


# Model Context Cache (Phase 3)
ContextCacheRole = Literal["chat", "coding", "review", "plan", "debug"]


class ContextSection(BaseModel):
    type: str
    source: str
    token_count: int
    priority: int
    cached: bool = False
    truncated: bool = False


class ContextCacheLookupRequest(BaseModel):
    model_id: str
    role: ContextCacheRole
    workspace_id: str
    system_prompt_hash: str
    tool_contract_hash: str
    project_memory_hash: str
    architecture_hash: str | None = None
    agents_file_hash: str | None = None
    workspace_hash: str = ""
    branch: str = ""
    file_hash: str = ""
    task_type: str = ""
    query_fingerprint: str = ""
    context_schema_version: int = 1


class ContextCacheInvalidateRequest(BaseModel):
    workspace_id: str
    changed_hash_field: str
    new_hash: str


class ContextCacheInvalidateResponse(BaseModel):
    invalidated: list[str]


class ModelContextCacheEntry(BaseModel):
    """A cached, hash-keyed assembly of the mostly-static parts of a prompt
    (system prompt, tool contracts, AGENTS.md, project memory, ...) so they
    don't need to be rebuilt/re-tokenized on every request. Invalidation is
    hash-based (any relevant source changed -> different hash -> cache miss),
    not just a TTL.
    """
    key: str
    model_id: str
    role: ContextCacheRole
    workspace_id: str
    system_prompt_hash: str
    tool_contract_hash: str
    project_memory_hash: str
    architecture_hash: str | None = None
    agents_file_hash: str | None = None
    workspace_hash: str = ""
    branch: str = ""
    file_hash: str = ""
    task_type: str = ""
    query_fingerprint: str = ""
    context_schema_version: int = 1
    token_count: int
    sections: list[ContextSection] = Field(default_factory=list)
    created_at: str
    last_used_at: str
    expires_at: str | None = None


class PersistentContextFragment(BaseModel):
    fragment_id: str
    fragment_type: str
    source: str
    content_text: str
    token_count: int
    priority: int = 0
    pinned: bool = False
    created_at: str
    last_used_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class PersistentContextSnapshotSummary(BaseModel):
    snapshot_id: str
    workspace_id: str
    cache_key: str | None = None
    source: str
    token_count: int
    fragment_count: int
    model_id: str | None = None
    role: ContextCacheRole | None = None
    task_type: str = ""
    query_fingerprint: str = ""
    created_at: str
    summary: dict[str, Any] = Field(default_factory=dict)


class PersistentContextSnapshot(PersistentContextSnapshotSummary):
    fragments: list[PersistentContextFragment] = Field(default_factory=list)
