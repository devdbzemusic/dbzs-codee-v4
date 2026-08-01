from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import fnmatch
import hashlib
import json
import re
from typing import Any

from app.core.gguf_metadata import read_gguf_metadata
from app.model_lab.analyzer import ModelLabAnalyzer
from app.model_lab.models import ArtifactType, ModelArtifact, ModelBundle, ModelSource


PRIMARY_MODEL_EXTENSIONS = {".gguf", ".safetensors", ".onnx"}
SUPPORT_EXTENSIONS = {".json", ".model", ".txt", ".md"}
KNOWN_FILENAMES = {
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer.model",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "README.md",
    "Modelfile",
}
QUANTIZATION_PATTERN = re.compile(r"(?:^|[-_.])((?:Q|IQ)\d(?:_[A-Z0-9]+)+|F16|BF16|Q8_0)(?:[-_.]|$)", re.IGNORECASE)


@dataclass(frozen=True)
class ScanOutput:
    total_files: int
    artifacts: list[ModelArtifact]
    bundles: list[ModelBundle]


class ModelLabScanner:
    def __init__(self, analyzer: ModelLabAnalyzer | None = None) -> None:
        self.analyzer = analyzer or ModelLabAnalyzer()

    def scan_source(self, source: ModelSource) -> ScanOutput:
        root = Path(source.path)
        paths = self._iter_candidate_paths(root, recursive=source.recursive, source=source)
        now = datetime.now(UTC)
        artifacts = [
            self._artifact_from_path(path, root=root, source_id=source.id, now=now)
            for path in paths
        ]
        bundles = self._build_bundles(artifacts, now=now)
        bundle_by_artifact_id = {
            artifact_id: bundle.bundle_id
            for bundle in bundles
            for artifact_id in bundle.artifact_ids
        }
        artifacts = [
            artifact.model_copy(update={"bundle_id": bundle_by_artifact_id.get(artifact.artifact_id)})
            for artifact in artifacts
        ]
        return ScanOutput(total_files=len(paths), artifacts=artifacts, bundles=bundles)

    def _iter_candidate_paths(self, root: Path, *, recursive: bool, source: ModelSource) -> list[Path]:
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Modellquelle existiert nicht oder ist kein Ordner: {root}")

        iterator = root.rglob("*") if recursive else root.glob("*")
        candidates: list[Path] = []
        for path in iterator:
            if not path.is_file():
                continue
            relative = path.relative_to(root)
            if self._matches_source_patterns(relative, source) and self._is_candidate(path):
                candidates.append(path.resolve())
        return sorted(candidates, key=lambda item: str(item).lower())

    def _matches_source_patterns(self, relative_path: Path, source: ModelSource) -> bool:
        normalized = str(relative_path).replace("\\", "/")
        if source.include_patterns and not any(fnmatch.fnmatch(normalized, pattern) for pattern in source.include_patterns):
            return False
        return not any(fnmatch.fnmatch(normalized, pattern) for pattern in source.exclude_patterns)

    def _is_candidate(self, path: Path) -> bool:
        suffix = path.suffix.lower()
        if suffix in PRIMARY_MODEL_EXTENSIONS:
            return True
        if path.name in KNOWN_FILENAMES:
            return True
        if suffix in SUPPORT_EXTENSIONS and self._infer_artifact_type(path) != "support":
            return True
        return _looks_like_ollama_manifest(path)

    def _artifact_from_path(self, path: Path, *, root: Path, source_id: str, now: datetime) -> ModelArtifact:
        sha256 = _sha256_file(path)
        artifact_type = self._infer_artifact_type(path)
        detected_name = _detected_name(path)
        metadata = _read_lightweight_metadata(path, artifact_type)
        gguf_metadata = read_gguf_metadata(path) if path.suffix.lower() == ".gguf" else None
        quantization = (gguf_metadata.quantization if gguf_metadata else None) or _infer_quantization(path.name)
        if gguf_metadata is not None:
            if gguf_metadata.architecture:
                metadata["gguf_architecture"] = gguf_metadata.architecture
            if gguf_metadata.context_length:
                metadata["gguf_context_length"] = gguf_metadata.context_length
            if gguf_metadata.block_count:
                metadata["gguf_block_count"] = gguf_metadata.block_count
        return ModelArtifact(
            artifact_id=sha256,
            installation_id=_installation_id(path),
            source_id=source_id,
            path=str(path),
            parent_path=str(path.parent),
            file_name=path.name,
            detected_name=detected_name,
            format=_format_name(path, artifact_type),
            artifact_type=artifact_type,
            size_bytes=path.stat().st_size,
            sha256=sha256,
            quantization=quantization,
            capabilities=_infer_capabilities(path, artifact_type, metadata),
            modalities=_infer_modalities(path, artifact_type, metadata),
            metadata=metadata,
            status="IDENTIFIED" if artifact_type in {"model", "mmproj", "ollama_manifest"} else "DISCOVERED",
            discovered_at=now,
            updated_at=now,
        )

    def _infer_artifact_type(self, path: Path) -> ArtifactType:
        name = path.name.lower()
        suffix = path.suffix.lower()
        if _looks_like_ollama_manifest(path):
            return "ollama_manifest"
        if suffix == ".gguf" and ("mmproj" in name or "projector" in name):
            return "mmproj"
        if suffix in PRIMARY_MODEL_EXTENSIONS:
            return "model"
        if "adapter" in name or "lora" in name:
            return "adapter"
        if "tokenizer" in name or name.endswith(".model"):
            return "tokenizer"
        if name.endswith(".json") and ("config" in name or name in {"special_tokens_map.json"}):
            return "config"
        if name.lower() == "readme.md":
            return "model_card"
        return "support"

    def _build_bundles(self, artifacts: list[ModelArtifact], *, now: datetime) -> list[ModelBundle]:
        by_dir: dict[str, list[ModelArtifact]] = defaultdict(list)
        for artifact in artifacts:
            by_dir[artifact.parent_path].append(artifact)

        bundles: list[ModelBundle] = []
        assigned: set[str] = set()
        for _, group in sorted(by_dir.items(), key=lambda item: item[0].lower()):
            primaries = [artifact for artifact in group if artifact.artifact_type in {"model", "ollama_manifest"}]
            supports = [artifact for artifact in group if artifact.artifact_type not in {"model", "ollama_manifest"}]
            if not primaries:
                continue

            for primary in primaries:
                matching_support = [
                    support for support in supports
                    if len(primaries) == 1 or _normalized_name(support.detected_name) in _normalized_name(primary.detected_name)
                    or _normalized_name(primary.detected_name) in _normalized_name(support.detected_name)
                ]
                artifact_ids = sorted({primary.artifact_id, *(artifact.artifact_id for artifact in matching_support)})
                assigned.update(artifact_ids)
                capabilities = sorted({capability for artifact in [primary, *matching_support] for capability in artifact.capabilities})
                modalities = sorted({modality for artifact in [primary, *matching_support] for modality in artifact.modalities})
                evidence = _bundle_evidence(primary, matching_support)
                health = self.analyzer.analyze_directory(Path(primary.parent_path))
                status = _bundle_status_from_health(health.status)
                bundles.append(
                    ModelBundle(
                        bundle_id=_bundle_id(artifact_ids),
                        name=primary.detected_name,
                        primary_artifact_id=primary.artifact_id,
                        artifact_ids=artifact_ids,
                        source_ids=sorted({artifact.source_id for artifact in [primary, *matching_support]}),
                        status=status,
                        capabilities=capabilities,
                        modalities=modalities,
                        evidence=evidence,
                        health=health,
                        created_at=now,
                        updated_at=now,
                    )
                )

        for support in artifacts:
            if support.artifact_id in assigned:
                continue
            if support.artifact_type in {"mmproj", "adapter"}:
                bundles.append(
                    ModelBundle(
                        bundle_id=_bundle_id([support.artifact_id]),
                        name=support.detected_name,
                        primary_artifact_id=None,
                        artifact_ids=[support.artifact_id],
                        source_ids=[support.source_id],
                        status="INCOMPLETE",
                        capabilities=support.capabilities,
                        modalities=support.modalities,
                        evidence=["support_artifact_without_base_model"],
                        created_at=now,
                        updated_at=now,
                    )
                )
        return sorted(bundles, key=lambda bundle: bundle.name.lower())


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _installation_id(path: Path) -> str:
    return hashlib.sha256(str(path.resolve()).lower().encode("utf-8")).hexdigest()


def _bundle_id(artifact_ids: list[str]) -> str:
    payload = "|".join(sorted(artifact_ids))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _format_name(path: Path, artifact_type: ArtifactType) -> str:
    if artifact_type == "ollama_manifest":
        return "ollama"
    return path.suffix.lower().lstrip(".") or "unknown"


def _detected_name(path: Path) -> str:
    if path.name.lower() == "readme.md":
        return path.parent.name
    return path.stem


def _infer_quantization(name: str) -> str | None:
    match = QUANTIZATION_PATTERN.search(name)
    return match.group(1).upper() if match else None


def _infer_capabilities(path: Path, artifact_type: ArtifactType, metadata: dict[str, Any]) -> list[str]:
    name = path.name.lower()
    capabilities: set[str] = set()
    if artifact_type in {"model", "ollama_manifest"}:
        capabilities.add("chat")
    if any(token in name for token in ("coder", "code", "fim")):
        capabilities.add("coding")
    if any(token in name for token in ("embed", "embedding")):
        capabilities.add("embedding")
    if any(token in name for token in ("rerank", "reranker")):
        capabilities.add("reranking")
    if artifact_type == "mmproj" or any(token in name for token in ("vision", "vl", "ocr", "image")):
        capabilities.add("vision")
    if metadata.get("pipeline_tag"):
        capabilities.add(str(metadata["pipeline_tag"]))
    return sorted(capabilities)


def _infer_modalities(path: Path, artifact_type: ArtifactType, metadata: dict[str, Any]) -> list[str]:
    name = path.name.lower()
    modalities: set[str] = set()
    if artifact_type in {"model", "ollama_manifest"}:
        modalities.add("text")
    if artifact_type == "mmproj" or any(token in name for token in ("vision", "vl", "ocr", "image")):
        modalities.add("image")
    if any(token in name for token in ("whisper", "audio", "tts", "speech")):
        modalities.add("audio")
    if metadata.get("modality"):
        modalities.add(str(metadata["modality"]))
    return sorted(modalities)


def _read_lightweight_metadata(path: Path, artifact_type: ArtifactType) -> dict[str, Any]:
    if artifact_type not in {"config", "ollama_manifest"}:
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    metadata: dict[str, Any] = {}
    for key in ("architectures", "model_type", "quantization_config", "pipeline_tag", "license"):
        if key in payload:
            metadata[key] = payload[key]
    if artifact_type == "ollama_manifest":
        metadata["ollama_layers"] = len(payload.get("layers", [])) if isinstance(payload.get("layers"), list) else 0
    return metadata


def _looks_like_ollama_manifest(path: Path) -> bool:
    if path.suffix:
        return False
    parts = [part.lower() for part in path.parts]
    return "manifests" in parts


def _normalized_name(value: str) -> str:
    normalized = re.sub(r"\b(mmproj|projector|vision|vl|clip|f16|bf16)\b", "", value.lower())
    normalized = re.sub(r"\b(iq\d_[a-z]+|q\d_k_[a-z]+|q\d_[a-z0-9]+)\b", "", normalized)
    return re.sub(r"[^a-z0-9]+", "", normalized)


def _bundle_evidence(primary: ModelArtifact, support: list[ModelArtifact]) -> list[str]:
    evidence = ["primary_artifact_hash"]
    if primary.quantization:
        evidence.append("filename_quantization")
    if any(item.artifact_type == "config" for item in support):
        evidence.append("same_folder_config")
    if any(item.artifact_type == "tokenizer" for item in support):
        evidence.append("same_folder_tokenizer")
    if any(item.artifact_type == "mmproj" for item in support):
        evidence.append("same_folder_projection_model")
    return evidence


def _bundle_status_from_health(status: str) -> str:
    if status == "healthy":
        return "IDENTIFIED"
    if status in {"incomplete", "empty"}:
        return "INCOMPLETE"
    if status == "error":
        return "BROKEN"
    return "DISCOVERED"
