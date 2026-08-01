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
ModelLabStatus = Literal[
    "DISCOVERED",
    "IDENTIFIED",
    "INCOMPLETE",
    "COMPATIBLE",
    "LOADABLE",
    "TUNED",
    "BENCHMARKED",
    "CERTIFIED",
    "DEGRADED",
    "QUARANTINED",
    "UNSUPPORTED",
    "BROKEN",
]
ModelFleetRole = Literal[
    "MAIN_AGENT",
    "DEEP_RESEARCH_AGENT",
    "FAST_GENERAL_AGENT",
    "MICRO_TOOL_AGENT",
    "CODING_EXECUTOR",
    "ALGORITHM_SPECIALIST",
    "REASONING_VALIDATOR",
    "REPORT_GENERATOR",
]
ModelFleetSafetyLevel = Literal[
    "LEVEL_0_CHAT_ONLY",
    "LEVEL_1_READ_ONLY_TOOLS",
    "LEVEL_2_WORKSPACE_WRITE",
    "LEVEL_3_TERMINAL_LIMITED",
    "LEVEL_4_SHELL_AND_GIT",
]
ModelFleetCertificationKind = Literal[
    "CHAT_VERIFIED",
    "INSTRUCTION_FOLLOWING_VERIFIED",
    "STRUCTURED_OUTPUT_VERIFIED",
    "TOOL_CALLING_VERIFIED",
    "READ_ONLY_AGENT_VERIFIED",
    "WRITE_AGENT_VERIFIED",
    "CODING_VERIFIED",
    "REPOSITORY_QA_VERIFIED",
    "DEEP_RESEARCH_VERIFIED",
    "LONG_HORIZON_VERIFIED",
    "REPORT_GENERATION_VERIFIED",
    "GPU_PROFILE_VERIFIED",
]
ModelFleetRunStatus = Literal["queued", "running", "passed", "failed", "skipped"]


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


class ModelSourceCandidate(BaseModel):
    path: str
    label: str
    exists: bool
    recommended: bool = False
    reason: str = ""
    already_registered: bool = False


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
    all_sources: bool = False


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
    progress_message: str | None = None
    progress_events: list[dict[str, Any]] = Field(default_factory=list)


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


class HardwareSnapshot(BaseModel):
    id: str
    fingerprint_hash: str
    payload: HardwareProfile
    created_at: datetime


class ModelFleetRequestEnvelope(BaseModel):
    request_id: str
    operation: str
    started_at: datetime
    timeout_policy: dict[str, int] = Field(default_factory=dict)
    cancellation: dict[str, Any] = Field(default_factory=dict)


class LogicalModel(BaseModel):
    logical_model_id: str
    display_name: str
    family: str
    architecture: str | None = None
    primary_bundle_id: str | None = None
    bundle_ids: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    status: ModelLabStatus = "DISCOVERED"
    created_at: datetime
    updated_at: datetime


class ModelVariant(BaseModel):
    variant_id: str
    logical_model_id: str
    bundle_id: str
    primary_artifact_id: str | None = None
    display_name: str
    format: str | None = None
    quantization: str | None = None
    parameter_count: int | None = None
    context_length: int | None = None
    size_bytes: int = 0
    capabilities: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    status: ModelLabStatus = "DISCOVERED"
    created_at: datetime
    updated_at: datetime


class RuntimeAdapterRecord(BaseModel):
    id: str
    name: str
    priority: int
    enabled: bool = True
    supported_formats: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class RuntimePresetRecord(BaseModel):
    id: str
    name: str
    adapter_id: str
    bundle_id: str | None = None
    profile: str
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ModelProbeRequest(BaseModel):
    bundle_id: str
    adapter_id: str = "llama.cpp"
    allow_start: bool = False
    envelope: ModelFleetRequestEnvelope | None = None
    runtime_options: dict[str, Any] = Field(default_factory=dict)


class ModelProbeRun(BaseModel):
    id: str
    bundle_id: str
    adapter_id: str
    status: ModelFleetRunStatus
    allow_start: bool
    message: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    started_at: datetime
    completed_at: datetime | None = None


class ModelBenchmarkRequest(BaseModel):
    bundle_id: str
    adapter_id: str = "llama.cpp"
    profile: str = "safe_balanced"
    metrics: dict[str, Any] = Field(default_factory=dict)
    envelope: ModelFleetRequestEnvelope | None = None


class ModelBenchmarkRun(BaseModel):
    id: str
    bundle_id: str
    adapter_id: str
    profile: str
    status: ModelFleetRunStatus
    measurements: dict[str, Any] = Field(default_factory=dict)
    message: str = ""
    started_at: datetime
    completed_at: datetime | None = None


class ModelBenchmarkMeasurement(BaseModel):
    id: str
    benchmark_run_id: str
    name: str
    value: float
    unit: str
    created_at: datetime


class ModelCertificationRequest(BaseModel):
    bundle_id: str
    certification: ModelFleetCertificationKind
    status: Literal["passed", "failed", "revoked"] = "passed"
    evidence: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    envelope: ModelFleetRequestEnvelope | None = None


class ModelCertificationRecord(BaseModel):
    id: str
    bundle_id: str
    certification: ModelFleetCertificationKind
    status: Literal["passed", "failed", "revoked"]
    evidence: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    created_at: datetime
    updated_at: datetime


class ModelCapabilityEvidenceRequest(BaseModel):
    bundle_id: str
    capability: str
    status: Literal["observed", "verified", "failed", "revoked"] = "observed"
    evidence: dict[str, Any] = Field(default_factory=dict)


class ModelCapabilityEvidenceRecord(BaseModel):
    id: str
    bundle_id: str
    capability: str
    status: Literal["observed", "verified", "failed", "revoked"]
    evidence: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ModelRoleAssignmentRequest(BaseModel):
    bundle_id: str
    role: ModelFleetRole
    safety_level: ModelFleetSafetyLevel = "LEVEL_0_CHAT_ONLY"
    enabled: bool = True
    priority: int = 100
    notes: str = ""
    envelope: ModelFleetRequestEnvelope | None = None


class ModelRoleAssignment(BaseModel):
    id: str
    bundle_id: str
    role: ModelFleetRole
    safety_level: ModelFleetSafetyLevel
    enabled: bool
    priority: int
    required_certifications: list[ModelFleetCertificationKind] = Field(default_factory=list)
    notes: str = ""
    created_at: datetime
    updated_at: datetime


class ModelExecutionPolicy(BaseModel):
    role: ModelFleetRole
    max_safety_level: ModelFleetSafetyLevel
    required_certifications: list[ModelFleetCertificationKind] = Field(default_factory=list)
    updated_at: datetime


class ModelFleetRoutingEntry(BaseModel):
    role: ModelFleetRole
    bundle_id: str
    bundle_name: str
    safety_level: ModelFleetSafetyLevel
    enabled: bool
    priority: int
    bundle_status: ModelLabStatus
    capabilities: list[str] = Field(default_factory=list)
    modalities: list[str] = Field(default_factory=list)
    required_certifications: list[ModelFleetCertificationKind] = Field(default_factory=list)
    passed_certifications: list[ModelFleetCertificationKind] = Field(default_factory=list)
    missing_certifications: list[ModelFleetCertificationKind] = Field(default_factory=list)
    routing_allowed: bool
    notes: str = ""
    updated_at: datetime


class ModelFailureRecord(BaseModel):
    id: str
    bundle_id: str | None = None
    artifact_id: str | None = None
    operation: str
    severity: Literal["info", "warning", "error", "critical"] = "error"
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ModelFleetSummary(BaseModel):
    logical_models: list[LogicalModel]
    variants: list[ModelVariant]
    runtime_adapters: list[RuntimeAdapterRecord]
    runtime_presets: list[RuntimePresetRecord]
    probe_runs: list[ModelProbeRun]
    benchmark_runs: list[ModelBenchmarkRun]
    benchmark_measurements: list[ModelBenchmarkMeasurement] = Field(default_factory=list)
    capability_evidence: list[ModelCapabilityEvidenceRecord] = Field(default_factory=list)
    certifications: list[ModelCertificationRecord]
    role_assignments: list[ModelRoleAssignment]
    execution_policies: list[ModelExecutionPolicy] = Field(default_factory=list)
    routing_map: list[ModelFleetRoutingEntry] = Field(default_factory=list)
    failures: list[ModelFailureRecord]


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



