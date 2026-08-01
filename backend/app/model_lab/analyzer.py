from __future__ import annotations

from pathlib import Path
import json
import re
from typing import Any

from app.model_lab.models import ModelHealth


CONFIG_CANDIDATES = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "sentence_bert_config.json",
    "modules.json",
]
OPTIONAL_TOKENIZER_FILES = ["tokenizer.json", "tokenizer_config.json", "vocab.txt", "tokenizer.model"]


class ModelLabAnalyzer:
    def analyze_directory(self, directory: Path) -> ModelHealth:
        if not directory.exists() or not directory.is_dir():
            return ModelHealth(status="error", issues=["Pfad existiert nicht oder ist kein Verzeichnis"])

        try:
            files = {path.name for path in directory.iterdir() if path.is_file()}
        except OSError as exc:
            return ModelHealth(status="error", issues=[f"Fehler beim Lesen: {exc}"])

        if not files:
            return ModelHealth(status="empty", issues=["Modellordner ist leer"])

        config_preview = _read_config_preview(directory / "config.json")
        model_type = classify_model_directory(files)
        architecture = _architecture(config_preview, files)
        context_length = _context_length(config_preview)
        quantization = _quantization(directory.name, files, config_preview)
        config_files = [name for name in CONFIG_CANDIDATES if name in files]

        missing_critical: list[str] = []
        if model_type != "GGUF / LLM" and "config.json" not in files:
            missing_critical.append("config.json")
        if not _has_model_file(files):
            missing_critical.append("Keine Modell-Dateien gefunden")

        optional_missing = [name for name in OPTIONAL_TOKENIZER_FILES if name not in files]
        issues = [*missing_critical, *optional_missing]
        status = "healthy" if not missing_critical else "incomplete"

        return ModelHealth(
            status=status,
            model_type=model_type,
            architecture=architecture,
            context_length=context_length,
            quantization=quantization,
            folder_size_bytes=folder_size_bytes(directory),
            config_files=config_files,
            missing_critical=missing_critical,
            optional_missing=optional_missing,
            issues=issues,
            config_preview=config_preview,
        )


def classify_model_directory(files: set[str]) -> str:
    names = {name.lower() for name in files}
    if any(name.endswith(".gguf") for name in names):
        return "GGUF / LLM"
    if "modules.json" in names or "sentence_bert_config.json" in names:
        return "Embeddings"
    if "preprocessor_config.json" in names and "config.json" in names:
        return "Vision/Audio"
    if "config.json" in names:
        return "Transformer"
    return "Unbekannt"


def folder_size_bytes(path: Path) -> int:
    total = 0
    try:
        for file_path in path.rglob("*"):
            if file_path.is_file():
                try:
                    total += file_path.stat().st_size
                except OSError:
                    pass
    except OSError:
        return 0
    return total


def duplicate_key(name: str, size_bytes: int) -> str:
    stem = re.split(r"[-_]", name, maxsplit=1)[0].lower() or name.lower()
    return f"{stem}:{size_bytes}"


def _read_config_preview(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    preview_keys = [
        "architectures",
        "model_type",
        "max_position_embeddings",
        "n_ctx",
        "hidden_size",
        "num_hidden_layers",
        "num_attention_heads",
        "torch_dtype",
        "_name_or_path",
    ]
    return {key: payload[key] for key in preview_keys if key in payload}


def _architecture(config: dict[str, Any], files: set[str]) -> str | None:
    architectures = config.get("architectures")
    if isinstance(architectures, list) and architectures:
        return str(architectures[0])
    if config.get("model_type"):
        return str(config["model_type"])
    if any(name.lower().endswith(".gguf") for name in files):
        return "GGUF Model"
    return None


def _context_length(config: dict[str, Any]) -> int | None:
    for key in ("max_position_embeddings", "n_ctx"):
        value = config.get(key)
        if isinstance(value, int):
            return value
    return None


def _quantization(directory_name: str, files: set[str], config: dict[str, Any]) -> str | None:
    haystack = " ".join([directory_name, *files, str(config.get("_name_or_path") or "")]).lower()
    for token in ("q2_k", "q3_k", "q4_0", "q4_1", "q4_k_m", "q4_k", "q5_0", "q5_1", "q5_k_m", "q5_k", "q6_k", "q8_0"):
        if token in haystack:
            return token.upper()
    if "gguf" in haystack:
        return "GGUF"
    return None


def _has_model_file(files: set[str]) -> bool:
    lower = {name.lower() for name in files}
    if any(name.endswith((".gguf", ".safetensors", ".bin", ".pt", ".pth", ".onnx")) for name in lower):
        return True
    return any(name.startswith("model-") and name.endswith(".safetensors") for name in lower)

