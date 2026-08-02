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
    assert "logical_models" in tables
    assert "model_variants" in tables
    assert "runtime_adapters" in tables
    assert "hardware_snapshots" in tables
    assert "probe_runs" in tables
    assert "benchmark_runs" in tables
    assert "certifications" in tables
    assert "model_role_assignments" in tables
    assert "model_failures" in tables
    assert "agent_execution_policies" in tables
    assert version == "5"


def test_model_lab_hardware_endpoint_persists_snapshots(tmp_path: Path) -> None:
    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)

    hardware = client.get("/model-lab/hardware")
    snapshots = client.get("/model-lab/hardware-snapshots", params={"limit": 5})

    app.dependency_overrides.clear()
    assert hardware.status_code == 200
    assert snapshots.status_code == 200
    assert snapshots.json()[0]["fingerprint_hash"] == hardware.json()["fingerprint_hash"]
    assert snapshots.json()[0]["payload"]["runtime_backend"] == hardware.json()["runtime_backend"]


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


def test_model_lab_scan_requires_source_or_explicit_all_sources(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "tiny.gguf").write_bytes(b"GGUF-model")

    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)
    client.post("/model-lab/sources", json={"path": str(models_dir)})

    implicit_response = client.post("/model-lab/scan", json={})
    assert implicit_response.status_code == 400
    assert "source_id" in implicit_response.json()["detail"]

    explicit_response = client.post("/model-lab/scan", json={"all_sources": True})

    app.dependency_overrides.clear()
    assert explicit_response.status_code == 200
    assert explicit_response.json()["job"]["status"] == "completed"
    assert explicit_response.json()["job"]["artifact_count"] == 1


def test_model_lab_source_candidates_report_existing_and_registered_paths(tmp_path: Path) -> None:
    agentic = tmp_path / "Agentic"
    agentic.mkdir()
    service = _service(tmp_path / "test.sqlite3")
    service.source_candidates = (
        (str(agentic), "Agentic Model Fleet", True, "test"),
        (str(tmp_path / "missing"), "Missing", False, "test"),
    )
    app.dependency_overrides[get_model_lab_service] = lambda: service
    client = TestClient(app)

    before = client.get("/model-lab/source-candidates").json()
    assert before[0]["exists"] is True
    assert before[0]["recommended"] is True
    assert before[0]["already_registered"] is False
    assert before[1]["exists"] is False

    client.post("/model-lab/sources", json={"path": str(agentic)})
    after = client.get("/model-lab/source-candidates").json()

    app.dependency_overrides.clear()
    assert after[0]["already_registered"] is True


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


def test_model_lab_fleet_endpoints_record_safe_gates_and_roles(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "minicpm5-1b-agentic-tooluse-Q4_K_M.gguf").write_bytes(b"GGUF-model")

    app.dependency_overrides[get_model_lab_service] = lambda: _service(tmp_path / "test.sqlite3")
    client = TestClient(app)
    source_id = client.post("/model-lab/sources", json={"path": str(models_dir)}).json()["id"]
    client.post("/model-lab/scan", json={"source_id": source_id})
    bundle_id = client.get("/model-lab/models").json()[0]["bundle"]["bundle_id"]

    logical = client.get("/model-lab/logical-models")
    assert logical.status_code == 200
    assert logical.json()[0]["primary_bundle_id"] == bundle_id
    variants = client.get("/model-lab/variants", params={"logical_model_id": logical.json()[0]["logical_model_id"]})
    assert variants.status_code == 200
    assert variants.json()[0]["bundle_id"] == bundle_id

    adapters = client.get("/model-lab/runtime-adapters")
    assert adapters.status_code == 200
    assert adapters.json()[0]["id"] == "llama.cpp"
    presets = client.get("/model-lab/runtime-presets")
    assert presets.status_code == 200
    assert {preset["profile"] for preset in presets.json()} >= {"safe_balanced", "cpu_fallback"}
    policies = client.get("/model-lab/execution-policies")
    assert policies.status_code == 200
    assert {policy["role"] for policy in policies.json()} >= {"MAIN_AGENT", "MICRO_TOOL_AGENT"}
    benchmark = client.post(
        "/model-lab/benchmark",
        json={"bundle_id": bundle_id, "metrics": {"tokens_per_second": 12.5, "notes": "queued"}},
    )
    assert benchmark.status_code == 200
    measurements = client.get(
        "/model-lab/benchmark-measurements",
        params={"benchmark_run_id": benchmark.json()["id"]},
    )
    assert measurements.status_code == 200
    assert measurements.json()[0]["name"] == "tokens_per_second"
    assert measurements.json()[0]["unit"] == "tokens/s"

    probe = client.post("/model-lab/probe", json={"bundle_id": bundle_id})
    assert probe.status_code == 200
    assert probe.json()["status"] == "skipped"
    assert probe.json()["allow_start"] is False
    assert "command_preview" in probe.json()["metrics"]
    assert probe.json()["metrics"]["adapter_id"] == "llama.cpp"
    probe_evidence = client.get("/model-lab/capability-evidence", params={"bundle_id": bundle_id})
    assert "runtime_probe:llama.cpp" in {entry["capability"] for entry in probe_evidence.json()}

    role_without_evidence = client.post(
        "/model-lab/role-assignments",
        json={"bundle_id": bundle_id, "role": "MICRO_TOOL_AGENT", "safety_level": "LEVEL_1_READ_ONLY_TOOLS"},
    )
    assert role_without_evidence.status_code == 400
    assert "fehlende Zertifikate" in role_without_evidence.json()["detail"]

    for certification in ("TOOL_CALLING_VERIFIED", "READ_ONLY_AGENT_VERIFIED"):
        response = client.post(
            "/model-lab/certifications",
            json={"bundle_id": bundle_id, "certification": certification, "evidence": {"test": "unit"}},
        )
        assert response.status_code == 200

    evidence = client.post(
        "/model-lab/capability-evidence",
        json={"bundle_id": bundle_id, "capability": "tool_use", "status": "verified", "evidence": {"test": "unit"}},
    )
    assert evidence.status_code == 200
    evidence_list = client.get("/model-lab/capability-evidence", params={"bundle_id": bundle_id})
    assert evidence_list.status_code == 200
    evidence_capabilities = {entry["capability"] for entry in evidence_list.json()}
    assert "tool_use" in evidence_capabilities
    assert "certification:TOOL_CALLING_VERIFIED" in evidence_capabilities

    role = client.post(
        "/model-lab/role-assignments",
        json={"bundle_id": bundle_id, "role": "MICRO_TOOL_AGENT", "safety_level": "LEVEL_1_READ_ONLY_TOOLS"},
    )
    routing_map = client.get("/model-lab/routing-map", params={"role": "MICRO_TOOL_AGENT"})
    readiness = client.get("/model-lab/readiness", params={"bundle_id": bundle_id})
    app.dependency_overrides.clear()
    assert role.status_code == 200
    assert role.json()["enabled"] is True
    assert set(role.json()["required_certifications"]) == {"TOOL_CALLING_VERIFIED", "READ_ONLY_AGENT_VERIFIED"}
    assert routing_map.status_code == 200
    assert routing_map.json()[0]["bundle_id"] == bundle_id
    assert routing_map.json()[0]["routing_allowed"] is True
    assert routing_map.json()[0]["missing_certifications"] == []
    assert readiness.status_code == 200
    assert readiness.json()[0]["bundle_id"] == bundle_id
    assert readiness.json()[0]["latest_probe_status"] == "skipped"
    assert readiness.json()[0]["routing_allowed_roles"] == ["MICRO_TOOL_AGENT"]


def test_role_assignment_writes_resolved_model_into_settings(tmp_path: Path, monkeypatch) -> None:
    """WF-12 gap: assigning a certified bundle to a role with a concrete
    settings_field must actually make it selectable in Settings, not just
    record an internal Model Lab row."""
    app_data_dir = tmp_path / "app-data"
    app_data_dir.mkdir()
    monkeypatch.setenv("DBZS_APP_DATA_DIR", str(app_data_dir))
    monkeypatch.setenv("DBZS_MODELS_DIR", str(tmp_path / "empty-runtime-models"))

    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "coder-agent-Q4_K_M.gguf").write_bytes(b"GGUF-model")

    db_path = tmp_path / "test.sqlite3"
    app.dependency_overrides[get_model_lab_service] = lambda: _service(db_path)
    client = TestClient(app)
    try:
        # Runtime bridge must be enabled for Model-Lab bundles to enter the
        # runtime model index at all (default changed to True; set explicitly
        # here so the test doesn't depend on the shared DEFAULT_SETTINGS value).
        patch_response = client.get("/settings")
        assert patch_response.status_code == 200
        current_revision = patch_response.json()["revision"]
        enable_bridge = client.patch(
            "/settings",
            json={"baseRevision": current_revision, "changes": {"enableModelLabRuntimeBridge": True}},
        )
        assert enable_bridge.status_code == 200

        source_id = client.post("/model-lab/sources", json={"path": str(models_dir)}).json()["id"]
        client.post("/model-lab/scan", json={"source_id": source_id})
        bundle_id = client.get("/model-lab/models").json()[0]["bundle"]["bundle_id"]

        for certification in ("CODING_VERIFIED", "STRUCTURED_OUTPUT_VERIFIED", "WRITE_AGENT_VERIFIED"):
            response = client.post(
                "/model-lab/certifications",
                json={"bundle_id": bundle_id, "certification": certification, "evidence": {"test": "unit"}},
            )
            assert response.status_code == 200

        role = client.post(
            "/model-lab/role-assignments",
            json={
                "bundle_id": bundle_id,
                "role": "CODING_EXECUTOR",
                "settings_field": "defaultCoderModelId",
                "safety_level": "LEVEL_2_WORKSPACE_WRITE",
            },
        )
        assert role.status_code == 200
        assert role.json()["settings_field"] == "defaultCoderModelId"

        settings_after = client.get("/settings").json()
    finally:
        app.dependency_overrides.clear()

    assert settings_after["defaultCoderModelId"]
    assert settings_after["defaultCoderModelId"] != ""


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
