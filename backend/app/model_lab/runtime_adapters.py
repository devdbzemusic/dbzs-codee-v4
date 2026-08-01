from __future__ import annotations

from pathlib import Path
import os
from typing import Any

from app.core.config import get_models_dir, get_ollama_dir, get_ollama_models_dir
from app.model_lab.models import ModelLabModel
from app.models.schemas import IndexedModel, ModelRuntimeHints
from app.runtime.launch import (
    build_runtime_command,
    format_command_preview,
    resolve_preferred_port,
    validate_model_for_launch,
)


class LlamaCppModelLabAdapter:
    id = "llama.cpp"

    def build_probe_preview(
        self,
        model: ModelLabModel,
        *,
        runtime_options: dict[str, Any] | None = None,
        models_dir: Path | None = None,
        ollama_dir: Path | None = None,
        ollama_models_dir: Path | None = None,
    ) -> dict[str, Any]:
        primary = next(
            (artifact for artifact in model.artifacts if artifact.artifact_id == model.bundle.primary_artifact_id),
            None,
        )
        if primary is None:
            return {
                "supported": False,
                "blockers": ["Bundle hat kein startbares Primaerartefakt."],
                "warnings": [],
            }
        indexed = _indexed_model_from_model_lab(model)
        runtime_options = runtime_options or {}
        models_dir = models_dir or get_models_dir()
        ollama_dir = ollama_dir or get_ollama_dir()
        ollama_models_dir = ollama_models_dir or get_ollama_models_dir()
        runtime_dir = _bounded_runtime_dir(models_dir, runtime_options)
        validation_error = validate_model_for_launch(
            indexed,
            runtime_dir=runtime_dir,
            ollama_executable=ollama_dir / "ollama.exe",
            models_dir=models_dir,
            config_override=runtime_options,
        )
        blockers = [validation_error] if validation_error else []
        effective_runtime_dir = runtime_dir or (models_dir / "llama.cpp-win-runtime")
        port = resolve_preferred_port(indexed, models_dir, config_override=runtime_options)
        command = build_runtime_command(
            indexed,
            effective_runtime_dir,
            port,
            ollama_executable=ollama_dir / "ollama.exe",
            config_override=runtime_options,
        )
        return {
            "supported": not blockers,
            "adapter_id": self.id,
            "runtime_dir": str(effective_runtime_dir),
            "ollama_models_dir": str(ollama_models_dir),
            "port": port,
            "endpoint": f"http://127.0.0.1:{port}",
            "command_preview": format_command_preview(command),
            "blockers": blockers,
            "warnings": _warnings_for(indexed, runtime_options),
            "primary_artifact_id": primary.artifact_id,
        }


def _indexed_model_from_model_lab(model: ModelLabModel) -> IndexedModel:
    primary = next(
        (artifact for artifact in model.artifacts if artifact.artifact_id == model.bundle.primary_artifact_id),
        None,
    )
    if primary is None:
        raise ValueError("Bundle hat kein Primaerartefakt.")
    return IndexedModel(
        id=model.bundle.bundle_id,
        name=model.bundle.name,
        path=primary.path,
        format=primary.format,
        artifact_type=primary.artifact_type,
        size_bytes=primary.size_bytes,
        size_gb=primary.size_bytes / (1024**3),
        quantization=primary.quantization or model.bundle.health.quantization,
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=model.bundle.capabilities,
        modality=model.bundle.modalities,
        recommended_use="chat_candidate",
        compatibility="llama_server_candidate",
        runtime=ModelRuntimeHints(
            ctx=model.bundle.health.context_length or 4096,
            gpu_layers=_optional_int(primary.metadata.get("gpu_layers")),
            server_enabled=True,
            preferred_port=_optional_int(primary.metadata.get("preferred_port")),
        ),
    )


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _prefer_gpu(runtime_options: dict[str, Any]) -> bool:
    layers = runtime_options.get("gpu_layers", runtime_options.get("n_gpu_layers"))
    return isinstance(layers, int) and layers > 0


def _bounded_runtime_dir(models_dir: Path, runtime_options: dict[str, Any]) -> Path | None:
    configured = runtime_options.get("runtime_dir")
    candidates: list[Path] = []
    if isinstance(configured, str) and configured.strip():
        candidates.append(Path(configured.strip()))
    env_runtime = os.getenv("DBZS_LLAMA_RUNTIME_DIR", "").strip()
    if env_runtime:
        candidates.append(Path(env_runtime))
    candidates.append(models_dir / "llama.cpp-win-runtime")
    for candidate in candidates:
        if (candidate / "llama-server.exe").exists():
            return candidate
    return None


def _warnings_for(model: IndexedModel, runtime_options: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if model.size_gb > 8:
        warnings.append("large_model")
    if _prefer_gpu(runtime_options) and model.runtime.gpu_layers == 0:
        warnings.append("gpu_layers_requested_for_unprofiled_model")
    return warnings
