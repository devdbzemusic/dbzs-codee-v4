from __future__ import annotations

from pathlib import Path

import pytest

from app.model_lab.scanner import ModelLabScanner


@pytest.mark.parametrize(
    ("file_name", "expected_type"),
    [
        # Primary models
        ("model.gguf", "model"),
        ("model.safetensors", "model"),
        ("model.onnx", "model"),
        # The fixed case: adapter name should have priority over primary extension
        ("adapter_model.safetensors", "adapter"),
        ("my-great-lora.safetensors", "adapter"),
        ("adapter.gguf", "adapter"),
        # Other types
        ("mmproj-model.gguf", "mmproj"),
        ("model-projector.gguf", "mmproj"),
        ("tokenizer.model", "tokenizer"),
        ("my_tokenizer.json", "config"),
        ("config.json", "config"),
        ("generation_config.json", "config"),
        ("README.md", "model_card"),
        ("some-other-file.txt", "support"),
        # Ollama manifest (special case, no extension)
        ("models/ollama/registry/v2/manifests/latest", "ollama_manifest"),
    ],
)
def test_infer_artifact_type(file_name: str, expected_type: str):
    """Tests the artifact type inference logic based on file names and paths."""
    scanner = ModelLabScanner()
    # We can use dummy paths, only the name/path structure matters
    path = Path(file_name)

    artifact_type = scanner._infer_artifact_type(path)

    assert artifact_type == expected_type
