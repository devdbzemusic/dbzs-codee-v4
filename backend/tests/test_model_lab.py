import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.model_lab import get_model_lab_service
from app.main import app
from app.model_lab.repository import ModelLabRepository
from app.model_lab.scanner import ModelLabScanner
from app.model_lab.service import ModelLabService


def _service(db_path: Path) -> ModelLabService:
    return ModelLabService(
        repository=ModelLabRepository(db_path=db_path),
        scanner=ModelLabScanner(),
    )


def test_model_lab_registry_initializes_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "model_lab.sqlite3"

    ModelLabRepository(db_path=db_path)

    with sqlite3.connect(db_path) as conn:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        version = conn.execute(
            "SELECT value FROM schema_info WHERE key = 'model_lab_schema_version'"
        ).fetchone()[0]

    assert "model_sources" in tables
    assert "model_artifacts" in tables
    assert "model_bundles" in tables
    assert version == "1"


def test_model_lab_source_scan_and_model_detail_api(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    model_path = models_dir / "qwen2.5-coder-3b-Q4_K_M.gguf"
    tokenizer_path = models_dir / "tokenizer.json"
    projector_path = models_dir / "qwen2.5-coder-3b-mmproj-f16.gguf"
    model_path.write_bytes(b"GGUF-model")
    tokenizer_path.write_text('{"model_type":"qwen2"}', encoding="utf-8")
    projector_path.write_bytes(b"GGUF-mmproj")

    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)

    source_response = client.post("/model-lab/sources", json={"path": str(models_dir), "name": "local"})
    assert source_response.status_code == 200
    source_id = source_response.json()["id"]
    duplicate_response = client.post("/model-lab/sources", json={"path": str(models_dir), "name": "local"})
    assert duplicate_response.status_code == 200
    assert duplicate_response.json()["id"] == source_id

    scan_response = client.post("/model-lab/scan", json={"source_id": source_id})
    assert scan_response.status_code == 200
    scan_payload = scan_response.json()
    assert scan_payload["job"]["status"] == "completed"
    assert scan_payload["job"]["artifact_count"] == 3
    assert scan_payload["job"]["bundle_count"] >= 1

    models_response = client.get("/model-lab/models")
    assert models_response.status_code == 200
    models = models_response.json()
    assert models
    primary = next(model for model in models if model["bundle"]["primary_artifact_id"])
    assert set(primary["bundle"]["capabilities"]) == {"chat", "coding", "vision"}
    assert set(primary["bundle"]["modalities"]) == {"image", "text"}
    assert len(primary["artifacts"]) == 3

    detail_response = client.get(f"/model-lab/models/{primary['bundle']['bundle_id']}")
    app.dependency_overrides.clear()
    assert detail_response.status_code == 200
    assert detail_response.json()["bundle"]["name"] == "qwen2.5-coder-3b-Q4_K_M"


def test_model_lab_rejects_invalid_source_path(tmp_path: Path) -> None:
    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)

    response = client.post("/model-lab/sources", json={"path": str(tmp_path / "missing")})

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "Modellquelle existiert nicht" in response.json()["detail"]
