from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json
import re
from typing import Any, Callable

OnIndexProgress = Callable[[int, int], None]
OnIndexModelError = Callable[[str, Exception], None]

from app.core.config import get_models_dir, get_ollama_dir, get_ollama_models_dir
# from app.models.index_service import ModelIndexService  # Zirkulärer Import entfernt
from app.models.launcher import normalize_launcher
from app.models.schemas import IndexedModel, ModelIndex, ModelIndexSummary, ModelRuntimeHints, RecommendedUse
from app.models.discovery import ModelDiscoveryService
from app.settings.models import ModelDiscoveryMode


# Mirrors .codee/functiongemma/functiongemma-model-profile.example.json's "model"
# object — the one FunctionGemma build this feature currently targets. Used by
# the orchestrator_cpu autostart path to auto-register the catalog entry when
# the GGUF file is present but not yet catalogued.
FUNCTIONGEMMA_DEFAULT_PROFILE: dict[str, Any] = {
    "match": {"filename": "functiongemma-270m-it.Q8_0.gguf"},
    "role": "ORCHESTRATOR_MODEL",
    "recommended_use": "orchestrator",
    "capabilities": ["function_calling", "intent_routing", "workflow_routing", "clarification_detection"],
    "modality": ["text"],
    "backend": "llama.cpp",
    "runtime_launcher": "llama-server",
    "runtime": {
        "slot_id": "orchestrator_cpu",
        "ctx": 4096,
        "gpu_layers": 0,
        "threads": 4,
        "parallel": 2,
        "preferred_port": 8084,
        "server_enabled": True,
    },
}


class ModelIndexService:
    def __init__(
        self,
        models_dir: Path | None = None,
        ollama_dir: Path | None = None,
        ollama_models_dir: Path | None = None,
        discovery_mode: ModelDiscoveryMode = "local_with_ollama",
    ) -> None:
        self.models_dir = models_dir or get_models_dir()
        self.ollama_dir = ollama_dir or get_ollama_dir()
        self.ollama_models_dir = ollama_models_dir or get_ollama_models_dir()
        self.discovery_mode = discovery_mode
        self.discovery_service = ModelDiscoveryService(
            mode=discovery_mode,
            models_dir=self.models_dir,
            ollama_models_dir=self.ollama_models_dir,
        )
    def build_index(
        self,
        *,
        on_progress: OnIndexProgress | None = None,
        on_model_error: OnIndexModelError | None = None,
    ) -> ModelIndex:
        """Build the model index.

        `on_progress`/`on_model_error` are optional hooks used by the boot
        startup task (app/models/index_startup.py) to report incremental
        progress and isolate a single corrupt catalog/filesystem entry
        without aborting the whole scan. Both are no-ops when omitted, so
        the existing lazy GET /models/index call path is unaffected.
        """
        catalog_path = self.models_dir / "models.catalog.json"
        if catalog_path.exists():
            index = self._from_catalog(catalog_path, on_progress=on_progress, on_model_error=on_model_error)
        else:
            index = self._from_filesystem(on_progress=on_progress, on_model_error=on_model_error)

        # P1 Phase 4: Filter models based on discovery mode
        if self.discovery_mode == "project_local_strict":
            # Only project-local models, no Ollama
            return index

        ollama_models = self._ollama_models()
        if not ollama_models:
            return index

        # local_with_ollama or cloud_enabled: include Ollama
        return _build_index(
            generated_from=f"{index.generated_from};ollama:{self.ollama_dir}",
            models_dir=self.models_dir,
            runtime_dir=index.summary.runtime_dir,
            ollama_dir=str(self.ollama_dir),
            ollama_models_dir=str(self.ollama_models_dir),
            models=[*index.models, *ollama_models],
        )

    def _from_catalog(
        self,
        catalog_path: Path,
        *,
        on_progress: OnIndexProgress | None = None,
        on_model_error: OnIndexModelError | None = None,
    ) -> ModelIndex:
        catalog = _read_json(catalog_path)
        runtime_by_id = self._runtime_by_id()
        state_by_id = self._state_by_id()
        gguf_by_filename, gguf_by_slug = _build_gguf_lookup(self.models_dir)
        models: list[IndexedModel] = []

        # V2-Kompatibilität: Unterstütze sowohl "models" als auch "artifacts"
        entries = catalog.get("models", []) or catalog.get("artifacts", [])
        total = len(entries)

        for index, entry in enumerate(entries):
            try:
                # P1 Phase 4: Use relative IDs for project-local models
                raw_path = str(entry.get("absolute_path") or entry.get("file_path") or entry.get("path") or "")

                # Try to generate relative ID if model is project-local
                relative_id = None
                if raw_path and self.discovery_service:
                    relative_id = self.discovery_service.get_project_relative_id(raw_path)
                model_id = str(entry.get("id")) if entry.get("id") else (relative_id or _stable_id(raw_path))
                runtime_entry = runtime_by_id.get(model_id, {})
                runtime = runtime_entry.get("runtime", {})
                server = runtime_entry.get("server", {})
                loader = entry.get("loader", {})
                health = state_by_id.get(model_id, {})
                launcher = normalize_launcher(str(loader.get("launcher") or entry.get("loader") or "llama-server"))
                health_status = _resolve_health_status(health, runtime_entry)

                # V2: "absolute_path" oder "path"
                model_name = str(entry.get("name") or Path(raw_path).stem)
                path = _resolve_model_path(raw_path, self.models_dir, model_name, gguf_by_filename, gguf_by_slug)
                artifact_type = str(entry.get("artifact_type") or entry.get("type") or _infer_artifact_type(path))
                capabilities = list(entry.get("capabilities") or _infer_capabilities(path))
                modality = list(entry.get("modality") or _infer_modality(path, artifact_type))
                size_bytes = int(entry.get("size_bytes") or 0)

                models.append(
                    IndexedModel(
                        id=model_id,
                        name=model_name,
                        path=path,
                        format=Path(path).suffix.lower().lstrip(".") or "unknown",
                        artifact_type=artifact_type,
                        size_bytes=size_bytes,
                        size_gb=round(size_bytes / 1024**3, 3),
                        quantization=entry.get("quantization"),
                        backend=str(entry.get("backend") or "llama.cpp"),
                        runtime_launcher=launcher,
                        capabilities=capabilities,
                        modality=modality,
                        role=entry.get("role"),
                        recommended_use=_recommended_use(
                            name=model_name,
                            artifact_type=artifact_type,
                            capabilities=capabilities,
                            modality=modality,
                            role=entry.get("role"),
                            health_status=health_status,
                        ),
                        compatibility=_compatibility(
                            artifact_type,
                            launcher,
                            health_status,
                            path,
                        ),
                        runtime=ModelRuntimeHints(
                            ctx=runtime.get("ctx"),
                            gpu_layers=runtime.get("gpu_layers"),
                            server_enabled=bool(server.get("enabled", False)),
                            preferred_port=server.get("preferred_port"),
                            health_status=health_status,
                            provider=str(entry.get("backend") or "llama.cpp"),
                        ),
                    )
                )
            except Exception as exc:  # noqa: BLE001 - one corrupt entry must not abort the whole index
                if on_model_error is not None:
                    identifier = str(entry.get("id") or entry.get("name") or entry.get("path") or f"entry[{index}]")
                    on_model_error(identifier, exc)
            finally:
                if on_progress is not None:
                    on_progress(index + 1, total)

        return _build_index(
            generated_from=f"catalog:{catalog_path}",
            models_dir=self.models_dir,
            runtime_dir=catalog.get("runtime_dir"),
            ollama_dir=str(self.ollama_dir) if self.ollama_dir.exists() else None,
            ollama_models_dir=str(self.ollama_models_dir) if self.ollama_models_dir.exists() else None,
            models=models,
        )

    def _from_filesystem(
        self,
        *,
        on_progress: OnIndexProgress | None = None,
        on_model_error: OnIndexModelError | None = None,
    ) -> ModelIndex:
        models: list[IndexedModel] = []
        runtime_by_id = self._runtime_by_id()
        state_by_id = self._state_by_id()

        gguf_paths = [p for p in sorted(self.models_dir.rglob("*.gguf")) if p.is_file()]
        total = len(gguf_paths)

        for index, model_path in enumerate(gguf_paths):
            try:
                path = str(model_path)
                model_id = _stable_id(path)
                runtime_entry = runtime_by_id.get(model_id, {})
                runtime = runtime_entry.get("runtime", {})
                server = runtime_entry.get("server", {})
                health = state_by_id.get(model_id, {})
                artifact_type = _infer_artifact_type(path)
                capabilities = _infer_capabilities(path)
                modality = _infer_modality(path, artifact_type)
                size_bytes = model_path.stat().st_size
                name = model_path.stem
                health_status = _resolve_health_status(health, runtime_entry)

                models.append(
                    IndexedModel(
                        id=model_id,
                        name=name,
                        path=path,
                        format="gguf",
                        artifact_type=artifact_type,
                        size_bytes=size_bytes,
                        size_gb=round(size_bytes / 1024**3, 3),
                        quantization=_infer_quantization(name),
                        backend="llama.cpp",
                        runtime_launcher="llama-server",
                        capabilities=capabilities,
                        modality=modality,
                        role=None,
                        recommended_use=_recommended_use(
                            name=name,
                            artifact_type=artifact_type,
                            capabilities=capabilities,
                            modality=modality,
                            role=None,
                            health_status=health_status,
                        ),
                        compatibility=_compatibility(
                            artifact_type,
                            "llama-server",
                            health_status,
                        ),
                        runtime=ModelRuntimeHints(
                            ctx=runtime.get("ctx"),
                            gpu_layers=runtime.get("gpu_layers"),
                            server_enabled=bool(server.get("enabled", False)),
                            preferred_port=server.get("preferred_port"),
                            health_status=health_status,
                            provider="llama.cpp",
                        ),
                    )
                )
            except Exception as exc:  # noqa: BLE001 - one corrupt entry must not abort the whole index
                if on_model_error is not None:
                    on_model_error(str(model_path), exc)
            finally:
                if on_progress is not None:
                    on_progress(index + 1, total)

        return _build_index(
            generated_from=f"filesystem:{self.models_dir}",
            models_dir=self.models_dir,
            runtime_dir=None,
            ollama_dir=str(self.ollama_dir) if self.ollama_dir.exists() else None,
            ollama_models_dir=str(self.ollama_models_dir) if self.ollama_models_dir.exists() else None,
            models=models,
        )

    def register_catalog_model_profile(self, profile: dict[str, Any]) -> str | None:
        """Atomically merge a single model entry into models.catalog.json.

        Mirrors the RuntimeService._save_last_good_command read-merge-write
        idiom, but for the catalog file rather than models.runtime.json.
        `profile` follows the shape of
        `.codee/functiongemma/functiongemma-model-profile.example.json`'s
        `model` object. Idempotent: does nothing if the matched GGUF file
        isn't present on disk, and does nothing (beyond returning the
        existing id) if a catalog entry for that file already exists —
        never overwrites an existing entry.
        """
        match = profile.get("match", {})
        filename = str(match.get("filename") or "").strip()
        if not filename:
            return None

        gguf_by_filename, _ = _build_gguf_lookup(self.models_dir)
        candidates = gguf_by_filename.get(filename.lower())
        if not candidates:
            return None
        resolved_path = str(_pick_best_gguf(candidates).resolve())

        catalog_path = self.models_dir / "models.catalog.json"
        if catalog_path.exists():
            catalog = _read_json(catalog_path)
        else:
            catalog = {"schema_version": "1.0", "models": []}
        if not isinstance(catalog.get("models"), list):
            catalog["models"] = []

        for entry in catalog["models"]:
            if not isinstance(entry, dict):
                continue
            existing_path = str(entry.get("absolute_path") or entry.get("file_path") or entry.get("path") or "")
            if existing_path and Path(existing_path).resolve() == Path(resolved_path).resolve():
                return str(entry.get("id")) if entry.get("id") else _stable_id(resolved_path)

        model_id = _stable_id(resolved_path)
        runtime_profile = profile.get("runtime", {})
        new_entry = {
            "id": model_id,
            "name": Path(resolved_path).stem,
            "absolute_path": resolved_path,
            "artifact_type": "model",
            "size_bytes": Path(resolved_path).stat().st_size,
            "role": profile.get("role"),
            "capabilities": profile.get("capabilities", []),
            "modality": profile.get("modality", ["text"]),
            "backend": profile.get("backend", "llama.cpp"),
            "loader": {"launcher": profile.get("runtime_launcher", "llama-server")},
        }
        catalog["models"].append(new_entry)
        _write_json(catalog_path, catalog)

        if runtime_profile:
            self._merge_runtime_hints(model_id, runtime_profile)

        return model_id

    def _merge_runtime_hints(self, model_id: str, runtime_profile: dict[str, Any]) -> None:
        runtime_path = self.models_dir / "models.runtime.json"
        if runtime_path.exists():
            runtime_data = _read_json(runtime_path)
        else:
            runtime_data = {"schema_version": "1.0", "models": {}}
        if not isinstance(runtime_data.get("models"), dict):
            runtime_data["models"] = {}

        existing = runtime_data["models"].get(model_id, {})
        if not isinstance(existing, dict):
            existing = {}
        existing_runtime = existing.get("runtime", {})
        if not isinstance(existing_runtime, dict):
            existing_runtime = {}
        existing_server = existing.get("server", {})
        if not isinstance(existing_server, dict):
            existing_server = {}

        runtime_data["models"][model_id] = {
            **existing,
            "runtime": {
                **existing_runtime,
                "ctx": runtime_profile.get("ctx", existing_runtime.get("ctx", 4096)),
                "gpu_layers": runtime_profile.get("gpu_layers", existing_runtime.get("gpu_layers", 0)),
            },
            "server": {
                **existing_server,
                "enabled": runtime_profile.get("server_enabled", existing_server.get("enabled", True)),
                "preferred_port": runtime_profile.get("preferred_port", existing_server.get("preferred_port")),
            },
        }
        _write_json(runtime_path, runtime_data)

    def _runtime_by_id(self) -> dict[str, dict]:
        runtime_path = self.models_dir / "models.runtime.json"
        if not runtime_path.exists():
            return {}
        data = _read_json(runtime_path)
        models_data = data.get("models", {})
        if isinstance(models_data, dict) and models_data:
            return models_data
        artifacts = data.get("artifacts", [])
        if isinstance(artifacts, list):
            return {
                str(entry["id"]): entry
                for entry in artifacts
                if isinstance(entry, dict) and "id" in entry
            }
        return {}

    def _state_by_id(self) -> dict[str, dict]:
        state_path = self.models_dir / "models.state.json"
        if not state_path.exists():
            return {}
        data = _read_json(state_path)
        health = data.get("health", {})
        if isinstance(health, dict) and health:
            return health
        models_data = data.get("models", {})
        if isinstance(models_data, dict):
            return models_data
        return {}

    def _ollama_models(self) -> list[IndexedModel]:
        import os
        if "PYTEST_CURRENT_TEST" not in os.environ:
            try:
                from app.core.config import get_app_data_dir
                settings_path = get_app_data_dir() / "settings.json"
                if settings_path.exists():
                    import json
                    raw = json.loads(settings_path.read_text(encoding="utf-8"))
                    if not raw.get("ollamaBaseUrl", "").strip():
                        return []
            except Exception:
                pass

        if not self.ollama_models_dir.exists():
            return []

        manifests_dir = self.ollama_models_dir / "manifests" / "registry.ollama.ai"
        if not manifests_dir.exists():
            return []

        models: list[IndexedModel] = []
        for manifest_path in manifests_dir.rglob("*"):
            if not manifest_path.is_file():
                continue
            try:
                manifest = _read_json(manifest_path)
            except (json.JSONDecodeError, OSError):
                continue

            model_name = _ollama_model_name(manifest_path, manifests_dir)
            model_id = f"ollama_{_ollama_model_id_slug(model_name)}"
            models.append(
                IndexedModel(
                    id=model_id,
                    name=model_name,
                    path=str(manifest_path),
                    format="ollama",
                    artifact_type="model",
                    size_bytes=_ollama_manifest_size(manifest, self.ollama_models_dir),
                    size_gb=round(_ollama_manifest_size(manifest, self.ollama_models_dir) / 1024**3, 3),
                    quantization=_ollama_quantization(manifest),
                    backend="ollama",
                    runtime_launcher="ollama",
                    capabilities=["chat", "instruction"],
                    modality=["text"],
                    role=None,
                    recommended_use="chat_candidate",
                    compatibility="ollama_ready",
                    runtime=ModelRuntimeHints(
                        ctx=None,
                        gpu_layers=None,
                        server_enabled=True,
                        preferred_port=11434,
                        health_status="ok",
                        provider="ollama",
                    ),
                )
            )
        return models


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)


def _stable_id(value: str) -> str:
    import hashlib
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def _build_index(
    generated_from: str,
    models_dir: Path,
    runtime_dir: str | None,
    ollama_dir: str | None,
    ollama_models_dir: str | None,
    models: list[IndexedModel],
) -> ModelIndex:
    sorted_models = sorted(models, key=_priority)
    return ModelIndex(
        generated_from=generated_from,
        summary=ModelIndexSummary(
            models_dir=str(models_dir),
            runtime_dir=runtime_dir,
            ollama_dir=ollama_dir,
            ollama_models_dir=ollama_models_dir,
            total=len(sorted_models),
            gguf_total=sum(1 for m in sorted_models if m.format == "gguf"),
            ollama_total=sum(1 for m in sorted_models if m.runtime_launcher == "ollama"),
            llama_server_ready=sum(1 for m in sorted_models if m.compatibility == "llama_server_ready"),
            ollama_ready=sum(1 for m in sorted_models if m.compatibility == "ollama_ready"),
            coding_candidates=sum(1 for m in sorted_models if m.recommended_use in ("primary_coding", "coding_candidate")),
            vision_candidates=sum(1 for m in sorted_models if m.recommended_use == "vision_candidate"),
            adapters=sum(1 for m in sorted_models if m.artifact_type in ("adapter", "lora")),
            unsupported=sum(1 for m in sorted_models if m.recommended_use == "unsupported"),
        ),
        models=sorted_models,
    )


def _infer_quantization(name: str) -> str | None:
    match = re.search(r"(IQ\d_[A-Z]+|Q\d_K_[A-Z]+|Q\d_[A-Z0-9]+|F16|BF16)", name, re.IGNORECASE)
    return match.group(1).upper() if match else None


def _infer_artifact_type(path: str) -> str:
    value = path.lower()
    if "mmproj" in value:
        return "mmproj"
    if "lora" in value or "adapter" in value:
        return "adapter"
    if any(token in value for token in ["stable-diffusion", "sd3", "flux", "wan2", "z_image", "image_turbo"]):
        return "diffusion_model"
    return "model"


def _infer_capabilities(path: str) -> list[str]:
    value = path.lower()
    capabilities: set[str] = set()
    if any(token in value for token in ["coder", "code", "diffcoder", "codestral"]):
        capabilities.update(["chat", "code"])
    if any(token in value for token in ["reranker", "ranker"]):
        capabilities.add("reranker")
    if any(token in value for token in ["embed", "bge", "nomic"]):
        capabilities.add("embedding")
    if any(token in value for token in ["vision", "vl", "llava", "janus", "smolvlm", "mmproj"]):
        capabilities.add("vision")
    if any(token in value for token in ["review", "summary"]):
        capabilities.update(["review", "summary"])
    if any(token in value for token in ["functiongemma"]):
        capabilities.update(["function_calling", "intent_routing", "workflow_routing", "clarification_detection"])
    if not capabilities:
        capabilities.update(["chat", "instruction"])
    return sorted(capabilities)


def _infer_modality(path: str, artifact_type: str) -> list[str]:
    value = path.lower()
    if artifact_type == "mmproj":
        return ["image"]
    if any(token in value for token in ["vision", "vl", "llava", "janus", "smolvlm", "mmproj"]):
        return ["text", "image"]
    if artifact_type == "diffusion_model":
        return ["image"]
    return ["text"]


def _recommended_use(
    name: str,
    artifact_type: str,
    capabilities: list[str],
    modality: list[str],
    role: str | None,
    health_status: str,
) -> RecommendedUse:
    if artifact_type in {"adapter", "lora"}:
        return "adapter_only"
    if artifact_type in {"diffusion_model"}:
        return "media_pipeline"
    if role == "ORCHESTRATOR_MODEL" or "function_calling" in capabilities:
        return "orchestrator"
    if "embedding" in capabilities:
        return "embedding"
    if "reranker" in capabilities:
        return "reranker"
    if "image" in modality:
        return "vision_candidate"
    if role == "CODE_MODEL" or "code" in capabilities or "coder" in name.lower():
        return "primary_coding" if health_status == "ok" else "coding_candidate"
    if role == "REVIEW_MODEL" or "review" in capabilities:
        return "review_agent"
    if artifact_type == "model":
        return "chat_candidate"
    return "unsupported"


def _normalize_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _build_gguf_lookup(models_dir: Path) -> tuple[dict[str, list[Path]], dict[str, list[Path]]]:
    by_filename: dict[str, list[Path]] = {}
    by_slug: dict[str, list[Path]] = {}
    if not models_dir.exists():
        return by_filename, by_slug

    for gguf in models_dir.rglob("*.gguf"):
        if not gguf.is_file():
            continue
        by_filename.setdefault(gguf.name.lower(), []).append(gguf)
        by_slug.setdefault(_normalize_slug(gguf.stem), []).append(gguf)

    return by_filename, by_slug


def _pick_best_gguf(candidates: list[Path]) -> Path:
    if len(candidates) == 1:
        return candidates[0]
    return sorted(candidates, key=lambda candidate: (len(candidate.parts), len(str(candidate))))[0]


def _resolve_model_path(
    path: str,
    models_dir: Path,
    name: str,
    gguf_by_filename: dict[str, list[Path]],
    gguf_by_slug: dict[str, list[Path]],
) -> str:
    if path:
        direct = Path(path)
        if direct.is_file():
            return str(direct.resolve())

        filename = direct.name.lower()
        if filename and filename in gguf_by_filename:
            return str(_pick_best_gguf(gguf_by_filename[filename]).resolve())

    search_name = name or Path(path).stem
    if search_name:
        explicit = search_name if search_name.lower().endswith(".gguf") else f"{search_name}.gguf"
        matches = gguf_by_filename.get(explicit.lower())
        if matches:
            return str(_pick_best_gguf(matches).resolve())

    name_slug = _normalize_slug(search_name)
    if not name_slug:
        return path

    exact = gguf_by_slug.get(name_slug)
    if exact:
        return str(_pick_best_gguf(exact).resolve())

    fuzzy: list[Path] = []
    for slug, files in gguf_by_slug.items():
        if name_slug == slug or name_slug in slug or slug in name_slug:
            fuzzy.extend(files)

    if fuzzy:
        return str(_pick_best_gguf(fuzzy).resolve())

    return path


def _resolve_health_status(health: dict[str, Any], runtime_entry: dict[str, Any]) -> str:
    status = str(health.get("status") or "").strip().lower()
    if status in {"ok", "healthy", "ready"}:
        return "ok"
    if runtime_entry.get("load_ok") is True:
        return "ok"
    if status:
        return status
    return "unknown"


def _compatibility(artifact_type: str, launcher: str, health_status: str, path: str = "") -> str:
    normalized_launcher = normalize_launcher(launcher)
    normalized_health = str(health_status or "unknown").strip().lower()
    if (
        artifact_type == "model"
        and normalized_launcher == "llama-server"
        and path
        and not Path(path).exists()
    ):
        return "llama_server_missing_file"
    if artifact_type in {"adapter", "lora", "mmproj"}:
        return "support_artifact"
    if artifact_type == "diffusion_model":
        return "requires_media_runtime"
    if normalized_launcher == "ollama" and normalized_health == "ok":
        return "ollama_ready"
    if normalized_launcher == "ollama":
        return "ollama_candidate"
    if normalized_launcher == "llama-server" and normalized_health == "ok":
        return "llama_server_ready"
    if normalized_launcher == "llama-server":
        return "llama_server_candidate"
    return "external_runtime_required"


def _priority(model: IndexedModel) -> int:
    order = {
        "primary_coding": 0,
        "coding_candidate": 1,
        "chat_candidate": 2,
        "review_agent": 3,
        "orchestrator": 4,
        "vision_candidate": 5,
        "embedding": 6,
        "reranker": 7,
        "media_pipeline": 8,
        "adapter_only": 9,
        "unsupported": 10,
    }
    return order[model.recommended_use]


def _ollama_model_id_slug(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_")
    return slug.lower() if slug else "model"


def _ollama_model_name(manifest_path: Path, manifests_dir: Path) -> str:
    relative = manifest_path.relative_to(manifests_dir)
    parts = relative.parts
    if len(parts) >= 3:
        namespace = parts[-3]
        name = parts[-2]
        tag = parts[-1]
        return f"{namespace}/{name}:{tag}" if namespace != "library" else f"{name}:{tag}"
    if len(parts) >= 2:
        return f"{parts[-2]}:{parts[-1]}"
    return manifest_path.stem


def _ollama_manifest_size(manifest: dict[str, Any], ollama_models_dir: Path) -> int:
    size = 0
    blobs_dir = ollama_models_dir / "blobs"
    for layer in manifest.get("layers", []):
        digest = str(layer.get("digest") or "")
        layer_size = layer.get("size")
        if isinstance(layer_size, int):
            size += layer_size
            continue
        blob_path = blobs_dir / digest.replace(":", "-")
        if blob_path.exists():
            size += blob_path.stat().st_size
    return size


def _ollama_quantization(manifest: dict[str, Any]) -> str | None:
    details = manifest.get("details")
    if isinstance(details, dict):
        quantization = details.get("quantization_level")
        if isinstance(quantization, str):
            return quantization
    return None
