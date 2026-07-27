from __future__ import annotations

import json
from urllib import error

from app.runtime.schemas import RuntimeStatus
from app.runtime.service import RuntimeService, normalize_runtime_endpoint


def test_normalize_runtime_endpoint_rewrites_bind_all_hosts() -> None:
    assert normalize_runtime_endpoint("http://0.0.0.0:8081/") == "http://127.0.0.1:8081"
    assert normalize_runtime_endpoint("http://127.0.0.1:8081") == "http://127.0.0.1:8081"


class _FakeHeaders(dict):
    def get(self, key, default=None):  # type: ignore[override]
        return dict.get(self, key, default)


class FakeResponse:
    def __init__(self, body: bytes, content_type: str = "text/event-stream"):
        self._body = body
        self.headers = _FakeHeaders({"Content-Type": content_type})

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self) -> bytes:
        return self._body


def test_warmup_slot_inference_ready(monkeypatch) -> None:
    service = RuntimeService.__new__(RuntimeService)
    service._simulation_mode = False
    service._slots = {}
    service._statuses = {
        "fast_gpu": RuntimeStatus(
            state="running",
            model_id="planner-model",
            model_name="Planner",
            endpoint="http://0.0.0.0:8081",
            slot_id="fast_gpu",
        )
    }
    service._endpoint_checker = lambda endpoint: endpoint == "http://127.0.0.1:8081"

    sse = b"".join(
        [
            b'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n',
            b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
            b"data: [DONE]\n",
        ]
    )
    calls: list[str] = []
    payloads: list[dict] = []

    def fake_urlopen(request_obj, timeout=None):
        calls.append(request_obj.full_url)
        payloads.append(json.loads(request_obj.data.decode("utf-8")))
        return FakeResponse(sse)

    monkeypatch.setattr("app.runtime.service.request.urlopen", fake_urlopen)

    result = service.warmup_slot_inference("fast_gpu", model_id="planner-model", timeout_ms=5_000)

    assert result.ok is True
    assert result.outcome == "inference_ready"
    assert result.readiness_stage == "inference_ready"
    assert result.diagnostics is not None
    assert result.diagnostics.token_count >= 1
    assert result.diagnostics.stream_mode is True
    assert calls == ["http://127.0.0.1:8081/v1/chat/completions"]
    assert payloads[0]["stream"] is True


def test_warmup_falls_back_to_non_stream_when_sse_empty(monkeypatch) -> None:
    service = RuntimeService.__new__(RuntimeService)
    service._simulation_mode = False
    service._slots = {}
    service._statuses = {
        "fast_gpu": RuntimeStatus(
            state="running",
            model_id="planner-model",
            model_name="Planner",
            endpoint="http://127.0.0.1:8081",
            slot_id="fast_gpu",
        )
    }
    service._endpoint_checker = lambda _endpoint: True

    payloads: list[dict] = []

    def fake_urlopen(request_obj, timeout=None):
        payload = json.loads(request_obj.data.decode("utf-8"))
        payloads.append(payload)
        if payload.get("stream"):
            return FakeResponse(b"data: [DONE]\n")
        return FakeResponse(
            json.dumps({"choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}]}).encode(
                "utf-8"
            ),
            content_type="application/json",
        )

    monkeypatch.setattr("app.runtime.service.request.urlopen", fake_urlopen)

    result = service.warmup_slot_inference("fast_gpu", model_id="planner-model", timeout_ms=5_000)

    assert result.ok is True
    assert result.outcome == "inference_ready"
    assert result.diagnostics is not None
    assert result.diagnostics.stream_mode is False
    assert result.readiness_stage == "token_generation_verified"
    assert len(payloads) == 2


def test_warmup_slot_inference_http_200_without_token_not_ready(monkeypatch) -> None:
    service = RuntimeService.__new__(RuntimeService)
    service._simulation_mode = False
    service._slots = {}
    service._statuses = {
        "fast_gpu": RuntimeStatus(
            state="running",
            model_id="planner-model",
            model_name="Planner",
            endpoint="http://127.0.0.1:8081",
            slot_id="fast_gpu",
        )
    }
    service._endpoint_checker = lambda _endpoint: True

    def fake_urlopen(request_obj, timeout=None):
        payload = json.loads(request_obj.data.decode("utf-8"))
        if payload.get("stream"):
            return FakeResponse(b"data: [DONE]\n")
        return FakeResponse(
            json.dumps({"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}).encode(
                "utf-8"
            ),
            content_type="application/json",
        )

    monkeypatch.setattr("app.runtime.service.request.urlopen", fake_urlopen)

    result = service.warmup_slot_inference("fast_gpu", model_id="planner-model", timeout_ms=5_000)

    assert result.ok is False
    assert result.outcome == "warmup_empty_response"
    assert result.readiness_stage != "inference_ready"


def test_warmup_slot_inference_binding_mismatch() -> None:
    service = RuntimeService.__new__(RuntimeService)
    service._simulation_mode = False
    service._slots = {}
    service._statuses = {
        "fast_gpu": RuntimeStatus(
            state="running",
            model_id="yi-coder",
            model_name="Yi",
            endpoint="http://127.0.0.1:8081",
            slot_id="fast_gpu",
        )
    }
    service._endpoint_checker = lambda _endpoint: True

    result = service.warmup_slot_inference("fast_gpu", model_id="planner-model")

    assert result.ok is False
    assert result.outcome == "binding_mismatch"


def test_warmup_slot_inference_timeout(monkeypatch) -> None:
    service = RuntimeService.__new__(RuntimeService)
    service._simulation_mode = False
    service._slots = {}
    service._statuses = {
        "fast_gpu": RuntimeStatus(
            state="running",
            model_id="planner-model",
            model_name="Planner",
            endpoint="http://127.0.0.1:8081",
            slot_id="fast_gpu",
        )
    }
    service._endpoint_checker = lambda _endpoint: True

    def fake_urlopen(request_obj, timeout=None):
        raise TimeoutError("timed out")

    monkeypatch.setattr("app.runtime.service.request.urlopen", fake_urlopen)

    result = service.warmup_slot_inference("fast_gpu", model_id="planner-model", timeout_ms=1000)

    assert result.ok is False
    assert result.outcome == "warmup_timeout"


def test_warmup_slot_inference_oom(monkeypatch) -> None:
    service = RuntimeService.__new__(RuntimeService)
    service._simulation_mode = False
    service._slots = {}
    service._statuses = {
        "fast_gpu": RuntimeStatus(
            state="running",
            model_id="planner-model",
            model_name="Planner",
            endpoint="http://127.0.0.1:8081",
            slot_id="fast_gpu",
        )
    }
    service._endpoint_checker = lambda _endpoint: True

    def fake_urlopen(request_obj, timeout=None):
        class FakeBody:
            def read(self):
                return b"CUDA out of memory"

            def close(self):
                return None

        raise error.HTTPError(
            request_obj.full_url,
            500,
            "OOM",
            hdrs=None,
            fp=FakeBody(),
        )

    monkeypatch.setattr("app.runtime.service.request.urlopen", fake_urlopen)

    result = service.warmup_slot_inference("fast_gpu", model_id="planner-model")

    assert result.ok is False
    assert result.outcome == "runtime_oom"
