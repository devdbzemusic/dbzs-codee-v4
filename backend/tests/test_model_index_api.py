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
