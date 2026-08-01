import sqlite3
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.model_lab import get_model_lab_service
from app.main import app
from app.model_lab.analyzer import ModelLabAnalyzer
from app.model_lab.hf_integration import HuggingFaceModelService
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
    assert "model_metadata" in tables
    assert "model_collections" in tables
    assert version == "2"


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
    detail_payload = detail_response.json()
    assert detail_payload["bundle"]["name"] == "qwen2.5-coder-3b-Q4_K_M"
    assert detail_payload["bundle"]["health"]["status"] == "healthy"


def test_model_lab_rejects_invalid_source_path(tmp_path: Path) -> None:
    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)

    response = client.post("/model-lab/sources", json={"path": str(tmp_path / "missing")})

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "Modellquelle existiert nicht" in response.json()["detail"]


def test_model_lab_analyzer_classifies_model_shapes(tmp_path: Path) -> None:
    analyzer = ModelLabAnalyzer()
    gguf = tmp_path / "llm"
    embedding = tmp_path / "embedding"
    vision = tmp_path / "vision"
    transformer = tmp_path / "transformer"
    unknown = tmp_path / "unknown"
    for path in (gguf, embedding, vision, transformer, unknown):
        path.mkdir()

    (gguf / "model-q5_k_m.gguf").write_bytes(b"GGUF")
    (embedding / "modules.json").write_text("{}", encoding="utf-8")
    (embedding / "model.safetensors").write_bytes(b"model")
    (vision / "config.json").write_text('{"architectures":["VisionModel"],"max_position_embeddings":2048}', encoding="utf-8")
    (vision / "preprocessor_config.json").write_text("{}", encoding="utf-8")
    (vision / "model.safetensors").write_bytes(b"model")
    (transformer / "config.json").write_text('{"model_type":"qwen2","max_position_embeddings":32768}', encoding="utf-8")
    (transformer / "model.safetensors").write_bytes(b"model")
    (unknown / "README.md").write_text("no model", encoding="utf-8")

    assert analyzer.analyze_directory(gguf).model_type == "GGUF / LLM"
    assert analyzer.analyze_directory(gguf).quantization == "Q5_K_M"
    assert analyzer.analyze_directory(embedding).model_type == "Embeddings"
    assert analyzer.analyze_directory(vision).model_type == "Vision/Audio"
    assert analyzer.analyze_directory(transformer).context_length == 32768
    unknown_health = analyzer.analyze_directory(unknown)
    assert unknown_health.status == "incomplete"
    assert "Keine Modell-Dateien gefunden" in unknown_health.missing_critical


def test_model_lab_metadata_collections_and_duplicates_api(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    first = models_dir / "qwen-alpha"
    second = models_dir / "qwen-beta"
    first.mkdir(parents=True)
    second.mkdir(parents=True)
    (first / "model.gguf").write_bytes(b"same-size-a")
    (second / "model.gguf").write_bytes(b"same-size-b")

    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)
    source_id = client.post("/model-lab/sources", json={"path": str(models_dir)}).json()["id"]
    client.post("/model-lab/scan", json={"source_id": source_id})
    bundles = client.get("/model-lab/models").json()
    bundle_id = bundles[0]["bundle"]["bundle_id"]

    metadata_response = client.put(
        f"/model-lab/models/{bundle_id}/metadata",
        json={"tags": ["coding", "low-vram"], "is_favorite": True, "notes": "works locally"},
    )
    assert metadata_response.status_code == 200
    assert metadata_response.json()["is_favorite"] is True
    assert metadata_response.json()["tags"] == ["coding", "low-vram"]

    collection_response = client.post(
        "/model-lab/collections",
        json={"name": "Coding", "color": "#22D3EE", "description": "Coding models"},
    )
    assert collection_response.status_code == 200
    collection_id = collection_response.json()["id"]
    member_response = client.post(
        f"/model-lab/collections/{collection_id}/members",
        json={"bundle_id": bundle_id},
    )
    assert member_response.status_code == 200
    detail = client.get(f"/model-lab/models/{bundle_id}").json()
    assert detail["bundle"]["collection_ids"] == [collection_id]

    duplicates = client.get("/model-lab/duplicates").json()
    app.dependency_overrides.clear()
    assert duplicates
    assert duplicates[0]["model_count"] == 2


def test_huggingface_search_uses_category_filter_without_network() -> None:
    @dataclass
    class FakeModel:
        id: str
        pipeline_tag: str
        tags: list[str]
        downloads: int
        likes: int
        last_modified: datetime
        siblings: list[object]

    class FakeApi:
        def list_models(self, search: str, limit: int, full: bool) -> list[FakeModel]:
            return [
                FakeModel("org/embed", "feature-extraction", ["sentence-transformers"], 10, 2, datetime.now(UTC), []),
                FakeModel("org/vision", "image-to-text", ["vision"], 100, 5, datetime.now(UTC), []),
            ]

    service = HuggingFaceModelService()
    service._api = FakeApi()

    results = service.search_models("org", category="embeddings")

    assert [result.id for result in results] == ["org/embed"]
