from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import hashlib
import json
import logging
import re
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

OnIndexProgress = Callable[[int, int], None]
OnIndexModelError = Callable[[str, Exception], None]

from app.core.config import get_app_data_dir, get_models_dir, get_ollama_dir, get_ollama_models_dir
from app.core.gguf_metadata import read_gguf_metadata
from app.model_lab.repository import ModelLabRepository
from app.models.model_lab_bridge import additional_scan_roots, enrich_with_model_lab_health
# from app.models.index_service import ModelIndexService  # Zirkulärer Import entfernt
from app.models.launcher import normalize_launcher
from app.models.schemas import IndexedModel, ModelIndex, ModelIndexSummary, ModelRuntimeHints, MultimodalPair, RecommendedUse
from app.models.discovery import ModelDiscoveryService
from app.settings.models import ModelDiscoveryMode
from app.settings.service import SettingsService

# Plan 15, Phase 2: per-extra-root safety caps for the Model Lab bridge scan,
# since Model Lab source roots can be large, user-registered directories the
# ModelIndexService has no prior knowledge of (unlike self.models_dir).
MODEL_LAB_BRIDGE_MAX_FILES_PER_ROOT = 500
MODEL_LAB_BRIDGE_SCAN_BUDGET_SECONDS = 5.0


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

MODEL_INDEX_CACHE_SCHEMA_VERSION = 1
MODEL_INDEX_CACHE_METADATA_VERSION = 2  # bumped: real GGUF header parsing (Plan 14, Phase 0.1)
MODEL_INDEX_CACHE_HEADER_BYTES = 4096
GGUF_MAGIC = b"GGUF"


@dataclass
class ModelIndexBuildMetrics:
    scanned_file_count: int = 0
    candidate_count: int = 0
    valid_model_count: int = 0
    invalid_model_count: int = 0
    cached_model_count: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "scannedFileCount": self.scanned_file_count,
            "candidateCount": self.candidate_count,
            "validModelCount": self.valid_model_count,
            "invalidModelCount": self.invalid_model_count,
            "cachedModelCount": self.cached_model_count,
        }


@dataclass
class CatalogPairingHint:
    source: str = "catalog"
    base_model_id: str | None = None
    base_model_path: str | None = None
    projector_artifact_id: str | None = None
    projector_path: str | None = None
    requires_projector: bool = False
    routing_allowed: bool = False


class ModelIndexService:
    def __init__(
        self,
        models_dir: Path | None = None,
        ollama_dir: Path | None = None,
        ollama_models_dir: Path | None = None,
        cache_dir: Path | None = None,
        discovery_mode: ModelDiscoveryMode = "local_with_ollama",
        model_lab_repository: ModelLabRepository | Callable[[], ModelLabRepository] | None = None,
        settings_service: SettingsService | None = None,
    ) -> None:
        self.models_dir = models_dir or get_models_dir()
        self.ollama_dir = ollama_dir or get_ollama_dir()
        self.ollama_models_dir = ollama_models_dir or get_ollama_models_dir()
        self.cache_dir = cache_dir or (get_app_data_dir() / "cache")
        self.cache_path = self.cache_dir / "model-index-cache.json"
        self.discovery_mode = discovery_mode
        # Model Lab bridge (Plan 14, Phase 0.2) is opt-in, not on-by-default:
        # it can involve scanning additional, potentially large directories the
        # user registered in Model Lab, so every ad-hoc/test ModelIndexService()
        # construction must not silently touch real Model Lab data. Real app
        # call sites pass an actual ModelLabRepository explicitly to enable it.
        #
        # `model_lab_repository` may also be a zero-arg factory (Plan 15, Phase 2
        # production wiring passes get_shared_model_lab_repository, not a
        # pre-built instance): ModelLabRepository's constructor does real disk
        # I/O (creates the sqlite file, runs schema migrations), so resolving it
        # eagerly here would do that work on every ModelIndexService() call -
        # including module-import-time singletons - even when the bridge setting
        # is off. The factory form defers that work to _model_lab_bridge_active(),
        # which only resolves it once the settings check has already passed.
        if model_lab_repository is None or isinstance(model_lab_repository, ModelLabRepository):
            self._model_lab_repository_factory: Callable[[], ModelLabRepository] | None = None
            self._resolved_model_lab_repository: ModelLabRepository | None = model_lab_repository
        else:
            self._model_lab_repository_factory = model_lab_repository
            self._resolved_model_lab_repository = None
        # Plan 15, Phase 2: an optional second gate on top of `model_lab_repository`.
        # When a settings_service is given, the bridge additionally requires
        # `enableModelLabRuntimeBridge=True`; without a settings_service, passing a
        # repository is sufficient (preserves the Plan 14 opt-in behavior above).
        self.settings_service = settings_service
        self.last_build_metrics = ModelIndexBuildMetrics()
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
        self.last_build_metrics = ModelIndexBuildMetrics()
        catalog_path = self.models_dir / "models.catalog.json"
        if catalog_path.exists():
            catalog_index = self._from_catalog(catalog_path, on_progress=on_progress, on_model_error=on_model_error)
            catalog_metrics = self.last_build_metrics
            filesystem_index = self._from_filesystem(on_progress=on_progress, on_model_error=on_model_error)
            filesystem_metrics = self.last_build_metrics
            index = self._merge_discovered_indexes(catalog_index, filesystem_index)
            self.last_build_metrics = ModelIndexBuildMetrics(
                scanned_file_count=catalog_metrics.scanned_file_count + filesystem_metrics.scanned_file_count,
                candidate_count=catalog_metrics.candidate_count + filesystem_metrics.candidate_count,
                valid_model_count=len(index.models),
                invalid_model_count=catalog_metrics.invalid_model_count + filesystem_metrics.invalid_model_count,
                cached_model_count=filesystem_metrics.cached_model_count,
            )
        else:
            index = self._from_filesystem(on_progress=on_progress, on_model_error=on_model_error)

        # P1 Phase 4: Filter models based on discovery mode
        if self.discovery_mode == "project_local_strict":
            # Only project-local models, no Ollama
            return self._enrich_with_model_lab(index)

        ollama_models = self._ollama_models()
        if not ollama_models:
            self._persist_cache(index)
            return self._enrich_with_model_lab(index)

        # local_with_ollama or cloud_enabled: include Ollama
        merged = _build_index(
            generated_from=f"{index.generated_from};ollama:{self.ollama_dir}",
            models_dir=self.models_dir,
            runtime_dir=index.summary.runtime_dir,
            ollama_dir=str(self.ollama_dir),
            ollama_models_dir=str(self.ollama_models_dir),
            models=[*index.models, *ollama_models],
        )
        self.last_build_metrics.valid_model_count = len(merged.models)
        self._persist_cache(merged)
        return self._enrich_with_model_lab(merged)

    def _merge_discovered_indexes(self, catalog_index: ModelIndex, filesystem_index: ModelIndex) -> ModelIndex:
        models: list[IndexedModel] = []
        seen_ids: set[str] = set()
        seen_paths: set[str] = set()

        def add_model(model: IndexedModel) -> None:
            normalized_path = str(Path(model.path).expanduser()).lower()
            if model.id in seen_ids or normalized_path in seen_paths:
                return
            models.append(model)
            seen_ids.add(model.id)
            seen_paths.add(normalized_path)

        for model in catalog_index.models:
            add_model(model)
        for model in filesystem_index.models:
            add_model(model)

        merged = _build_index(
            generated_from=f"{catalog_index.generated_from};{filesystem_index.generated_from}",
            models_dir=self.models_dir,
            runtime_dir=catalog_index.summary.runtime_dir or filesystem_index.summary.runtime_dir,
            ollama_dir=catalog_index.summary.ollama_dir or filesystem_index.summary.ollama_dir,
            ollama_models_dir=catalog_index.summary.ollama_models_dir or filesystem_index.summary.ollama_models_dir,
            models=models,
        )
        catalog_projector_ids = {
            pair.projector_artifact_id
            for pair in catalog_index.multimodal_pairs
            if pair.projector_artifact_id
        }
        pairings_by_id = {
            pair.id: pair
            for pair in merged.multimodal_pairs
            if pair.projector_artifact_id not in catalog_projector_ids
        }
        for pair in catalog_index.multimodal_pairs:
            pairings_by_id[pair.id] = pair
        return merged.model_copy(update={"multimodal_pairs": sorted(pairings_by_id.values(), key=lambda pair: pair.id)})

    @property
    def model_lab_repository(self) -> ModelLabRepository | None:
        if self._resolved_model_lab_repository is None and self._model_lab_repository_factory is not None:
            self._resolved_model_lab_repository = self._model_lab_repository_factory()
        return self._resolved_model_lab_repository

    def _model_lab_bridge_active(self) -> bool:
        # Check the settings gate BEFORE resolving model_lab_repository: when a
        # factory was passed (production wiring), resolving it constructs a real
        # ModelLabRepository (disk I/O, schema migrations) - only do that once we
        # know the bridge is actually supposed to be on.
        if self._resolved_model_lab_repository is None and self._model_lab_repository_factory is None:
            return False
        if self.settings_service is not None and not bool(self.settings_service.load().enableModelLabRuntimeBridge):
            return False
        return self.model_lab_repository is not None

    def _enrich_with_model_lab(self, index: ModelIndex) -> ModelIndex:
        if not self._model_lab_bridge_active():
            return index
        return enrich_with_model_lab_health(index, repository=self.model_lab_repository)

    def load_cached_index(self) -> ModelIndex | None:
        payload = self._load_cache_payload()
        if not payload:
            return None
        index_payload = payload.get("index")
        if not isinstance(index_payload, dict):
            return None
        try:
            index = ModelIndex.model_validate(index_payload)
        except Exception:
            return None
        metrics_payload = payload.get("metrics")
        if isinstance(metrics_payload, dict):
            self.last_build_metrics = ModelIndexBuildMetrics(
                scanned_file_count=int(metrics_payload.get("scannedFileCount", 0)),
                candidate_count=int(metrics_payload.get("candidateCount", 0)),
                valid_model_count=int(metrics_payload.get("validModelCount", len(index.models))),
                invalid_model_count=int(metrics_payload.get("invalidModelCount", 0)),
                cached_model_count=int(metrics_payload.get("cachedModelCount", len(index.models))),
            )
        else:
            self.last_build_metrics = ModelIndexBuildMetrics(
                scanned_file_count=len(index.models),
                candidate_count=len(index.models),
                valid_model_count=len(index.models),
                invalid_model_count=0,
                cached_model_count=len(index.models),
            )
        return index

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
        pairing_hints: list[CatalogPairingHint] = []

        # V2-Kompatibilität: Unterstütze sowohl "models" als auch "artifacts"
        entries = catalog.get("models", []) or catalog.get("artifacts", [])
        total = len(entries)
        invalid_count = 0

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
                pairing_hints.extend(
                    _catalog_pairing_hints_for_entry(
                        entry=entry,
                        model_id=model_id,
                        resolved_path=path,
                        artifact_type=artifact_type,
                    )
                )

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
                        exclusion_reasons=_model_exclusion_reasons(
                            path=path,
                            model_format=Path(path).suffix.lower().lstrip(".") or "unknown",
                            artifact_type=artifact_type,
                            launcher=launcher,
                            health_status=health_status,
                            runtime=runtime,
                            server=server,
                        ),
                    )
                )
            except Exception as exc:  # noqa: BLE001 - one corrupt entry must not abort the whole index
                invalid_count += 1
                if on_model_error is not None:
                    identifier = str(entry.get("id") or entry.get("name") or entry.get("path") or f"entry[{index}]")
                    on_model_error(identifier, exc)
            finally:
                if on_progress is not None:
                    on_progress(index + 1, total)

        built = _build_index(
            generated_from=f"catalog:{catalog_path}",
            models_dir=self.models_dir,
            runtime_dir=_resolve_catalog_runtime_dir(catalog.get("runtime_dir")),
            ollama_dir=str(self.ollama_dir) if self.ollama_dir.exists() else None,
            ollama_models_dir=str(self.ollama_models_dir) if self.ollama_models_dir.exists() else None,
            models=models,
            pairing_hints=pairing_hints,
        )
        self.last_build_metrics = ModelIndexBuildMetrics(
            scanned_file_count=total,
            candidate_count=total,
            valid_model_count=len(built.models),
            invalid_model_count=invalid_count,
            cached_model_count=0,
        )
        return built

    def _scan_model_lab_extra_roots(self) -> list[Path]:
        """Plan 15, Phase 2: bounded scan of Model Lab source roots.

        Each root is capped at MODEL_LAB_BRIDGE_MAX_FILES_PER_ROOT files, and the
        whole extra-roots scan stops early once MODEL_LAB_BRIDGE_SCAN_BUDGET_SECONDS
        has elapsed — Model Lab roots are user-registered directories this service
        has no prior size guarantees about, unlike self.models_dir.
        """
        assert self.model_lab_repository is not None
        extra_roots = additional_scan_roots(exclude=self.models_dir, repository=self.model_lab_repository)
        started_at = time.monotonic()
        found: list[Path] = []
        for root in extra_roots:
            if time.monotonic() - started_at >= MODEL_LAB_BRIDGE_SCAN_BUDGET_SECONDS:
                logger.warning(
                    "Model Lab bridge scan budget exceeded (%.1fs); skipping remaining root %s",
                    MODEL_LAB_BRIDGE_SCAN_BUDGET_SECONDS,
                    root,
                )
                break
            root_paths = [p for p in sorted(root.rglob("*.gguf")) if p.is_file()]
            if len(root_paths) > MODEL_LAB_BRIDGE_MAX_FILES_PER_ROOT:
                logger.warning(
                    "Model Lab bridge root %s has %d GGUF files, capping at %d",
                    root,
                    len(root_paths),
                    MODEL_LAB_BRIDGE_MAX_FILES_PER_ROOT,
                )
                root_paths = root_paths[:MODEL_LAB_BRIDGE_MAX_FILES_PER_ROOT]
            found.extend(root_paths)
        return found

    def _from_filesystem(
        self,
        *,
        on_progress: OnIndexProgress | None = None,
        on_model_error: OnIndexModelError | None = None,
    ) -> ModelIndex:
        models: list[IndexedModel] = []
        runtime_by_id = self._runtime_by_id()
        state_by_id = self._state_by_id()
        cache_payload = self._load_cache_payload()
        cache_entries = cache_payload.get("ggufEntries", {}) if cache_payload else {}
        if not isinstance(cache_entries, dict):
            cache_entries = {}
        next_cache_entries: dict[str, dict[str, object]] = {}
        invalid_count = 0
        cached_count = 0

        gguf_paths = [p for p in sorted(self.models_dir.rglob("*.gguf")) if p.is_file()]
        if self._model_lab_bridge_active():
            gguf_paths.extend(self._scan_model_lab_extra_roots())
        total = len(gguf_paths)

        for index, model_path in enumerate(gguf_paths):
            try:
                path = str(model_path.resolve())
                _validate_gguf_header(model_path)
                signature = _build_file_signature(model_path)
                cached_entry = cache_entries.get(path)
                if isinstance(cached_entry, dict) and cached_entry.get("signature") == signature:
                    cached_model_payload = cached_entry.get("model")
                    if isinstance(cached_model_payload, dict):
                        cached_model = IndexedModel.model_validate(cached_model_payload)
                        models.append(cached_model)
                        next_cache_entries[path] = {
                            "signature": signature,
                            "model": cached_model.model_dump(mode="json"),
                        }
                        cached_count += 1
                        continue

                model_id = _stable_id(path)
                runtime_entry = runtime_by_id.get(model_id, {})
                runtime = runtime_entry.get("runtime", {})
                server = runtime_entry.get("server", {})
                health = state_by_id.get(model_id, {})
                gguf_metadata = read_gguf_metadata(model_path)
                artifact_type = _infer_artifact_type(path, architecture=gguf_metadata.architecture if gguf_metadata else None)
                capabilities = _infer_capabilities(path)
                modality = _infer_modality(path, artifact_type)
                size_bytes = model_path.stat().st_size
                name = model_path.stem
                health_status = _resolve_health_status(health, runtime_entry)
                quantization = (gguf_metadata.quantization if gguf_metadata else None) or _infer_quantization(name)

                model = IndexedModel(
                    id=model_id,
                    name=name,
                    path=path,
                    format="gguf",
                    artifact_type=artifact_type,
                    size_bytes=size_bytes,
                    size_gb=round(size_bytes / 1024**3, 3),
                    quantization=quantization,
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
                    exclusion_reasons=_model_exclusion_reasons(
                        path=path,
                        model_format="gguf",
                        artifact_type=artifact_type,
                        launcher="llama-server",
                        health_status=health_status,
                        runtime=runtime,
                        server=server,
                    ),
                )
                models.append(model)
                next_cache_entries[path] = {
                    "signature": signature,
                    "model": model.model_dump(mode="json"),
                }
            except Exception as exc:  # noqa: BLE001 - one corrupt entry must not abort the whole index
                invalid_count += 1
                if on_model_error is not None:
                    on_model_error(str(model_path), exc)
            finally:
                if on_progress is not None:
                    on_progress(index + 1, total)

        built = _build_index(
            generated_from=f"filesystem:{self.models_dir}",
            models_dir=self.models_dir,
            runtime_dir=None,
            ollama_dir=str(self.ollama_dir) if self.ollama_dir.exists() else None,
            ollama_models_dir=str(self.ollama_models_dir) if self.ollama_models_dir.exists() else None,
            models=models,
            pairing_hints=None,
        )
        self.last_build_metrics = ModelIndexBuildMetrics(
            scanned_file_count=total,
            candidate_count=total,
            valid_model_count=len(built.models),
            invalid_model_count=invalid_count,
            cached_model_count=cached_count,
        )
        if cache_payload is None:
            cache_payload = self._new_cache_payload()
        cache_payload["ggufEntries"] = next_cache_entries
        cache_payload["metrics"] = self.last_build_metrics.as_dict()
        cache_payload["index"] = built.model_dump(mode="json")
        cache_payload["generatedAt"] = datetime.now(UTC).isoformat()
        self._write_cache_payload(cache_payload)
        return built

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

    def save_manual_multimodal_pairing(self, base_model_id: str, projector_artifact_id: str) -> MultimodalPair:
        catalog_path = self.models_dir / "models.catalog.json"
        if not catalog_path.exists():
            raise ValueError("models.catalog.json fehlt; manuelle Zuordnung braucht einen persistierten Katalog.")

        catalog = _read_json(catalog_path)
        _, entries = _catalog_entries(catalog)

        base_entry = _find_catalog_entry(entries, base_model_id)
        if base_entry is None:
            raise ValueError(f"Basismodell '{base_model_id}' wurde im Katalog nicht gefunden.")
        projector_entry = _find_catalog_entry(entries, projector_artifact_id)
        if projector_entry is None:
            raise ValueError(f"Projector '{projector_artifact_id}' wurde im Katalog nicht gefunden.")

        base_artifact_type = str(base_entry.get("artifact_type") or base_entry.get("type") or "")
        projector_artifact_type = str(projector_entry.get("artifact_type") or projector_entry.get("type") or "")
        if base_artifact_type != "model":
            raise ValueError(f"Ein manuelles Basismodell muss artifact_type='model' sein, nicht '{base_artifact_type or 'unknown'}'.")
        if projector_artifact_type != "mmproj":
            raise ValueError(
                f"Ein manueller Projector muss artifact_type='mmproj' sein, nicht '{projector_artifact_type or 'unknown'}'."
            )

        for entry in entries:
            _clear_manual_pairing(entry, base_model_id=base_model_id, projector_artifact_id=projector_artifact_id)

        base_pairing = _entry_pairing_dict(base_entry)
        base_pairing["source"] = "manual"
        base_pairing["projector_model_id"] = projector_artifact_id
        base_pairing["routing_allowed"] = False
        base_pairing.pop("projector_path", None)

        projector_pairing = _entry_pairing_dict(projector_entry)
        projector_pairing["source"] = "manual"
        projector_pairing["base_model_id"] = base_model_id
        projector_pairing["routing_allowed"] = False
        projector_pairing.pop("base_model_path", None)

        _write_json(catalog_path, catalog)

        index = self.build_index()
        pair = next(
            (
                item for item in index.multimodal_pairs
                if item.base_model_id == base_model_id and item.projector_artifact_id == projector_artifact_id
            ),
            None,
        )
        if pair is None:
            raise ValueError("Manuelle Zuordnung wurde gespeichert, konnte aber nicht wieder aus dem Index aufgeloest werden.")
        return pair

    def mark_multimodal_pair_verified(self, base_model_id: str, projector_artifact_id: str) -> MultimodalPair:
        catalog_path = self.models_dir / "models.catalog.json"
        if not catalog_path.exists():
            raise ValueError("models.catalog.json fehlt; Runtime-Verifikation braucht einen persistierten Katalog.")

        catalog = _read_json(catalog_path)
        _, entries = _catalog_entries(catalog)

        base_entry = _find_catalog_entry(entries, base_model_id)
        if base_entry is None:
            raise ValueError(f"Basismodell '{base_model_id}' wurde im Katalog nicht gefunden.")
        projector_entry = _find_catalog_entry(entries, projector_artifact_id)
        if projector_entry is None:
            raise ValueError(f"Projector '{projector_artifact_id}' wurde im Katalog nicht gefunden.")

        base_pairing = _entry_pairing_dict(base_entry)
        base_pairing["projector_model_id"] = projector_artifact_id
        base_pairing["routing_allowed"] = True

        projector_pairing = _entry_pairing_dict(projector_entry)
        projector_pairing["base_model_id"] = base_model_id
        projector_pairing["routing_allowed"] = True

        if not base_pairing.get("source"):
            base_pairing["source"] = "catalog"
        if not projector_pairing.get("source"):
            projector_pairing["source"] = "catalog"

        _write_json(catalog_path, catalog)

        index = self.build_index()
        pair = next(
            (
                item for item in index.multimodal_pairs
                if item.base_model_id == base_model_id and item.projector_artifact_id == projector_artifact_id
            ),
            None,
        )
        if pair is None:
            raise ValueError("Runtime-Verifikation wurde gespeichert, konnte aber nicht wieder aus dem Index aufgeloest werden.")
        return pair

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
                    exclusion_reasons=[],
                )
            )
        return models

    def _new_cache_payload(self) -> dict[str, object]:
        return {
            "schemaVersion": MODEL_INDEX_CACHE_SCHEMA_VERSION,
            "metadataVersion": MODEL_INDEX_CACHE_METADATA_VERSION,
            "modelsDir": str(self.models_dir.resolve()),
            "discoveryMode": self.discovery_mode,
        }

    def _load_cache_payload(self) -> dict[str, object] | None:
        if not self.cache_path.exists():
            return None
        try:
            payload = _read_json(self.cache_path)
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        if int(payload.get("schemaVersion", -1)) != MODEL_INDEX_CACHE_SCHEMA_VERSION:
            return None
        if int(payload.get("metadataVersion", -1)) != MODEL_INDEX_CACHE_METADATA_VERSION:
            return None
        if str(payload.get("modelsDir", "")) != str(self.models_dir.resolve()):
            return None
        if str(payload.get("discoveryMode", "")) != self.discovery_mode:
            return None
        return payload

    def _write_cache_payload(self, payload: dict[str, object]) -> None:
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            _write_json(self.cache_path, payload)
        except Exception:
            # Cache persistence is best-effort; never fail the live index build.
            return

    def _persist_cache(self, index: ModelIndex) -> None:
        payload = self._load_cache_payload() or self._new_cache_payload()
        payload["metrics"] = self.last_build_metrics.as_dict()
        payload["index"] = index.model_dump(mode="json")
        payload["generatedAt"] = datetime.now(UTC).isoformat()
        self._write_cache_payload(payload)


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)


def _stable_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def _validate_gguf_header(path: Path) -> None:
    with path.open("rb") as handle:
        magic = handle.read(len(GGUF_MAGIC))
    if magic != GGUF_MAGIC:
        raise ValueError(f"Invalid GGUF header for {path.name}")


def _build_file_signature(path: Path) -> dict[str, object]:
    stat = path.stat()
    with path.open("rb") as handle:
      header_hash = hashlib.sha1(handle.read(MODEL_INDEX_CACHE_HEADER_BYTES)).hexdigest()
    return {
        "absolutePath": str(path.resolve()),
        "sizeBytes": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "headerHash": header_hash,
        "metadataVersion": MODEL_INDEX_CACHE_METADATA_VERSION,
    }


def _resolve_catalog_runtime_dir(raw_runtime_dir: str | None) -> str | None:
    """Validate the catalog's declared runtime_dir and fall back to live
    discovery when it's stale (e.g. points at a renamed/empty directory).

    ModelIndexSummary.runtime_dir is consumed as-is by the frontend's
    pre-flight path validator (pathValidatorService.ts) before a model start
    is even attempted, so an unvalidated stale value here surfaces as a
    false "runtime directory not found" error even though the backend's own
    launch-time resolution (see runtime/launch.py's resolve_runtime_dir)
    would have found the real directory just fine.
    """
    if raw_runtime_dir and (Path(raw_runtime_dir) / "llama-server.exe").exists():
        return raw_runtime_dir

    from app.runtime.win_runtimes import first_win_llama_runtime_dir

    discovered = first_win_llama_runtime_dir()
    if discovered is not None:
        return str(discovered)
    return raw_runtime_dir


def _build_index(
    generated_from: str,
    models_dir: Path,
    runtime_dir: str | None,
    ollama_dir: str | None,
    ollama_models_dir: str | None,
    models: list[IndexedModel],
    pairing_hints: list[CatalogPairingHint] | None = None,
) -> ModelIndex:
    support_artifacts = [model for model in models if model.artifact_type != "model"]
    sorted_models = sorted(models, key=_priority)
    sorted_support_artifacts = sorted(
        support_artifacts,
        key=lambda model: (model.artifact_type, model.name.lower(), model.path.lower()),
    )
    multimodal_pairs = _infer_multimodal_pairs(sorted_models, pairing_hints=pairing_hints)
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
            adapters=sum(1 for m in sorted_support_artifacts if m.artifact_type in ("adapter", "lora")),
            support_artifact_count=len(sorted_support_artifacts),
            unsupported=sum(1 for m in sorted_models if m.recommended_use == "unsupported"),
        ),
        models=sorted_models,
        support_artifacts=sorted_support_artifacts,
        multimodal_pairs=multimodal_pairs,
    )


def _infer_quantization(name: str) -> str | None:
    match = re.search(r"(IQ\d_[A-Z]+|Q\d_K_[A-Z]+|Q\d_[A-Z0-9]+|F16|BF16)", name, re.IGNORECASE)
    return match.group(1).upper() if match else None


def _infer_artifact_type(path: str, architecture: str | None = None) -> str:
    # GGUF metadata is authoritative when available: llama.cpp's own converters
    # tag every CLIP vision-projector file with general.architecture="clip",
    # regardless of filename. Filename heuristics below are only a fallback for
    # when metadata couldn't be read (e.g. corrupt header, catalog-only entries).
    if architecture == "clip":
        return "mmproj"
    value = Path(path).name.lower()
    if "mmproj" in value:
        return "mmproj"
    if "lora" in value or "adapter" in value:
        return "adapter"
    if any(token in value for token in ["stable-diffusion", "sd3", "flux", "wan2", "z_image", "image_turbo"]):
        return "diffusion_model"
    return "model"


def _infer_capabilities(path: str) -> list[str]:
    value = Path(path).name.lower()
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
    value = Path(path).name.lower()
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


def _normalize_pairing_name(value: str) -> str:
    normalized = value.lower()
    normalized = normalized.removesuffix(".gguf")
    normalized = re.sub(r"\bmmproj\b", "", normalized)
    normalized = re.sub(r"\b(projector|vision|vl|clip|f16|bf16)\b", "", normalized)
    normalized = re.sub(r"\b(iq\d_[a-z]+|q\d_k_[a-z]+|q\d_[a-z0-9]+)\b", "", normalized)
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return normalized


def _catalog_pairing_hints_for_entry(
    *,
    entry: dict[str, Any],
    model_id: str,
    resolved_path: str,
    artifact_type: str,
) -> list[CatalogPairingHint]:
    loader = entry.get("loader", {})
    if not isinstance(loader, dict):
        loader = {}
    pairing = entry.get("pairing", {})
    if not isinstance(pairing, dict):
        pairing = {}

    def _first_text(*values: object) -> str | None:
        for value in values:
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    hints: list[CatalogPairingHint] = []
    pairing_source = _first_text(
        pairing.get("source"),
        entry.get("pairing_source"),
        loader.get("pairing_source"),
    )
    pairing_mode = _first_text(
        pairing.get("mode"),
        entry.get("pairing_mode"),
        loader.get("pairing_mode"),
    )
    source = "manual" if pairing_source == "manual" or pairing_mode == "manual" or entry.get("manual_pairing") is True else "catalog"
    routing_allowed = bool(
        pairing.get("routing_allowed") is True
        or pairing.get("verified") is True
        or entry.get("routing_allowed") is True
        or entry.get("pairing_verified") is True
    )
    requires_mmproj = bool(loader.get("requires_mmproj") or entry.get("requires_mmproj"))
    projector_id = _first_text(
        pairing.get("projector_model_id"),
        loader.get("mmproj_model_id"),
        entry.get("mmproj_model_id"),
        loader.get("projector_model_id"),
        entry.get("projector_model_id"),
        entry.get("projector_id"),
        entry.get("paired_projector_id"),
    )
    projector_path = _first_text(
        pairing.get("projector_path"),
        loader.get("mmproj_path"),
        entry.get("mmproj_path"),
        loader.get("projector_path"),
        entry.get("projector_path"),
        entry.get("paired_projector_path"),
    )
    if artifact_type == "model" and (requires_mmproj or projector_id or projector_path):
        hints.append(
            CatalogPairingHint(
                source=source,
                base_model_id=model_id,
                base_model_path=resolved_path,
                projector_artifact_id=projector_id,
                projector_path=projector_path,
                requires_projector=requires_mmproj or projector_id is not None or projector_path is not None,
                routing_allowed=routing_allowed,
            )
        )

    if artifact_type == "mmproj":
        base_model_id = _first_text(
            pairing.get("base_model_id"),
            entry.get("base_model_id"),
            entry.get("paired_model_id"),
            entry.get("model_id"),
        )
        base_model_path = _first_text(
            pairing.get("base_model_path"),
            entry.get("base_model_path"),
            entry.get("paired_model_path"),
            entry.get("model_path"),
        )
        if base_model_id or base_model_path:
            hints.append(
                CatalogPairingHint(
                    source=source,
                    base_model_id=base_model_id,
                    base_model_path=base_model_path,
                    projector_artifact_id=model_id,
                    projector_path=resolved_path,
                    requires_projector=True,
                    routing_allowed=routing_allowed,
                )
            )

    return hints


def _infer_multimodal_pairs(
    models: list[IndexedModel],
    *,
    pairing_hints: list[CatalogPairingHint] | None = None,
) -> list[MultimodalPair]:
    base_models = [model for model in models if model.artifact_type == "model" and model.format == "gguf"]
    base_models_by_dir: dict[str, list[IndexedModel]] = {}
    for model in base_models:
        base_models_by_dir.setdefault(str(Path(model.path).parent).lower(), []).append(model)

    models_by_id = {model.id: model for model in models}
    models_by_path = {str(Path(model.path)).lower(): model for model in models}
    models_by_name: dict[str, list[IndexedModel]] = {}
    models_by_filename: dict[str, list[IndexedModel]] = {}
    for model in models:
        models_by_name.setdefault(model.name.lower(), []).append(model)
        models_by_filename.setdefault(Path(model.path).name.lower(), []).append(model)

    pairs: list[MultimodalPair] = []
    handled_projector_ids: set[str] = set()

    for hint in pairing_hints or []:
        base_candidates = _resolve_pairing_candidates(
            explicit_id=hint.base_model_id,
            explicit_path=hint.base_model_path,
            models_by_id=models_by_id,
            models_by_path=models_by_path,
            models_by_name=models_by_name,
            models_by_filename=models_by_filename,
            expected_artifact_type="model",
        )
        projector_candidates = _resolve_pairing_candidates(
            explicit_id=hint.projector_artifact_id,
            explicit_path=hint.projector_path,
            models_by_id=models_by_id,
            models_by_path=models_by_path,
            models_by_name=models_by_name,
            models_by_filename=models_by_filename,
            expected_artifact_type="mmproj",
        )

        if len(projector_candidates) != 1:
            continue

        projector = projector_candidates[0]
        if projector.id in handled_projector_ids:
            continue

        if len(base_candidates) == 1:
            base_model = base_candidates[0]
            pairs.append(
                MultimodalPair(
                    id=f"{base_model.id}:{projector.id}",
                    base_model_id=base_model.id,
                    projector_artifact_id=projector.id,
                    modalities=["text", "image"],
                    source=hint.source,
                    confidence=1.0 if hint.source == "manual" else 0.99,
                    status="candidate",
                    routing_allowed=hint.routing_allowed,
                    candidate_base_model_ids=[base_model.id],
                )
            )
            handled_projector_ids.add(projector.id)
            continue

        if len(base_candidates) > 1:
            pairs.append(
                MultimodalPair(
                    id=f"ambiguous:{projector.id}",
                    base_model_id=None,
                    projector_artifact_id=projector.id,
                    modalities=["text", "image"],
                    source=hint.source,
                    confidence=0.4,
                    status="ambiguous",
                    routing_allowed=False,
                    candidate_base_model_ids=[model.id for model in base_candidates],
                )
            )
            handled_projector_ids.add(projector.id)
            continue

        if hint.requires_projector:
            pairs.append(
                MultimodalPair(
                    id=f"missing_base:{projector.id}",
                    base_model_id=None,
                    projector_artifact_id=projector.id,
                    modalities=["text", "image"],
                    source=hint.source,
                    confidence=0.0,
                    status="missing_base",
                    routing_allowed=False,
                    candidate_base_model_ids=[],
                )
            )
            handled_projector_ids.add(projector.id)

    for artifact in models:
        if artifact.artifact_type != "mmproj":
            continue
        if artifact.id in handled_projector_ids:
            continue

        parent_dir = str(Path(artifact.path).parent).lower()
        same_folder_models = base_models_by_dir.get(parent_dir, [])
        matching_models = _matching_same_folder_models(artifact, same_folder_models)

        if len(matching_models) == 1:
            base_model = matching_models[0]
            pairs.append(
                MultimodalPair(
                    id=f"{base_model.id}:{artifact.id}",
                    base_model_id=base_model.id,
                    projector_artifact_id=artifact.id,
                    modalities=["text", "image"],
                    source="same_folder",
                    confidence=0.92,
                    status="candidate",
                    routing_allowed=False,
                    candidate_base_model_ids=[base_model.id],
                )
            )
            continue

        if len(matching_models) > 1:
            pairs.append(
                MultimodalPair(
                    id=f"ambiguous:{artifact.id}",
                    base_model_id=None,
                    projector_artifact_id=artifact.id,
                    modalities=["text", "image"],
                    source="same_folder",
                    confidence=0.45,
                    status="ambiguous",
                    routing_allowed=False,
                    candidate_base_model_ids=[model.id for model in matching_models],
                )
            )
            continue

        if len(same_folder_models) == 1:
            base_model = same_folder_models[0]
            pairs.append(
                MultimodalPair(
                    id=f"{base_model.id}:{artifact.id}",
                    base_model_id=base_model.id,
                    projector_artifact_id=artifact.id,
                    modalities=["text", "image"],
                    source="same_folder",
                    confidence=0.72,
                    status="candidate",
                    routing_allowed=False,
                    candidate_base_model_ids=[base_model.id],
                )
            )
            continue

        pairs.append(
            MultimodalPair(
                id=f"missing_base:{artifact.id}" if not same_folder_models else f"ambiguous:{artifact.id}",
                base_model_id=None,
                projector_artifact_id=artifact.id,
                modalities=["text", "image"],
                source="same_folder",
                confidence=0.0 if not same_folder_models else 0.3,
                status="missing_base" if not same_folder_models else "ambiguous",
                routing_allowed=False,
                candidate_base_model_ids=[model.id for model in same_folder_models],
            )
        )

    return sorted(pairs, key=lambda pair: (pair.status, pair.projector_artifact_id, pair.base_model_id or ""))


def _matching_same_folder_models(artifact: IndexedModel, candidates: list[IndexedModel]) -> list[IndexedModel]:
    artifact_key = _normalize_pairing_name(artifact.name)
    if not artifact_key:
        return []

    matches: list[IndexedModel] = []
    for candidate in candidates:
        candidate_key = _normalize_pairing_name(candidate.name)
        if not candidate_key:
            continue
        if artifact_key == candidate_key or artifact_key in candidate_key or candidate_key in artifact_key:
            matches.append(candidate)
    return matches


def _resolve_pairing_candidates(
    *,
    explicit_id: str | None,
    explicit_path: str | None,
    models_by_id: dict[str, IndexedModel],
    models_by_path: dict[str, IndexedModel],
    models_by_name: dict[str, list[IndexedModel]],
    models_by_filename: dict[str, list[IndexedModel]],
    expected_artifact_type: str,
) -> list[IndexedModel]:
    if explicit_id:
        candidate = models_by_id.get(explicit_id)
        if candidate is not None and candidate.artifact_type == expected_artifact_type:
            return [candidate]
        return []

    if not explicit_path:
        return []

    normalized_path = str(Path(explicit_path)).lower()
    direct = models_by_path.get(normalized_path)
    if direct is not None and direct.artifact_type == expected_artifact_type:
        return [direct]

    filename = Path(explicit_path).name.lower()
    by_filename = [
        model for model in models_by_filename.get(filename, [])
        if model.artifact_type == expected_artifact_type
    ]
    if by_filename:
        return by_filename

    stem = Path(explicit_path).stem.lower()
    return [
        model for model in models_by_name.get(stem, [])
        if model.artifact_type == expected_artifact_type
    ]


def _catalog_entries(catalog: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    if isinstance(catalog.get("models"), list):
        return "models", catalog["models"]
    if isinstance(catalog.get("artifacts"), list):
        return "artifacts", catalog["artifacts"]
    catalog["models"] = []
    return "models", catalog["models"]


def _find_catalog_entry(entries: list[dict[str, Any]], model_id: str) -> dict[str, Any] | None:
    for entry in entries:
        if isinstance(entry, dict) and str(entry.get("id") or "") == model_id:
            return entry
    return None


def _entry_pairing_dict(entry: dict[str, Any]) -> dict[str, Any]:
    pairing = entry.get("pairing")
    if not isinstance(pairing, dict):
        pairing = {}
        entry["pairing"] = pairing
    return pairing


def _clear_manual_pairing(entry: dict[str, Any], *, base_model_id: str, projector_artifact_id: str) -> None:
    pairing = entry.get("pairing")
    if not isinstance(pairing, dict):
        return
    if pairing.get("source") != "manual":
        return

    references_base = (
        str(entry.get("id") or "") == base_model_id
        or str(pairing.get("base_model_id") or "") == base_model_id
        or str(pairing.get("projector_model_id") or "") == projector_artifact_id
    )
    references_projector = (
        str(entry.get("id") or "") == projector_artifact_id
        or str(pairing.get("projector_model_id") or "") == projector_artifact_id
        or str(pairing.get("base_model_id") or "") == base_model_id
    )
    if references_base or references_projector:
        entry.pop("pairing", None)


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


def _model_exclusion_reasons(
    *,
    path: str,
    model_format: str,
    artifact_type: str,
    launcher: str,
    health_status: str,
    runtime: dict[str, Any],
    server: dict[str, Any],
) -> list[str]:
    reasons: set[str] = set()
    normalized_launcher = normalize_launcher(launcher)
    normalized_health = str(health_status or "unknown").strip().lower()
    normalized_format = str(model_format or "unknown").strip().lower()

    if normalized_launcher == "llama-server" and normalized_format != "gguf":
        reasons.add("not_gguf")
    if path and not Path(path).exists():
        reasons.add("missing_file")
    if normalized_launcher not in {"llama-server", "ollama"}:
        reasons.add("unsupported_runtime")
    if normalized_launcher == "llama-server" and not bool(server.get("enabled", False)):
        reasons.add("missing_profile")
    if normalized_launcher == "llama-server" and runtime.get("gpu_layers") is None:
        reasons.add("unprofiled_gpu")
    if normalized_health not in {"ok", "unknown"}:
        reasons.add("health_failed")
    if artifact_type in {"adapter", "lora", "mmproj"}:
        reasons.add("unsupported_runtime")

    return sorted(reasons)


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
