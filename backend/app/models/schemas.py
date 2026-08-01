from typing import Literal

from pydantic import BaseModel, Field


RecommendedUse = Literal[
    "primary_coding",
    "coding_candidate",
    "chat_candidate",
    "review_agent",
    "reranker",
    "embedding",
    "vision_candidate",
    "media_pipeline",
    "adapter_only",
    "orchestrator",
    "unsupported",
]


class ModelRuntimeHints(BaseModel):
    ctx: int | None = None
    gpu_layers: int | None = None
    server_enabled: bool = False
    preferred_port: int | None = None
    health_status: str = "unknown"
    provider: str = "llama.cpp"


class IndexedModel(BaseModel):
    id: str
    name: str
    path: str
    format: str
    artifact_type: str
    size_bytes: int
    size_gb: float
    quantization: str | None = None
    backend: str
    runtime_launcher: str
    capabilities: list[str]
    modality: list[str]
    role: str | None = None
    recommended_use: RecommendedUse
    compatibility: str
    runtime: ModelRuntimeHints
    # Additive overlay from Model Lab (backend/app/model_lab/), when a Model Lab
    # source/scan has richer health data for this exact file path (Plan 14,
    # Phase 0.2). None/empty when Model Lab has no matching entry - the runtime
    # index remains fully usable without Model Lab ever being initialized.
    model_lab_health_status: str | None = None
    model_lab_tags: list[str] = Field(default_factory=list)


class MultimodalPair(BaseModel):
    id: str
    base_model_id: str | None = None
    projector_artifact_id: str
    modalities: list[str] = Field(default_factory=list)
    source: str
    confidence: float
    status: str
    routing_allowed: bool = False
    candidate_base_model_ids: list[str] = Field(default_factory=list)


class ManualMultimodalPairingRequest(BaseModel):
    base_model_id: str
    projector_artifact_id: str


class ModelIndexSummary(BaseModel):
    models_dir: str
    runtime_dir: str | None = None
    ollama_dir: str | None = None
    ollama_models_dir: str | None = None
    total: int
    gguf_total: int
    ollama_total: int = 0
    llama_server_ready: int
    ollama_ready: int = 0
    coding_candidates: int
    vision_candidates: int
    adapters: int
    support_artifact_count: int = 0
    unsupported: int


class ModelIndex(BaseModel):
    generated_from: str
    summary: ModelIndexSummary
    models: list[IndexedModel]
    support_artifacts: list[IndexedModel] = Field(default_factory=list)
    multimodal_pairs: list[MultimodalPair] = Field(default_factory=list)
