import json
from pathlib import Path

from app.runtime.doctor import (
    RuntimeProbeRequest,
    build_dry_run,
    build_runtime_doctor,
    probe_runtime,
)
from app.runtime.schemas import RuntimeStatus


def _write_gguf_catalog(models_dir: Path) -> None:
    runtime_dir = models_dir / "llama.cpp-win-runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "llama-server.exe").write_text("runtime", encoding="utf-8")
    (runtime_dir / "ggml.dll").write_text("mock", encoding="utf-8")
    (runtime_dir / "libssl-3-x64.dll").write_text("mock", encoding="utf-8")
    (runtime_dir / "libcrypto-3-x64.dll").write_text("mock", encoding="utf-8")
    model_path = models_dir / "coder.gguf"
    model_path.write_bytes(b"GGUF")
    catalog = {
        "runtime_dir": str(runtime_dir),
        "artifacts": [
            {
                "id": "coder",
                "name": "Coder Q4",
                "artifact_type": "model",
                "file_path": str(model_path),
                "size_bytes": 1000,
                "loader": {"launcher": "llama-server"},
            }
        ],
    }
    (models_dir / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")


def _write_multimodal_catalog(models_dir: Path) -> None:
    runtime_dir = models_dir / "llama.cpp-win-runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "llama-server.exe").write_text("runtime", encoding="utf-8")
    (runtime_dir / "ggml.dll").write_text("mock", encoding="utf-8")
    (runtime_dir / "libssl-3-x64.dll").write_text("mock", encoding="utf-8")
    (runtime_dir / "libcrypto-3-x64.dll").write_text("mock", encoding="utf-8")
    model_path = models_dir / "vision-base.gguf"
    projector_path = models_dir / "mmproj-vision-base-f16.gguf"
    model_path.write_bytes(b"GGUF")
    projector_path.write_bytes(b"GGUF")
    catalog = {
        "runtime_dir": str(runtime_dir),
        "models": [
            {
                "id": "vision-base",
                "name": "Vision Base",
                "artifact_type": "model",
                "file_path": str(model_path),
                "size_bytes": 1000,
                "backend": "llama.cpp",
                "loader": {
                    "launcher": "llama-server",
                    "requires_mmproj": True,
                    "mmproj_model_id": "vision-proj",
                },
            },
            {
                "id": "vision-proj",
                "name": "mmproj-vision-base-f16",
                "artifact_type": "mmproj",
                "file_path": str(projector_path),
                "size_bytes": 1000,
                "backend": "llama.cpp",
            },
        ],
    }
    (models_dir / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")


def test_runtime_doctor_with_temp_models_dir(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir(exist_ok=True)
    (models_dir / "models.catalog.json").write_text(
        '{"models":[{"id":"m1","name":"demo.gguf","absolute_path":"'
        + str(models_dir / "demo.gguf").replace("\\", "/")
        + '","artifact_type":"gguf","size_bytes":1024}]}',
        encoding="utf-8",
    )
    (models_dir / "demo.gguf").write_bytes(b"gguf")

    report = build_runtime_doctor(
        models_dir=models_dir,
        ollama_dir=tmp_path / "ollama",
        model_lab_repository=None,
        settings_service=None,
    )
    assert report.summary
    assert any(check.id == "models_dir" for check in report.checks)
    assert len(report.suggested_profiles) == 3


def test_runtime_doctor_uses_format_and_runtime_launcher_for_gguf_model(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    _write_gguf_catalog(models_dir)

    report = build_runtime_doctor(
        models_dir=models_dir,
        ollama_dir=tmp_path / "ollama",
        model_lab_repository=None,
        settings_service=None,
    )
    entry = next(item for item in report.models if item.model_id == "coder")

    assert entry.format == "gguf"
    assert entry.runtime_launcher == "llama-server"
    assert entry.artifact_type == "model"
    assert entry.provider == "llama.cpp"
    assert entry.runnable is True
    assert "llama-server.exe" in entry.command_preview
    assert "--gpu-layers 0" in entry.command_preview
    assert not any("llama-server.exe missing" in blocker for blocker in entry.blockers)


def test_runtime_dry_run_uses_runtime_service_command_builder(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    _write_gguf_catalog(models_dir)

    dry = build_dry_run(
        "coder",
        profile_name="safe_cpu_coder",
        models_dir=models_dir,
        ollama_dir=tmp_path / "ollama",
        model_lab_repository=None,
        settings_service=None,
    )

    assert "llama-server.exe" in dry.command_preview
    assert "--ctx-size 4096" in dry.command_preview
    assert "--gpu-layers 0" in dry.command_preview
    assert dry.preset["gpu_layers"] == 0


def test_runtime_doctor_strict_mode_skips_ollama_checks(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir(exist_ok=True)
    monkeypatch.setattr("app.runtime.doctor.get_model_discovery_mode", lambda: "project_local_strict")

    report = build_runtime_doctor(
        models_dir=models_dir,
        ollama_dir=tmp_path / "ollama",
        model_lab_repository=None,
        settings_service=None,
    )

    assert not any(check.id in ("ollama_exe", "ollama_models_dir", "port_11434") for check in report.checks)
    assert any(check.id == "ollama_discovery" and check.status == "ok" for check in report.checks)


def test_runtime_doctor_non_strict_mode_includes_ollama_checks(tmp_path: Path, monkeypatch) -> None:
    models_dir = tmp_path / "models"
    models_dir.mkdir(exist_ok=True)
    monkeypatch.setattr("app.runtime.doctor.get_model_discovery_mode", lambda: "local_with_ollama")

    report = build_runtime_doctor(
        models_dir=models_dir,
        ollama_dir=tmp_path / "ollama",
        model_lab_repository=None,
        settings_service=None,
    )

    assert any(check.id == "ollama_exe" for check in report.checks)
    assert any(check.id == "ollama_models_dir" for check in report.checks)
    assert any(check.id == "port_11434" for check in report.checks)


def test_runtime_probe_disabled_by_default() -> None:
    response = probe_runtime(RuntimeProbeRequest(allow_start=False))
    assert response.allowed is False


def test_runtime_probe_allow_start_runs_controlled_start(tmp_path: Path) -> None:
    _write_gguf_catalog(tmp_path)

    running = RuntimeStatus(
        state="running",
        provider="llama.cpp",
        model_id="coder",
        model_name="Coder Q4",
        port=8091,
        pid=42,
        endpoint="http://127.0.0.1:8091",
        message="ok",
    )
    stopped = RuntimeStatus(state="stopped", message="Runtime stopped.")

    class FakeRuntimeService:
        def start_model(self, model_id: str, *, slot_id: str | None = None, config: dict | None = None) -> RuntimeStatus:
            assert model_id == "coder"
            assert config is None
            return running

        def stop_model(self) -> RuntimeStatus:
            return stopped

        def get_logs(self):
            from app.runtime.schemas import RuntimeLogsResponse

            return RuntimeLogsResponse(state="running", model_id="coder")

    response = probe_runtime(
        RuntimeProbeRequest(allow_start=True, model_id="coder"),
        service=FakeRuntimeService(),  # type: ignore[arg-type]
        endpoint_verifier=lambda endpoint: (True, True, ["coder"]),
    )

    assert response.allowed is True
    assert "coder" in response.message
    assert response.endpoint_verified is True
    assert response.models_endpoint_verified is True
    assert response.advertised_models == ["coder"]
    assert response.vision_chat_verified is False


def test_runtime_probe_allows_mmproj_pairing_and_passes_mmproj_path(tmp_path: Path) -> None:
    _write_multimodal_catalog(tmp_path)

    running = RuntimeStatus(
        state="running",
        provider="llama.cpp",
        model_id="vision-base",
        model_name="Vision Base",
        port=8091,
        pid=42,
        endpoint="http://127.0.0.1:8091",
        message="ok",
    )
    stopped = RuntimeStatus(state="stopped", message="Runtime stopped.")

    class FakeRuntimeService:
        def __init__(self) -> None:
            self.received_config: dict | None = None

        def start_model(self, model_id: str, *, slot_id: str | None = None, config: dict | None = None) -> RuntimeStatus:
            assert model_id == "vision-base"
            self.received_config = config
            return running

        def stop_model(self) -> RuntimeStatus:
            return stopped

        def get_logs(self):
            from app.runtime.schemas import RuntimeLogsResponse

            return RuntimeLogsResponse(state="running", model_id="vision-base")

    fake_service = FakeRuntimeService()
    response = probe_runtime(
        RuntimeProbeRequest(
            allow_start=True,
            model_id="vision-base",
            projector_artifact_id="vision-proj",
        ),
        service=fake_service,  # type: ignore[arg-type]
        models_dir=tmp_path,
        ollama_dir=tmp_path / "ollama",
        ollama_models_dir=tmp_path / "ollama-models",
        model_lab_repository=None,
        settings_service=None,
        endpoint_verifier=lambda endpoint: (True, True, ["vision-base"]),
        multimodal_verifier=lambda runtime, endpoint, model_id: (True, "ok"),
    )

    assert response.allowed is True
    assert response.projector_artifact_id == "vision-proj"
    assert response.mmproj_path is not None
    assert fake_service.received_config == {"mmproj_path": response.mmproj_path}
    assert response.endpoint_verified is True
    assert response.models_endpoint_verified is True
    assert response.advertised_models == ["vision-base"]
    assert response.vision_chat_verified is True
    assert response.vision_response_preview == "ok"

    persisted = json.loads((tmp_path / "models.catalog.json").read_text(encoding="utf-8"))
    base_entry = next(entry for entry in persisted["models"] if entry["id"] == "vision-base")
    projector_entry = next(entry for entry in persisted["models"] if entry["id"] == "vision-proj")

    assert base_entry["pairing"]["routing_allowed"] is True
    assert projector_entry["pairing"]["routing_allowed"] is True


def test_runtime_probe_requires_endpoint_verification_before_marking_pair_verified(tmp_path: Path) -> None:
    _write_multimodal_catalog(tmp_path)

    running = RuntimeStatus(
        state="running",
        provider="llama.cpp",
        model_id="vision-base",
        model_name="Vision Base",
        port=8091,
        pid=42,
        endpoint="http://127.0.0.1:8091",
        message="ok",
    )
    stopped = RuntimeStatus(state="stopped", message="Runtime stopped.")

    class FakeRuntimeService:
        def start_model(self, model_id: str, *, slot_id: str | None = None, config: dict | None = None) -> RuntimeStatus:
            assert model_id == "vision-base"
            return running

        def stop_model(self) -> RuntimeStatus:
            return stopped

        def get_logs(self):
            from app.runtime.schemas import RuntimeLogsResponse

            return RuntimeLogsResponse(state="running", model_id="vision-base")

    response = probe_runtime(
        RuntimeProbeRequest(
            allow_start=True,
            model_id="vision-base",
            projector_artifact_id="vision-proj",
        ),
        service=FakeRuntimeService(),  # type: ignore[arg-type]
        models_dir=tmp_path,
        ollama_dir=tmp_path / "ollama",
        ollama_models_dir=tmp_path / "ollama-models",
        model_lab_repository=None,
        settings_service=None,
        endpoint_verifier=lambda endpoint: (True, False, []),
        multimodal_verifier=lambda runtime, endpoint, model_id: (True, "ok"),
    )

    assert response.allowed is False
    assert response.endpoint_verified is True
    assert response.models_endpoint_verified is False

    persisted = json.loads((tmp_path / "models.catalog.json").read_text(encoding="utf-8"))
    base_entry = next(entry for entry in persisted["models"] if entry["id"] == "vision-base")
    projector_entry = next(entry for entry in persisted["models"] if entry["id"] == "vision-proj")

    assert "pairing" not in base_entry or base_entry["pairing"].get("routing_allowed") is not True
    assert "pairing" not in projector_entry or projector_entry["pairing"].get("routing_allowed") is not True


def test_runtime_probe_requires_multimodal_chat_verification_for_mmproj_pairs(tmp_path: Path) -> None:
    _write_multimodal_catalog(tmp_path)

    running = RuntimeStatus(
        state="running",
        provider="llama.cpp",
        model_id="vision-base",
        model_name="Vision Base",
        port=8091,
        pid=42,
        endpoint="http://127.0.0.1:8091",
        message="ok",
    )
    stopped = RuntimeStatus(state="stopped", message="Runtime stopped.")

    class FakeRuntimeService:
        def start_model(self, model_id: str, *, slot_id: str | None = None, config: dict | None = None) -> RuntimeStatus:
            assert model_id == "vision-base"
            return running

        def stop_model(self) -> RuntimeStatus:
            return stopped

        def get_logs(self):
            from app.runtime.schemas import RuntimeLogsResponse

            return RuntimeLogsResponse(state="running", model_id="vision-base")

    response = probe_runtime(
        RuntimeProbeRequest(
            allow_start=True,
            model_id="vision-base",
            projector_artifact_id="vision-proj",
        ),
        service=FakeRuntimeService(),  # type: ignore[arg-type]
        models_dir=tmp_path,
        ollama_dir=tmp_path / "ollama",
        ollama_models_dir=tmp_path / "ollama-models",
        model_lab_repository=None,
        settings_service=None,
        endpoint_verifier=lambda endpoint: (True, True, ["vision-base"]),
        multimodal_verifier=lambda runtime, endpoint, model_id: (False, None),
    )

    assert response.allowed is False
    assert response.endpoint_verified is True
    assert response.models_endpoint_verified is True
    assert response.vision_chat_verified is False
    assert "Bildtest fehlgeschlagen" in response.message

    persisted = json.loads((tmp_path / "models.catalog.json").read_text(encoding="utf-8"))
    base_entry = next(entry for entry in persisted["models"] if entry["id"] == "vision-base")
    projector_entry = next(entry for entry in persisted["models"] if entry["id"] == "vision-proj")

    assert "pairing" not in base_entry or base_entry["pairing"].get("routing_allowed") is not True
    assert "pairing" not in projector_entry or projector_entry["pairing"].get("routing_allowed") is not True


def test_runtime_probe_surfaces_multimodal_chat_exception_details(tmp_path: Path) -> None:
    _write_multimodal_catalog(tmp_path)

    running = RuntimeStatus(
        state="running",
        provider="llama.cpp",
        model_id="vision-base",
        model_name="Vision Base",
        port=8091,
        pid=42,
        endpoint="http://127.0.0.1:8091",
        message="ok",
    )
    stopped = RuntimeStatus(state="stopped", message="Runtime stopped.")

    class FakeRuntimeService:
        def start_model(self, model_id: str, *, slot_id: str | None = None, config: dict | None = None) -> RuntimeStatus:
            assert model_id == "vision-base"
            return running

        def stop_model(self) -> RuntimeStatus:
            return stopped

        def get_logs(self):
            from app.runtime.schemas import RuntimeLogsResponse

            return RuntimeLogsResponse(state="running", model_id="vision-base")

    def failing_multimodal_verifier(runtime, endpoint, model_id):
        raise RuntimeError("vision endpoint rejected image payload")

    response = probe_runtime(
        RuntimeProbeRequest(
            allow_start=True,
            model_id="vision-base",
            projector_artifact_id="vision-proj",
        ),
        service=FakeRuntimeService(),  # type: ignore[arg-type]
        models_dir=tmp_path,
        ollama_dir=tmp_path / "ollama",
        ollama_models_dir=tmp_path / "ollama-models",
        model_lab_repository=None,
        settings_service=None,
        endpoint_verifier=lambda endpoint: (True, True, ["vision-base"]),
        multimodal_verifier=failing_multimodal_verifier,
    )

    assert response.allowed is False
    assert response.vision_chat_verified is False
    assert response.vision_response_preview == "vision endpoint rejected image payload"
    assert "Bildtest fehlgeschlagen: vision endpoint rejected image payload." in response.message


