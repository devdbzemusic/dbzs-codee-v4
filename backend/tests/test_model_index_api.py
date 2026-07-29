import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.models.index_service import ModelIndexService
from app.api.models import get_model_index_service


def test_model_index_endpoint_returns_summary(tmp_path: Path) -> None:
    (tmp_path / "models.catalog.json").write_text(
        json.dumps(
            {
                "base_dir": str(tmp_path),
                "runtime_dir": str(tmp_path / "llama.cpp-win-runtime"),
                "artifacts": [
                    {
                        "id": "coder",
                        "name": "Qwen2.5-Coder-3B-Q8_0",
                        "artifact_type": "model",
                        "role": "CODE_MODEL",
                        "capabilities": ["chat", "code"],
                        "modality": ["text"],
                        "file_path": str(tmp_path / "coder.gguf"),
                        "size_bytes": 1_000,
                        "backend": "llama.cpp",
                        "loader": {"launcher": "llama-server"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    app.dependency_overrides[get_model_index_service] = lambda: ModelIndexService(
        models_dir=tmp_path,
        ollama_models_dir=tmp_path / "empty-ollama",
    )
    client = TestClient(app)

    response = client.get("/models/index")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["summary"]["total"] == 1
    assert response.json()["models"][0]["recommended_use"] == "coding_candidate"


def test_manual_multimodal_pairing_endpoint_persists_manual_mapping(tmp_path: Path) -> None:
    base_model = tmp_path / "vision-chat-q4.gguf"
    projector = tmp_path / "manual-projector-f16.gguf"
    base_model.write_bytes(b"GGUF")
    projector.write_bytes(b"GGUF")
    (tmp_path / "models.catalog.json").write_text(
        json.dumps(
            {
                "models": [
                    {
                        "id": "base-model",
                        "name": "Vision Chat",
                        "artifact_type": "model",
                        "file_path": str(base_model),
                        "size_bytes": 4,
                        "backend": "llama.cpp",
                        "loader": {"launcher": "llama-server"},
                    },
                    {
                        "id": "proj-1",
                        "name": "manual-projector-f16",
                        "artifact_type": "mmproj",
                        "file_path": str(projector),
                        "size_bytes": 4,
                        "backend": "llama.cpp",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    app.dependency_overrides[get_model_index_service] = lambda: ModelIndexService(
        models_dir=tmp_path,
        ollama_models_dir=tmp_path / "empty-ollama",
    )
    client = TestClient(app)

    response = client.post(
        "/models/multimodal-pairings/manual",
        json={"base_model_id": "base-model", "projector_artifact_id": "proj-1"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "manual"
    assert payload["base_model_id"] == "base-model"
    assert payload["projector_artifact_id"] == "proj-1"
