"""Tests for bundle_id -> model_id resolution in the certification-run endpoint
(Plan 15, Phase 7 / Stufenplan Stufe 3)."""
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.model_profiles import get_runtime_service
from app.api.models import get_model_index_service
from app.main import app
from app.model_lab.models import ModelSourceCreate
from app.model_lab.repository import ModelLabRepository
from app.models.schemas import IndexedModel, ModelIndex, ModelIndexSummary, ModelRuntimeHints
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatResponse, RuntimeStatus
from tests.test_model_lab_repository import _artifact, _bundle
from app.settings.service import get_settings_service
from app.model_lab.repository import get_shared_model_lab_repository


class _AlwaysPassRuntimeService:
    def start_model(self, model_id: str, *, slot_id: str | None = None, config: dict | None = None) -> RuntimeStatus:
        return RuntimeStatus(state="running", message="ok")
        
    def stop_model(self, slot_id: str | None = None) -> RuntimeStatus:
        return RuntimeStatus(state="stopped", message="ok")

    def chat(self, request):
        category = request.messages[-1].content.split("case: ", 1)[1].split(".", 1)[0]
        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content=f'{{"category":"{category}","passed":true}}'),
            model_id=request.model_id,
            model_name="Fake",
        )


def _empty_summary() -> ModelIndexSummary:
    return ModelIndexSummary(
        models_dir="D:/Models",
        runtime_dir=None,
        ollama_dir=None,
        ollama_models_dir=None,
        total=1,
        gguf_total=1,
        ollama_total=0,
        llama_server_ready=1,
        ollama_ready=0,
        coding_candidates=0,
        vision_candidates=0,
        adapters=0,
        support_artifact_count=0,
        unsupported=0,
    )


class _FakeIndexService:
    def __init__(self, model_path: str) -> None:
        self._model_path = model_path

    def load_cached_index(self):
        return None

    def build_index(self) -> ModelIndex:
        return ModelIndex(
            generated_from="test",
            summary=_empty_summary(),
            models=[
                IndexedModel(
                    id="resolved-model",
                    name="Resolved",
                    path=self._model_path,
                    format="gguf",
                    artifact_type="model",
                    size_bytes=1024,
                    size_gb=0.001,
                    quantization="Q4_K_M",
                    backend="llama.cpp",
                    runtime_launcher="llama-server",
                    capabilities=["chat"],
                    modality=["text"],
                    role=None,
                    recommended_use="chat_candidate",
                    compatibility="llama_server_ready",
                    runtime=ModelRuntimeHints(),
                )
            ],
        )


class _FakeSettings:
    def __init__(self, enabled: bool) -> None:
        self.enableModelLabRuntimeBridge = enabled


class _FakeSettingsService:
    def __init__(self, enabled: bool) -> None:
        self._enabled = enabled

    def load(self) -> _FakeSettings:
        return _FakeSettings(self._enabled)


def _seed_bundle_at(repo: ModelLabRepository, model_path: Path) -> None:
    source = repo.create_source(ModelSourceCreate(path=str(model_path.parent)))
    artifact = _artifact(source_id=source.id, artifact_id="a1", bundle_id="b1").model_copy(
        update={"path": str(model_path)}
    )
    bundle = _bundle(source_id=source.id, artifact_id="a1")
    repo.save_scan_output(source=source, artifacts=[artifact], bundles=[bundle])


def test_certification_run_resolves_bundle_id_to_model_id(tmp_path: Path, monkeypatch) -> None:
    repo = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"fake-gguf")
    _seed_bundle_at(repo, model_path)

    monkeypatch.setattr("app.api.model_profiles.get_settings_service", lambda: _FakeSettingsService(True))
    app.dependency_overrides[get_shared_model_lab_repository] = lambda: repo
    app.dependency_overrides[get_runtime_service] = lambda: _AlwaysPassRuntimeService()
    app.dependency_overrides[get_model_index_service] = lambda: _FakeIndexService(str(model_path))
    client = TestClient(app)

    response = client.post("/model-profiles/certification/runs", json={"bundle_id": "b1", "hardware": "gpu:test"})

    app.dependency_overrides.clear()
        
    bundle = repo.get_model("b1")
    primary = [a for a in bundle.artifacts if a.artifact_id == bundle.bundle.primary_artifact_id][0]
    print("PRIMARY PATH:", primary.path, "RESOLVED:", Path(primary.path).resolve())
    print("INDEX PATH:", _FakeIndexService(str(model_path)).build_index().models[0].path, "RESOLVED:", Path(_FakeIndexService(str(model_path)).build_index().models[0].path).resolve())

    assert response.status_code == 200, response.json()
    payload = response.json()
    assert payload["model_id"] == "resolved-model"
    assert payload["bundle_id"] == "b1"
    assert payload["certified"] is True


def test_certification_run_rejects_bundle_id_when_bridge_disabled(tmp_path: Path, monkeypatch) -> None:
    repo = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    monkeypatch.setattr("app.api.model_profiles.get_settings_service", lambda: _FakeSettingsService(False))
    monkeypatch.setattr("app.api.model_profiles.get_shared_model_lab_repository", lambda: repo)

    app.dependency_overrides[get_runtime_service] = lambda: _AlwaysPassRuntimeService()
    client = TestClient(app)

    response = client.post("/model-profiles/certification/runs", json={"bundle_id": "b1", "hardware": "gpu:test"})

    app.dependency_overrides.clear()
    assert response.status_code == 400


def test_certification_run_rejects_unresolvable_bundle_id(tmp_path: Path, monkeypatch) -> None:
    repo = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    monkeypatch.setattr("app.api.model_profiles.get_settings_service", lambda: _FakeSettingsService(True))
    monkeypatch.setattr("app.api.model_profiles.get_shared_model_lab_repository", lambda: repo)

    app.dependency_overrides[get_runtime_service] = lambda: _AlwaysPassRuntimeService()
    app.dependency_overrides[get_model_index_service] = lambda: _FakeIndexService("D:/Models/unrelated.gguf")
    client = TestClient(app)

    response = client.post(
        "/model-profiles/certification/runs", json={"bundle_id": "missing-bundle", "hardware": "gpu:test"}
    )

    app.dependency_overrides.clear()
    assert response.status_code == 400


def test_certification_run_rejects_missing_model_id_and_bundle_id() -> None:
    app.dependency_overrides[get_runtime_service] = lambda: _AlwaysPassRuntimeService()
    client = TestClient(app)

    response = client.post("/model-profiles/certification/runs", json={"hardware": "gpu:test"})

    app.dependency_overrides.clear()
    assert response.status_code == 422


def test_certification_run_still_accepts_plain_model_id_without_bundle(tmp_path: Path) -> None:
    app.dependency_overrides[get_runtime_service] = lambda: _AlwaysPassRuntimeService()
    client = TestClient(app)

    response = client.post(
        "/model-profiles/certification/runs", json={"model_id": "legacy-model", "hardware": "gpu:test"}
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["model_id"] == "legacy-model"
    assert payload["bundle_id"] is None
