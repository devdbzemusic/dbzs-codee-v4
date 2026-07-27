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

    report = build_runtime_doctor(models_dir=models_dir, ollama_dir=tmp_path / "ollama")
    assert report.summary
    assert any(check.id == "models_dir" for check in report.checks)
    assert len(report.suggested_profiles) == 3


def test_runtime_doctor_uses_format_and_runtime_launcher_for_gguf_model(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    _write_gguf_catalog(models_dir)

    report = build_runtime_doctor(models_dir=models_dir, ollama_dir=tmp_path / "ollama")
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

    dry = build_dry_run("coder", profile_name="safe_cpu_coder", models_dir=models_dir, ollama_dir=tmp_path / "ollama")

    assert "llama-server.exe" in dry.command_preview
    assert "--ctx-size 4096" in dry.command_preview
    assert "--gpu-layers 0" in dry.command_preview
    assert dry.preset["gpu_layers"] == 0


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
        def start_model(self, model_id: str) -> RuntimeStatus:
            assert model_id == "coder"
            return running

        def stop_model(self) -> RuntimeStatus:
            return stopped

        def get_logs(self):
            from app.runtime.schemas import RuntimeLogsResponse

            return RuntimeLogsResponse(state="running", model_id="coder")

    response = probe_runtime(
        RuntimeProbeRequest(allow_start=True, model_id="coder"),
        service=FakeRuntimeService(),  # type: ignore[arg-type]
    )

    assert response.allowed is True
    assert "coder" in response.message


