from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


ArtifactType = Literal[
    "model",
    "mmproj",
    "adapter",
    "tokenizer",
    "config",
    "model_card",
    "ollama_manifest",
    "support",
]
ScanJobStatus = Literal["queued", "running", "completed", "failed"]
ModelLabStatus = Literal["DISCOVERED", "IDENTIFIED", "INCOMPLETE", "UNSUPPORTED", "BROKEN"]


class ModelHealth(BaseModel):
    status: Literal["healthy", "incomplete", "empty", "error", "unknown"] = "unknown"
    model_type: str = "Unbekannt"
    architecture: str | None = None
    parameters: int | None = None
    context_length: int | None = None
    quantization: str | None = None
    folder_size_bytes: int = 0
    config_files: list[str] = Field(default_factory=list)
    missing_critical: list[str] = Field(default_factory=list)
    optional_missing: list[str] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    config_preview: dict[str, Any] = Field(default_factory=dict)


class ModelSourceCreate(BaseModel):
    name: str | None = None
    path: str
    recursive: bool = True
    enabled: bool = True
    trusted: bool = False
    priority: int = 100
    include_patterns: list[str] = Field(default_factory=list)
    exclude_patterns: list[str] = Field(default_factory=list)


class ModelSource(ModelSourceCreate):
    id: str
    created_at: datetime
    updated_at: datetime
    last_scan_at: datetime | None = None
    last_scan_status: str | None = None
    last_error: str | None = None


class ModelArtifact(BaseModel):
    artifact_id: str
    installation_id: str
    source_id: str
    bundle_id: str | None = None
    path: str
    parent_path: str
    file_name: str
    detected_name: str
    format: str
    artifact_type: ArtifactType
    size_bytes: int
    sha256: str
    quantization: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: ModelLabStatus = "DISCOVERED"
    discovered_at: datetime
    updated_at: datetime


class ModelBundle(BaseModel):
    bundle_id: str
    name: str
    primary_artifact_id: str | None = None
    artifact_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    status: ModelLabStatus = "DISCOVERED"
    capabilities: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    health: ModelHealth = Field(default_factory=ModelHealth)
    tags: list[str] = Field(default_factory=list)
    is_favorite: bool = False
    notes: str = ""
    collection_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ModelLabModel(BaseModel):
    bundle: ModelBundle
    artifacts: list[ModelArtifact]


class ScanRequest(BaseModel):
    source_id: str | None = None


class ScanJob(BaseModel):
    id: str
    source_id: str | None = None
    status: ScanJobStatus
    total_files: int = 0
    artifact_count: int = 0
    bundle_count: int = 0
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


class ScanResult(BaseModel):
    job: ScanJob
    artifacts: list[ModelArtifact]
    bundles: list[ModelBundle]


class HardwareProfile(BaseModel):
    fingerprint_hash: str
    os: str
    architecture: str
    cpu_model: str | None = None
    cpu_threads: int
    ram_bytes: int
    gpu_name: str | None = None
    gpu_vendor: str | None = None
    vram_bytes: int | None = None
    runtime_backend: str
    collected_at: datetime


class ModelMetadataUpdate(BaseModel):
    tags: list[str] = Field(default_factory=list)
    is_favorite: bool = False
    notes: str = ""


class ModelCollectionCreate(BaseModel):
    name: str
    color: str = "#22D3EE"
    description: str = ""


class ModelCollection(ModelCollectionCreate):
    id: str
    created_at: datetime


class CollectionMembershipRequest(BaseModel):
    bundle_id: str


class DuplicateGroup(BaseModel):
    duplicate_key: str
    model_count: int
    total_size_bytes: int
    bundles: list[ModelBundle]


class HuggingFaceSearchResult(BaseModel):
    id: str
    pipeline: str = ""
    downloads: int = 0
    likes: int = 0
    size_mb: int = 0
    last_modified: str = ""
    tags: list[str] = Field(default_factory=list)


class HuggingFaceRepoFile(BaseModel):
    name: str
    size_bytes: int = 0


class HuggingFaceRepoInfo(BaseModel):
    id: str
    pipeline: str = ""
    tags: list[str] = Field(default_factory=list)
    files: list[HuggingFaceRepoFile] = Field(default_factory=list)



