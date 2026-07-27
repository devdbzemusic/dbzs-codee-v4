from fastapi.testclient import TestClient

from app.api.runtime import get_runtime_service
from app.main import app
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
    assert "timed out" in response.json()["detail"]


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
