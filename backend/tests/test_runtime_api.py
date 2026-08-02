from pathlib import Path

from fastapi.testclient import TestClient

from app.api.runtime import get_runtime_service
from app.main import app
from app.model_lab.repository import ModelLabRepository, get_shared_model_lab_repository
from app.runtime.errors import RuntimeProviderError
from app.runtime.schemas import (
    RuntimeChatMessage,
    RuntimeChatRequest,
    RuntimeChatResponse,
    RuntimeLogsResponse,
    RuntimeStatus,
)


class FakeRuntimeService:
    def __init__(self) -> None:
        self.started_model_id: str | None = None

    def status(self) -> RuntimeStatus:
        return RuntimeStatus(state="stopped")

    def start_model(self, model_id: str) -> RuntimeStatus:
        self.started_model_id = model_id
        return RuntimeStatus(
            state="running",
            model_id=model_id,
            model_name="Coder",
            port=8081,
            pid=42,
            endpoint="http://127.0.0.1:8081",
        )

    def stop_model(self) -> RuntimeStatus:
        return RuntimeStatus(state="stopped")

    def chat(self, request: RuntimeChatRequest) -> RuntimeChatResponse:
        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content=f"ok: {request.messages[-1].content}"),
            model_id="coder",
            model_name="Coder",
        )

    def get_logs(self) -> RuntimeLogsResponse:
        return RuntimeLogsResponse(state="stopped", stderr_tail="probe stderr")

    def get_ram_pressure(self) -> tuple[float | None, str]:
        return 91.5, "evict_resident"


def test_runtime_api_starts_model() -> None:
    service = FakeRuntimeService()
    app.dependency_overrides[get_runtime_service] = lambda: service
    client = TestClient(app)

    response = client.post("/runtime/start", json={"model_id": "coder"})

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["state"] == "running"
    assert service.started_model_id == "coder"


def test_runtime_api_returns_status() -> None:
    app.dependency_overrides[get_runtime_service] = lambda: FakeRuntimeService()
    client = TestClient(app)

    response = client.get("/runtime/status")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["state"] == "stopped"


def test_runtime_api_returns_ram_pressure() -> None:
    app.dependency_overrides[get_runtime_service] = lambda: FakeRuntimeService()
    client = TestClient(app)

    response = client.get("/runtime/system/ram-pressure")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == {"percent_used": 91.5, "tier": "evict_resident"}


def test_runtime_api_sends_chat_request() -> None:
    app.dependency_overrides[get_runtime_service] = lambda: FakeRuntimeService()
    client = TestClient(app)

    response = client.post(
        "/runtime/chat",
        json={"messages": [{"role": "user", "content": "Hallo Runtime"}]},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["message"]["content"] == "ok: Hallo Runtime"


def test_runtime_api_accepts_structured_prompt_tool_definitions() -> None:
    app.dependency_overrides[get_runtime_service] = lambda: FakeRuntimeService()
    client = TestClient(app)

    response = client.post(
        "/runtime/chat",
        json={
            "messages": [{"role": "user", "content": "Hallo Runtime"}],
            "tools": {"mode": "prompt", "definitions": [{"name": "read_file"}]},
        },
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["message"]["content"] == "ok: Hallo Runtime"


def test_runtime_api_maps_chat_runtime_error_to_409() -> None:
    class FailingRuntimeService(FakeRuntimeService):
        def chat(self, request: RuntimeChatRequest) -> RuntimeChatResponse:
            raise RuntimeError("llama-server request timed out after 300s.")

    app.dependency_overrides[get_runtime_service] = lambda: FailingRuntimeService()
    client = TestClient(app)

    response = client.post(
        "/runtime/chat",
        json={"messages": [{"role": "user", "content": "Hallo Runtime"}]},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "provider_timeout"
    assert "timed out" in response.json()["detail"]["message"]


def test_runtime_api_preserves_structured_provider_error_detail() -> None:
    class TemplateFailingRuntimeService(FakeRuntimeService):
        def chat(self, request: RuntimeChatRequest) -> RuntimeChatResponse:
            raise RuntimeProviderError(
                "llama-server HTTP 500: chat template: Conversation roles must alternate",
                code="provider_template_error",
                recoverable=True,
                diagnostic_context={"stage": "chat_complete", "stderrTail": "jinja exception"},
                recommended_action="Chat-Nachrichten normalisieren und Anfrage erneut senden.",
            )

    app.dependency_overrides[get_runtime_service] = lambda: TemplateFailingRuntimeService()
    client = TestClient(app)

    response = client.post(
        "/runtime/chat",
        json={"messages": [{"role": "user", "content": "Hallo Runtime"}], "request_id": "req-1"},
    )

    app.dependency_overrides.clear()
    detail = response.json()["detail"]
    assert response.status_code == 409
    assert detail["code"] == "provider_template_error"
    assert detail["diagnosticContext"]["stage"] == "chat_complete"
    assert detail["diagnosticContext"]["stderrTail"] == "jinja exception"


def test_runtime_api_returns_doctor_report() -> None:
    client = TestClient(app)

    response = client.get("/runtime/doctor")

    assert response.status_code == 200
    payload = response.json()
    assert "checks" in payload
    assert "models" in payload
    assert "summary" in payload


def test_runtime_api_dry_run_unknown_model_returns_404() -> None:
    client = TestClient(app)

    response = client.post(
        "/runtime/doctor/dry-run",
        json={"model_id": "missing-model-id", "profile_name": "safe_cpu_coder"},
    )

    assert response.status_code == 404


def test_runtime_api_probe_disabled_by_default() -> None:
    client = TestClient(app)

    response = client.post(
        "/runtime/doctor/probe",
        json={"allow_start": False, "model_id": "coder"},
    )

    assert response.status_code == 200
    assert response.json()["allowed"] is False


def test_runtime_api_returns_runtime_logs() -> None:
    app.dependency_overrides[get_runtime_service] = lambda: FakeRuntimeService()
    client = TestClient(app)

    response = client.get("/runtime/logs")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["stderr_tail"] == "probe stderr"


def test_runtime_api_warmup_slot() -> None:
    class WarmupRuntimeService(FakeRuntimeService):
        def warmup_slot_inference(
            self,
            slot_id: str,
            *,
            model_id: str,
            decision_id: str | None = None,
            timeout_ms: int = 45_000,
        ):
            from app.runtime.schemas import RuntimeWarmupResult

            return RuntimeWarmupResult(
                ok=True,
                outcome="inference_ready",
                detail="OK",
                model_id=model_id,
                model_name="Planner",
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=9,
            )

    app.dependency_overrides[get_runtime_service] = lambda: WarmupRuntimeService()
    client = TestClient(app)

    response = client.post(
        "/runtime/slots/fast_gpu/warmup",
        json={"model_id": "planner-model", "timeout_ms": 1000},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["outcome"] == "inference_ready"
    assert payload["model_id"] == "planner-model"


# --- Plan 15, Phase 6: persistent runtime slot health/failure history ---


def test_runtime_api_records_and_lists_slot_health_events(tmp_path: Path) -> None:
    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    app.dependency_overrides[get_shared_model_lab_repository] = lambda: repository
    client = TestClient(app)

    post_response = client.post(
        "/runtime/slots/fast_gpu/health-events",
        json={"slot_id": "fast_gpu", "model_id": "coder.gguf", "event_type": "restart_attempt", "detail": "Versuch 1"},
    )
    get_response = client.get("/runtime/slots/fast_gpu/health-events")

    app.dependency_overrides.clear()
    assert post_response.status_code == 200
    assert post_response.json()["event_type"] == "restart_attempt"
    assert get_response.status_code == 200
    events = get_response.json()
    assert len(events) == 1
    assert events[0]["slot_id"] == "fast_gpu"
    assert events[0]["model_id"] == "coder.gguf"


def test_runtime_api_coerces_mismatched_slot_id_on_health_event(tmp_path: Path) -> None:
    repository = ModelLabRepository(db_path=tmp_path / "model_lab.sqlite3")
    app.dependency_overrides[get_shared_model_lab_repository] = lambda: repository
    client = TestClient(app)

    response = client.post(
        "/runtime/slots/fast_gpu/health-events",
        json={"slot_id": "utility", "event_type": "start"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    event = response.json()
    assert event["slot_id"] == "fast_gpu"


# --- Plan 15, Phase 5: dual-mode vision — projector_artifact_id resolution ---


def _empty_index_summary():
    from app.models.schemas import ModelIndexSummary

    return ModelIndexSummary(
        models_dir="D:/Models",
        runtime_dir=None,
        ollama_dir=None,
        ollama_models_dir=None,
        total=0,
        gguf_total=0,
        ollama_total=0,
        llama_server_ready=0,
        ollama_ready=0,
        coding_candidates=0,
        vision_candidates=0,
        adapters=0,
        support_artifact_count=1,
        unsupported=0,
    )


def _mmproj_artifact(artifact_id: str, path: str):
    from app.models.schemas import IndexedModel, ModelRuntimeHints

    return IndexedModel(
        id=artifact_id,
        name=artifact_id,
        path=path,
        format="gguf",
        artifact_type="mmproj",
        size_bytes=500,
        size_gb=0.0005,
        quantization="F16",
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=["vision"],
        modality=["image"],
        role=None,
        recommended_use="unsupported",
        compatibility="support_artifact",
        runtime=ModelRuntimeHints(),
    )


class _StubIndexServiceForProjector:
    def __init__(self, support_artifacts: list) -> None:
        self._support_artifacts = support_artifacts

    def load_cached_index(self):
        return None

    def build_index(self):
        from app.models.schemas import ModelIndex

        return ModelIndex(
            generated_from="test",
            summary=_empty_index_summary(),
            models=[],
            support_artifacts=self._support_artifacts,
        )


class RuntimeServiceWithProjector(FakeRuntimeService):
    def __init__(self, support_artifacts: list) -> None:
        super().__init__()
        self.model_index_service = _StubIndexServiceForProjector(support_artifacts)
        self.start_calls: list[dict] = []

    def start_model(self, model_id, *, slot_id=None, config=None):
        self.start_calls.append({"model_id": model_id, "slot_id": slot_id, "config": config})
        return RuntimeStatus(state="running", model_id=model_id, slot_id=slot_id)


def test_runtime_api_slot_start_resolves_projector_artifact_id_to_mmproj_path() -> None:
    service = RuntimeServiceWithProjector([_mmproj_artifact("coder-mmproj", "D:/Models/coder-mmproj.gguf")])
    app.dependency_overrides[get_runtime_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/runtime/slots/vision_gpu/start",
        json={"model_id": "coder", "projector_artifact_id": "coder-mmproj"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert len(service.start_calls) == 1
    call = service.start_calls[0]
    assert call["slot_id"] == "vision_gpu"
    assert call["config"]["mmproj_path"] == "D:/Models/coder-mmproj.gguf"
    assert call["config"]["mmproj_bytes"] == 500


def test_runtime_api_slot_start_rejects_unknown_projector_artifact_id() -> None:
    service = RuntimeServiceWithProjector([])
    app.dependency_overrides[get_runtime_service] = lambda: service

    client = TestClient(app)

    response = client.post(
        "/runtime/slots/vision_gpu/start",
        json={"model_id": "coder", "projector_artifact_id": "does-not-exist"},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert service.start_calls == []


def test_runtime_api_slot_start_without_projector_artifact_id_omits_mmproj_config() -> None:
    """Plain slot starts (no vision) must be unaffected by the new resolution path."""
    service = RuntimeServiceWithProjector([])
    app.dependency_overrides[get_runtime_service] = lambda: service
    client = TestClient(app)

    response = client.post("/runtime/slots/fast_gpu/start", json={"model_id": "coder"})

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert len(service.start_calls) == 1
    assert service.start_calls[0]["config"] is None
