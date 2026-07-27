"""
Model Server Profiles: Task-based orchestration configurations for multi-model workloads.
Profiles define which models to use for which tasks, with resource constraints and affinity rules.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.models.schemas import ModelIndex, IndexedModel

TaskType = Literal[
    "chat",
    "review",
    "code_review",
    "coding",
    "translation",
    "reranker",
    "doc_analysis",
    "planning",
    "general",
]
HardwareClass = Literal["entry", "mid", "high"]


class GPUConfig(BaseModel):
    """GPU acceleration settings for a model instance."""
    n_gpu_layers: int = Field(default=0, description="Number of layers to offload to GPU. 0 = CPU only.")
    n_threads: int = Field(default=4, description="Number of CPU threads for fallback/hybrid compute.")
    batch_size: int = Field(default=32, description="Batch size for processing.")


class ContextConfig(BaseModel):
    """Context and memory settings for a model instance."""
    context_size: int = Field(default=2048, description="Context window size in tokens.")
    cache_size_mb: int = Field(default=512, description="KV cache size in MB.")
    max_response_tokens: int = Field(default=1024, description="Maximum response tokens.")


class ModelInstance(BaseModel):
    """A single model instance in a server group."""
    model_id: str
    model_name: str
    provider: Literal["llama.cpp", "ollama"] = "llama.cpp"
    port: int
    gpu_config: GPUConfig
    context_config: ContextConfig
    task_affinity: list[TaskType] = Field(default_factory=lambda: ["general"])
    priority: int = Field(default=5, ge=1, le=10, description="Priority for task routing (1=lowest, 10=highest).")


class ServerProfile(BaseModel):
    """
    A server profile groups multiple models for coordinated startup and task routing.
    Profiles are optimized for specific hardware classes and workload patterns.
    """
    name: str = Field(..., description="Profile name (e.g., 'chat-focused', 'heavy-compute', 'balanced').")
    hardware_class: HardwareClass = "mid"
    description: str = ""
    
    # Model instances in this profile
    models: list[ModelInstance] = Field(default_factory=list, description="Models to start in this profile.")
    
    # Global resource constraints
    max_total_gpu_memory_mb: int = Field(default=8192, description="Total GPU memory budget for all models in MB.")
    max_total_vram_usage_mb: int = Field(default=16384, description="Total VRAM usage in MB.")
    cpu_thread_pool_size: int = Field(default=8, description="Global CPU thread pool for all models.")
    
    # Workload prioritization
    default_task_type: TaskType = "general"
    
    # Auto-restart and fallback
    auto_restart_on_error: bool = True
    fallback_to_cpu: bool = True
    
    # Monitoring thresholds
    monitoring_enabled: bool = True
    cpu_threshold_percent: float = 80.0
    memory_threshold_percent: float = 85.0


class ModelProfilesConfig(BaseModel):
    """Global model profiles configuration."""
    profiles: dict[str, ServerProfile] = Field(default_factory=dict, description="Named server profiles.")
    active_profile: str | None = None
    hardware_class: HardwareClass = "mid"


def get_default_profiles() -> dict[str, ServerProfile]:
    """
    Generate default profiles for different hardware classes and workload patterns.
    These are starting points; adjust for your specific hardware.
    """
    return {
        # NVIDIA-GPU-CPU: Parallel hybrid execution (GTX 1650 SUPER + CPU)
        "nvidia-gpu-cpu": ServerProfile(
            name="nvidia-gpu-cpu",
            hardware_class="mid",
            description="Parallel CPU/GPU execution: Fast 2B on NVIDIA GPU, Qwen 7B Coder on CPU.",
            models=[
                ModelInstance(
                    model_id="qwen-2b",
                    model_name="Qwen2.5-1.5B-Instruct",
                    port=8081,
                    gpu_config=GPUConfig(n_gpu_layers=99, n_threads=4, batch_size=32),
                    context_config=ContextConfig(context_size=8192, cache_size_mb=1024, max_response_tokens=1024),
                    task_affinity=["chat", "general"],
                    priority=6,
                ),
                ModelInstance(
                    model_id="coder",
                    model_name="Qwen2.5-Coder-7B-Instruct",
                    port=8082,
                    gpu_config=GPUConfig(n_gpu_layers=0, n_threads=6, batch_size=16),
                    context_config=ContextConfig(context_size=8192, cache_size_mb=2048, max_response_tokens=2048),
                    task_affinity=["code_review", "coding"],
                    priority=8,
                ),
            ],
            max_total_gpu_memory_mb=4096,
            max_total_vram_usage_mb=4096,
            cpu_thread_pool_size=8,
            default_task_type="chat",
        ),
        # CHAT-FOCUSED: Fast response, low latency. Good for interactive chat/coding assistance.

        "chat-focused": ServerProfile(
            name="chat-focused",
            hardware_class="mid",
            description="Fast response chat and code assistance with low latency.",
            models=[
                ModelInstance(
                    model_id="phi3-mini",
                    model_name="Phi-3-mini-4k",
                    port=8001,
                    gpu_config=GPUConfig(n_gpu_layers=40, n_threads=4, batch_size=32),
                    context_config=ContextConfig(context_size=4096, cache_size_mb=1024, max_response_tokens=1024),
                    task_affinity=["chat", "coding", "general"],
                    priority=9,
                ),
            ],
            max_total_gpu_memory_mb=6144,
            max_total_vram_usage_mb=12288,
            cpu_thread_pool_size=4,
            default_task_type="chat",
        ),
        
        # HEAVY-COMPUTE: Deep analysis, code review, planning. Tolerates higher latency for quality.
        "heavy-compute": ServerProfile(
            name="heavy-compute",
            hardware_class="high",
            description="Deep analysis, code review, complex planning with high quality output.",
            models=[
                ModelInstance(
                    model_id="mistral-7b",
                    model_name="Mistral-7B",
                    port=8002,
                    gpu_config=GPUConfig(n_gpu_layers=50, n_threads=6, batch_size=16),
                    context_config=ContextConfig(context_size=8192, cache_size_mb=2048, max_response_tokens=2048),
                    task_affinity=["code_review", "doc_analysis", "planning"],
                    priority=8,
                ),
            ],
            max_total_gpu_memory_mb=12288,
            max_total_vram_usage_mb=24576,
            cpu_thread_pool_size=6,
            default_task_type="code_review",
        ),
        
        # BALANCED: General-purpose multi-model orchestration.
        "balanced": ServerProfile(
            name="balanced",
            hardware_class="mid",
            description="Balanced workload distribution across multiple models.",
            models=[
                ModelInstance(
                    model_id="phi3-mini",
                    model_name="Phi-3-mini-4k",
                    port=8001,
                    gpu_config=GPUConfig(n_gpu_layers=35, n_threads=4, batch_size=32),
                    context_config=ContextConfig(context_size=4096, cache_size_mb=1024, max_response_tokens=1024),
                    task_affinity=["chat", "general"],
                    priority=6,
                ),
                ModelInstance(
                    model_id="neural-chat",
                    model_name="Neural-Chat-7B",
                    port=8003,
                    gpu_config=GPUConfig(n_gpu_layers=40, n_threads=4, batch_size=24),
                    context_config=ContextConfig(context_size=6144, cache_size_mb=1536, max_response_tokens=1024),
                    task_affinity=["code_review", "coding"],
                    priority=7,
                ),
            ],
            max_total_gpu_memory_mb=10240,
            max_total_vram_usage_mb=20480,
            cpu_thread_pool_size=8,
            default_task_type="general",
        ),
        
        # RERANKER-FOCUSED: Fast specialized models for ranking and filtering.
        "reranker-focused": ServerProfile(
            name="reranker-focused",
            hardware_class="entry",
            description="Fast reranking, document filtering, and similarity scoring.",
            models=[
                ModelInstance(
                    model_id="bge-small",
                    model_name="BGE-Small",
                    port=8004,
                    gpu_config=GPUConfig(n_gpu_layers=15, n_threads=2, batch_size=128),
                    context_config=ContextConfig(context_size=512, cache_size_mb=256, max_response_tokens=128),
                    task_affinity=["reranker"],
                    priority=10,
                ),
            ],
            max_total_gpu_memory_mb=2048,
            max_total_vram_usage_mb=4096,
            cpu_thread_pool_size=2,
            default_task_type="reranker",
        ),
        
        # TRANSLATION-FOCUSED: Specialized models for multilingual translation.
        "translation-focused": ServerProfile(
            name="translation-focused",
            hardware_class="mid",
            description="Multilingual translation and language understanding.",
            models=[
                ModelInstance(
                    model_id="mt5-base",
                    model_name="mT5-Base",
                    port=8005,
                    gpu_config=GPUConfig(n_gpu_layers=30, n_threads=4, batch_size=16),
                    context_config=ContextConfig(context_size=2048, cache_size_mb=512, max_response_tokens=512),
                    task_affinity=["translation"],
                    priority=7,
                ),
            ],
            max_total_gpu_memory_mb=6144,
            max_total_vram_usage_mb=12288,
            cpu_thread_pool_size=4,
            default_task_type="translation",
        ),
    }


class LocalModelResolver:
    def resolve_fast_gpu_model(self, index: ModelIndex) -> IndexedModel | None:
        # Priorität:
        # 1. Qwen3.5-2B GGUF
        # 2. Qwen2.5-Coder-3B-Instruct Q4_K_M
        # 3. Qwen2.5-Coder-3B-Instruct Q5_K_M
        # 4. kleinstes geeignetes lokales Chat-/Code-Modell innerhalb des VRAM-Budgets
        models = index.models
        
        # 1. Qwen3.5-2B GGUF
        for m in models:
            if m.format == "gguf" and "qwen" in m.name.lower() and "2b" in m.name.lower():
                return m
                
        # 2 + 3. Qwen2.5-Coder-3B-Instruct Q4_K_M / Q5_K_M
        for opt in ["q4_k_m", "q5_k_m"]:
            for m in models:
                if m.format == "gguf" and "qwen" in m.name.lower() and "3b" in m.name.lower() and "coder" in m.name.lower() and opt in m.name.lower():
                    return m
                    
        # 4. kleinstes geeignetes lokales Chat-/Code-Modell (z.B. Phi, Qwen <= 3B)
        ggufs = [m for m in models if m.format == "gguf" and m.size_gb < 3.5]
        if ggufs:
            return min(ggufs, key=lambda x: x.size_bytes)
            
        return None

    def resolve_quality_cpu_model(self, index: ModelIndex) -> IndexedModel | None:
        # Priorität:
        # 1. Qwen2.5-Coder-7B-Instruct Q4_K_M
        # 2. anderes lokales 7B-Coder-Modell
        # 3. bestes lokales Code-Modell über 4 GB
        models = index.models
        
        # 1. Qwen2.5-Coder-7B-Instruct Q4_K_M
        for m in models:
            if m.format == "gguf" and "qwen" in m.name.lower() and "7b" in m.name.lower() and "coder" in m.name.lower() and "q4_k_m" in m.name.lower():
                return m
                
        # 2. anderes lokales 7B-Coder-Modell
        for m in models:
            if m.format == "gguf" and "7b" in m.name.lower() and "coder" in m.name.lower():
                return m
                
        # 3. bestes lokales Code-Modell über 4 GB
        code_models = [m for m in models if m.format == "gguf" and m.size_gb >= 4.0 and "coder" in m.name.lower()]
        if code_models:
            return max(code_models, key=lambda x: x.size_bytes)
            
        # fallback zu beliebigem GGUF über 4GB
        big_models = [m for m in models if m.format == "gguf" and m.size_gb >= 4.0]
        if big_models:
            return max(big_models, key=lambda x: x.size_bytes)
            
        return None

    def resolve_utility_model(
        self,
        index: ModelIndex,
        role: Literal["embedding", "reranker"],
    ) -> IndexedModel | None:
        models = index.models
        if role == "embedding":
            # Embedding: Qwen3-Embedding-0.6B
            for m in models:
                if "embed" in m.name.lower():
                    return m
        elif role == "reranker":
            # Reranker: Qwen3-Reranker-0.6B
            for m in models:
                if "rerank" in m.name.lower():
                    return m
        return None


def build_nvidia_cpu_profile_from_index(
    index: ModelIndex,
    *,
    fast_gpu_port: int = 8081,
    quality_cpu_port: int = 8082,
    utility_port: int = 8083,
) -> ServerProfile:
    resolver = LocalModelResolver()
    
    fast_gpu_model = resolver.resolve_fast_gpu_model(index)
    quality_cpu_model = resolver.resolve_quality_cpu_model(index)
    
    if not fast_gpu_model:
        raise ValueError("required_model_missing: Kein geeignetes Modell für 'fast_gpu' im Index gefunden.")
    if not quality_cpu_model:
        raise ValueError("required_model_missing: Kein geeignetes Modell für 'quality_cpu' im Index gefunden.")
        
    models_to_start = [
        ModelInstance(
            model_id=fast_gpu_model.id,
            model_name=fast_gpu_model.name,
            port=fast_gpu_port,
            gpu_config=GPUConfig(n_gpu_layers=99, n_threads=4, batch_size=32),
            context_config=ContextConfig(context_size=8192, cache_size_mb=1024, max_response_tokens=1024),
            task_affinity=["chat", "general"],
            priority=6,
        ),
        ModelInstance(
            model_id=quality_cpu_model.id,
            model_name=quality_cpu_model.name,
            port=quality_cpu_port,
            gpu_config=GPUConfig(n_gpu_layers=0, n_threads=6, batch_size=16),
            context_config=ContextConfig(context_size=8192, cache_size_mb=2048, max_response_tokens=2048),
            task_affinity=["code_review", "coding"],
            priority=8,
        ),
    ]
    
    # Optional Embedding oder Reranker, falls im Index
    embed_model = resolver.resolve_utility_model(index, "embedding")
    if embed_model:
        models_to_start.append(
            ModelInstance(
                model_id=embed_model.id,
                model_name=embed_model.name,
                port=utility_port,
                gpu_config=GPUConfig(n_gpu_layers=0, n_threads=2, batch_size=32),
                context_config=ContextConfig(context_size=512, cache_size_mb=256, max_response_tokens=128),
                task_affinity=["reranker"],
                priority=10,
            )
        )
        
    return ServerProfile(
        name="nvidia-gpu-cpu",
        hardware_class="mid",
        description="Parallel CPU/GPU execution: Fast 2B on NVIDIA GPU, Qwen 7B Coder on CPU (dynamically resolved).",
        models=models_to_start,
        max_total_gpu_memory_mb=4096,
        max_total_vram_usage_mb=4096,
        cpu_thread_pool_size=8,
        default_task_type="chat",
    )
