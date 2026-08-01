"""
Shared helpers for the in-process ONNX Runtime adapters (embedding + reranker,
Plan 14, Phase 2). Kept separate from both client modules so neither client
has to import the other.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from app.model_lab.repository import ModelLabRepository


def build_input_feed(session: Any, input_ids: list[list[int]], attention_mask: list[list[int]]) -> dict[str, Any]:
    input_names = {item.name for item in session.get_inputs()} if hasattr(session, "get_inputs") else set()
    feed: dict[str, Any] = {}
    if "input_ids" in input_names or not input_names:
        feed["input_ids"] = as_int_array(input_ids)
    if "attention_mask" in input_names or not input_names:
        feed["attention_mask"] = as_int_array(attention_mask)
    if "token_type_ids" in input_names:
        feed["token_type_ids"] = as_int_array([[0] * len(row) for row in input_ids])
    return feed


def as_int_array(values: list[list[int]]) -> Any:
    try:
        import numpy as np  # local import: only needed on the real-session path

        return np.array(values, dtype=np.int64)
    except ImportError:  # pragma: no cover - numpy ships with onnxruntime
        return values


def resolve_onnx_bundle_paths(repository: ModelLabRepository, bundle_id: str) -> tuple[Path, Path]:
    """Resolves a Model Lab bundle id to (onnx model path, tokenizer path).

    Raises `ValueError` with a user-facing message (German, matching the rest
    of the settings/RAG error surface) when the bundle or a required artifact
    is missing.
    """
    model = repository.get_model(bundle_id)
    if model is None:
        raise ValueError(f"Modell nicht gefunden in Model Lab: {bundle_id}")

    model_artifact = next(
        (artifact for artifact in model.artifacts if artifact.artifact_type == "model" and artifact.format == "onnx"),
        None,
    )
    if model_artifact is None:
        raise ValueError(f"Bundle {bundle_id} enthaelt kein .onnx-Modellartefakt.")

    tokenizer_artifact = next(
        (artifact for artifact in model.artifacts if artifact.artifact_type == "tokenizer"),
        None,
    )
    if tokenizer_artifact is None:
        raise ValueError(f"Bundle {bundle_id} enthaelt keinen Tokenizer (tokenizer.json im selben Ordner erwartet).")

    return Path(model_artifact.path), Path(tokenizer_artifact.path)
