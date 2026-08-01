"""
Profile Service: Manages model server profiles and multi-model orchestration.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from app.model_lab.repository import get_shared_model_lab_repository
from app.models.index_service import ModelIndexService
from app.models.schemas import IndexedModel
from app.models.profiles import (
    ContextConfig,
    GPUConfig,
    HardwareClass,
    ModelInstance,
    ModelProfilesConfig,
    ServerProfile,
    TaskType,
    get_default_profiles,
)
from app.runtime.schemas import RuntimeStatus, RuntimeState
from app.settings.service import get_settings_service


class ProfileService:
    """Manages server profiles and coordinated multi-model startup."""

    def __init__(self, config_dir: Path):
        self.config_dir = config_dir
        self.config_file = config_dir / "model_profiles.json"
        self.model_index_service = ModelIndexService(
            model_lab_repository=get_shared_model_lab_repository,
            settings_service=get_settings_service(),
        )
        self.active_profile: Optional[ServerProfile] = None
        self.model_instances: dict[str, RuntimeStatus] = {}
        self._load_or_create_config()

    def _load_or_create_config(self) -> None:
        """Load profiles from config or initialize with defaults."""
        if self.config_file.exists():
            try:
                with open(self.config_file, "r") as f:
                    data = json.load(f)
                    config = ModelProfilesConfig(**data)
                    self.profiles = config.profiles
                    if config.active_profile and config.active_profile in self.profiles:
                        self.active_profile = self.profiles[config.active_profile]
            except Exception as e:
                print(f"Failed to load profiles config: {e}. Using defaults.")
                self._init_defaults()
        else:
            self._init_defaults()

    def _init_defaults(self) -> None:
        """Initialize with default profiles."""
        self.profiles = get_default_profiles()
        # Auto-select the first profile
        if self.profiles:
            self.active_profile = next(iter(self.profiles.values()))

    def save_config(self) -> None:
        """Persist profiles to disk."""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        config = ModelProfilesConfig(
            profiles=self.profiles,
            active_profile=self.active_profile.name if self.active_profile else None,
        )
        with open(self.config_file, "w") as f:
            json.dump(config.model_dump(), f, indent=2)

    def list_profiles(self) -> list[str]:
        """List all available profile names."""
        return list(self.profiles.keys())

    def get_profile(self, profile_name: str) -> Optional[ServerProfile]:
        """Get a profile by name."""
        return self.profiles.get(profile_name)

    def set_active_profile(self, profile_name: str) -> bool:
        """Activate a profile by name. Returns True if successful."""
        profile = self.profiles.get(profile_name)
        if profile:
            self.active_profile = profile
            self.save_config()
            return True
        return False

    def add_profile(self, profile: ServerProfile) -> None:
        """Add or update a profile."""
        self.profiles[profile.name] = profile
        if not self.active_profile:
            self.active_profile = profile
        self.save_config()

    def get_models_for_task(self, task_type: TaskType) -> list[ModelInstance]:
        """Get all models in the active profile that are affine to the given task type."""
        if not self.active_profile:
            return []
        aliases = {task_type}
        if task_type == "review":
            aliases.add("code_review")
        if task_type == "code_review":
            aliases.add("review")
        return [
            model
            for model in self.active_profile.models
            if any(alias in model.task_affinity for alias in aliases)
        ]

    def get_highest_priority_model_for_task(self, task_type: TaskType) -> Optional[ModelInstance]:
        """Get the highest-priority model for a task type."""
        models = self.get_models_for_task(task_type)
        if not models:
            return None
        return max(models, key=lambda m: m.priority)

    def get_all_models(self) -> list[ModelInstance]:
        """Get all models in the active profile."""
        if not self.active_profile:
            return []
        return self.active_profile.models

    def register_model_instance(self, model_id: str, status: RuntimeStatus) -> None:
        """Register a running model instance."""
        self.model_instances[model_id] = status

    def get_model_instance_status(self, model_id: str) -> Optional[RuntimeStatus]:
        """Get the runtime status of a model instance."""
        return self.model_instances.get(model_id)

    def get_all_model_instances(self) -> dict[str, RuntimeStatus]:
        """Get all running model instances."""
        return self.model_instances.copy()

    def update_model_instance_status(self, model_id: str, state: RuntimeState, **kwargs) -> None:
        """Update the status of a running model instance."""
        if model_id in self.model_instances:
            status = self.model_instances[model_id]
            status.state = state
            for key, value in kwargs.items():
                if hasattr(status, key):
                    setattr(status, key, value)

    def estimate_total_resource_usage(self) -> dict[str, float]:
        """
        Estimate resource usage for the active profile.
        Returns: {
            'total_gpu_memory_mb': float,
            'total_vram_usage_mb': float,
            'total_cpu_threads': int,
        }
        """
        if not self.active_profile:
            return {
                "total_gpu_memory_mb": 0.0,
                "total_vram_usage_mb": 0.0,
                "total_cpu_threads": 0,
            }
        usage = self.estimate_resource_usage_for_profile(self.active_profile)
        return {
            "total_gpu_memory_mb": usage["total_gpu_memory_mb"],
            "total_vram_usage_mb": usage["total_vram_usage_mb"],
            "total_cpu_threads": usage["total_cpu_threads"],
            "profile_max_gpu_memory_mb": self.active_profile.max_total_gpu_memory_mb,
            "profile_max_vram_usage_mb": self.active_profile.max_total_vram_usage_mb,
        }

    def validate_profile_resources(self, profile: ServerProfile) -> tuple[bool, str]:
        """
        Validate that a profile's resource requirements fit within its constraints.
        Returns: (is_valid, error_message)
        """
        usage = self.estimate_resource_usage_for_profile(profile)
        total_gpu_vram = usage["total_gpu_memory_mb"]
        
        # Enforce NVIDIA GTX 1650 SUPER 4GB limit
        if total_gpu_vram > 4096.0:
            return (
                False,
                f"Profile {profile.name} estimated GPU VRAM usage ({total_gpu_vram:.1f} MB) exceeds NVIDIA GTX 1650 SUPER capacity (4096 MB with 512 MB safety reserve)",
            )
            
        total_threads = sum(m.gpu_config.n_threads for m in profile.models)
        if total_threads > profile.cpu_thread_pool_size * 2:  # Allow some oversubscription
            return (
                False,
                f"Profile {profile.name} thread usage ({total_threads}) may exceed CPU capacity",
            )
            
        return True, ""

    def generate_profile_for_hardware(
        self,
        profile_name: str,
        tasks: list[TaskType],
        hardware_class: HardwareClass = "mid",
        max_models: int = 5,
        base_port: int = 8101,
        gpu_memory_budget_mb: int | None = None,
        vram_budget_mb: int | None = None,
        cpu_threads: int | None = None,
    ) -> ServerProfile:
        """Generate a profile from the indexed local model inventory and persist it."""
        index = self.model_index_service.build_index()
        runnable = [
            model
            for model in index.models
            if model.artifact_type == "model" and model.compatibility in {"llama_server_ready", "ollama_ready"}
        ]
        if not runnable:
            raise ValueError("Keine startbaren Modelle im lokalen Index gefunden.")

        selected: list[tuple[TaskType, IndexedModel]] = []
        used_ids: set[str] = set()
        normalized_tasks = [self._normalize_task_name(task) for task in tasks] or ["chat", "coding", "review"]

        for task in normalized_tasks:
            candidate = self._select_model_for_task(task, runnable, used_ids)
            if not candidate:
                continue
            selected.append((task, candidate))
            used_ids.add(candidate.id)
            if len(selected) >= max_models:
                break

        if not selected:
            fallback = min(runnable, key=lambda item: (item.size_gb, item.name.lower()))
            selected.append(("general", fallback))

        hardware = self._hardware_defaults(hardware_class, gpu_memory_budget_mb, vram_budget_mb, cpu_threads)

        model_instances: list[ModelInstance] = []
        current_port = base_port
        for task, model in selected:
            model_instances.append(
                self._to_model_instance(
                    model=model,
                    task=task,
                    port=current_port,
                    cpu_threads=hardware["cpu_threads"],
                    max_gpu_layers=hardware["max_gpu_layers"],
                )
            )
            current_port += 1

        profile = ServerProfile(
            name=profile_name,
            hardware_class=hardware_class,
            description=f"Auto-generated profile for tasks: {', '.join(normalized_tasks)}",
            models=model_instances,
            max_total_gpu_memory_mb=hardware["gpu_memory_budget_mb"],
            max_total_vram_usage_mb=hardware["vram_budget_mb"],
            cpu_thread_pool_size=hardware["cpu_threads"],
            default_task_type=normalized_tasks[0],
        )

        self.add_profile(profile)
        return profile

    def benchmark_profile(self, profile: ServerProfile) -> dict[str, float | int | str | bool]:
        """Compute lightweight resource-fit benchmark to estimate runtime stability before start."""
        usage = self.estimate_resource_usage_for_profile(profile)
        gpu_ratio = usage["total_gpu_memory_mb"] / max(profile.max_total_gpu_memory_mb, 1)
        vram_ratio = usage["total_vram_usage_mb"] / max(profile.max_total_vram_usage_mb, 1)
        thread_ratio = usage["total_cpu_threads"] / max(profile.cpu_thread_pool_size, 1)

        penalty = 0.0
        penalty += max(0.0, gpu_ratio - 0.85) * 50
        penalty += max(0.0, vram_ratio - 0.85) * 35
        penalty += max(0.0, thread_ratio - 1.0) * 25

        score = max(0.0, round(100.0 - penalty, 2))
        return {
            "profile": profile.name,
            "score": score,
            "is_safe": score >= 70.0,
            "gpu_ratio": round(gpu_ratio, 3),
            "vram_ratio": round(vram_ratio, 3),
            "thread_ratio": round(thread_ratio, 3),
            **usage,
        }

    def estimate_resource_usage_for_profile(self, profile: ServerProfile) -> dict[str, float | int]:
        total_gpu_memory_mb = 0.0
        total_cpu_threads = 0
        
        try:
            index = self.model_index_service.build_index()
            models_by_id = {m.id: m for m in index.models}
        except Exception:
            models_by_id = {}
            
        gpu_active = False
        for model in profile.models:
            total_cpu_threads += int(model.gpu_config.n_threads)
            n_gpu_layers = model.gpu_config.n_gpu_layers
            
            if n_gpu_layers > 0:
                gpu_active = True
                model_size_bytes = 0
                ref_model = models_by_id.get(model.model_id)
                if ref_model:
                    model_size_bytes = ref_model.size_bytes
                else:
                    id_lower = model.model_id.lower()
                    name_lower = model.model_name.lower()
                    if "7b" in id_lower or "7b" in name_lower:
                        model_size_bytes = 5_000_000_000
                    elif "3b" in id_lower or "3b" in name_lower:
                        model_size_bytes = 2_500_000_000
                    elif "2b" in id_lower or "2b" in name_lower or "1.5b" in id_lower or "1.5b" in name_lower:
                        model_size_bytes = 1_600_000_000
                    else:
                        model_size_bytes = 2_000_000_000
                        
                model_size_mb = model_size_bytes / (1024 * 1024)
                gpu_ratio = min(n_gpu_layers / 32.0, 1.0)
                kv_cache = model.context_config.cache_size_mb
                compute_buffer = 256.0
                
                model_vram = (model_size_mb * gpu_ratio) + kv_cache + compute_buffer
                total_gpu_memory_mb += model_vram
                
        if gpu_active:
            total_gpu_memory_mb += 512.0 # 512 MB safety reserve
            
        total_vram_usage_mb = total_gpu_memory_mb
        
        return {
            "total_gpu_memory_mb": round(total_gpu_memory_mb, 1),
            "total_vram_usage_mb": round(total_vram_usage_mb, 1),
            "total_cpu_threads": total_cpu_threads,
        }

    def _normalize_task_name(self, task: TaskType) -> TaskType:
        return "review" if task == "code_review" else task

    def _select_model_for_task(
        self,
        task: TaskType,
        candidates: list[IndexedModel],
        used_ids: set[str],
    ) -> IndexedModel | None:
        affinity = {
            "chat": ["chat_candidate", "primary_coding", "coding_candidate"],
            "coding": ["primary_coding", "coding_candidate", "chat_candidate"],
            "review": ["review_agent", "coding_candidate", "primary_coding"],
            "translation": ["chat_candidate", "primary_coding"],
            "reranker": ["reranker", "embedding"],
            "doc_analysis": ["review_agent", "chat_candidate"],
            "planning": ["chat_candidate", "review_agent"],
            "general": ["chat_candidate", "coding_candidate"],
        }
        preferred = affinity.get(task, affinity["general"])

        ranked = sorted(
            candidates,
            key=lambda model: (
                0 if model.id not in used_ids else 1,
                0 if model.recommended_use in preferred else 1,
                preferred.index(model.recommended_use) if model.recommended_use in preferred else 99,
                model.size_gb,
            ),
        )
        return ranked[0] if ranked else None

    def _to_model_instance(
        self,
        model: IndexedModel,
        task: TaskType,
        port: int,
        cpu_threads: int,
        max_gpu_layers: int,
    ) -> ModelInstance:
        model_threads = max(1, min(cpu_threads, model.runtime.ctx // 1024 if model.runtime.ctx else cpu_threads))
        model_gpu_layers = model.runtime.gpu_layers if model.runtime.gpu_layers is not None else max_gpu_layers
        model_gpu_layers = max(0, min(model_gpu_layers, max_gpu_layers))
        context_size = model.runtime.ctx or 4096
        cache_size_mb = max(256, min(4096, context_size // 4))

        return ModelInstance(
            model_id=model.id,
            model_name=model.name,
            provider="ollama" if model.runtime_launcher == "ollama" else "llama.cpp",
            port=port,
            gpu_config=GPUConfig(n_gpu_layers=model_gpu_layers, n_threads=model_threads, batch_size=32),
            context_config=ContextConfig(
                context_size=context_size,
                cache_size_mb=cache_size_mb,
                max_response_tokens=min(2048, max(512, context_size // 4)),
            ),
            task_affinity=[task, "general"] if task != "general" else ["general"],
            priority=8 if task in {"coding", "review", "reranker"} else 7,
        )

    def _hardware_defaults(
        self,
        hardware_class: HardwareClass,
        gpu_memory_budget_mb: int | None,
        vram_budget_mb: int | None,
        cpu_threads: int | None,
    ) -> dict[str, int]:
        defaults = {
            "entry": {"gpu_memory_budget_mb": 4096, "vram_budget_mb": 8192, "cpu_threads": 4, "max_gpu_layers": 20},
            "mid": {"gpu_memory_budget_mb": 8192, "vram_budget_mb": 16384, "cpu_threads": 8, "max_gpu_layers": 42},
            "high": {"gpu_memory_budget_mb": 16384, "vram_budget_mb": 32768, "cpu_threads": 12, "max_gpu_layers": 80},
        }[hardware_class]

        host_threads = max(2, os.cpu_count() or 8)
        return {
            "gpu_memory_budget_mb": gpu_memory_budget_mb or defaults["gpu_memory_budget_mb"],
            "vram_budget_mb": vram_budget_mb or defaults["vram_budget_mb"],
            "cpu_threads": min(cpu_threads or defaults["cpu_threads"], host_threads),
            "max_gpu_layers": defaults["max_gpu_layers"],
        }
