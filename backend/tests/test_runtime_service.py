import json
import threading
import time
import types
from pathlib import Path

import pytest

from app.models.index_service import ModelIndexService
from app.runtime.errors import RuntimeProviderError
from app.runtime.gpu_detect import GpuInfo
from app.runtime.hardware_fingerprint import collect_hardware_fingerprint, fingerprint_hash
from app.runtime.prompts import RUNTIME_CHAT_SYSTEM_PROMPT
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest, RuntimeStatus
from app.runtime.service import RuntimeService, _merge_images, _strip_data_url_prefix, _wire_chat_message


class FakeAntigravityService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def is_available(self) -> bool:
        return True

    def run_prompt_sync(self, prompt: str, *, system_instructions: str | None = None, tools=None):
        self.calls.append((prompt, system_instructions))
        return type("Result", (), {"text": "Antwort aus Antigravity", "model": "antigravity", "error": None})()


class FakeProcess:
    def __init__(self, exit_code: int | None = None) -> None:
        self.pid = 42
        self._exit_code = exit_code
        self._terminated = False

    def poll(self) -> int | None:
        if self._terminated:
            return 0
        return self._exit_code

    def terminate(self) -> None:
        self._terminated = True


class FakeProcessRunner:
    def __init__(self, process: FakeProcess | None = None, stderr: str = "", stdout: str = "") -> None:
        self.commands: list[list[str]] = []
        self.process = process or FakeProcess()
        self.stderr = stderr
        self.stdout = stdout
        self.processes: list[FakeProcess] = []

    def start(self, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> FakeProcess:
        self.commands.append(command)
        self.processes.append(self.process)
        return self.process

    def drain_process(self, _process: FakeProcess) -> None:
        return None

    def stderr_tail(self, _process: FakeProcess) -> str:
        return self.stderr

    def stdout_tail(self, _process: FakeProcess) -> str:
        return self.stdout


class FakeChatClient:
    def __init__(self, stream_usage: dict[str, int] | None = None) -> None:
        self.endpoint: str | None = None
        self.payload: dict | None = None
        self.stream_usage = stream_usage

    def complete(self, endpoint: str, payload: dict) -> str:
        self.endpoint = endpoint
        self.payload = payload
        return "Antwort aus der lokalen Runtime."

    def stream(self, endpoint: str, payload: dict, *, on_usage=None):
        self.endpoint = endpoint
        self.payload = payload
        for token in ["Ant", "wort"]:
            yield token
        if on_usage is not None and self.stream_usage is not None:
            on_usage(self.stream_usage)


class FailingTemplateChatClient(FakeChatClient):
    def complete(self, endpoint: str, payload: dict) -> str:
        raise RuntimeError("llama-server request failed: HTTP Error 500 | chat template failed")


class SlowEndpointChecker:
    def __init__(self, ready_after: int) -> None:
        self.ready_after = ready_after
        self.calls = 0

    def __call__(self, _url: str) -> bool:
        self.calls += 1
        return self.calls >= self.ready_after


class OomThenSucceedRunner(FakeProcessRunner):
    """Simulates repeated CUDA-OOM warmup failures for the first `fail_times`
    launches, then a successful one — the process itself never crashes
    (poll() stays None); readiness comes purely from the injected endpoint
    checker, which the test wires to key off start_count.
    """

    def __init__(self, fail_times: int) -> None:
        super().__init__(process=FakeProcess(), stderr="ggml_cuda_error: out of memory")
        self.fail_times = fail_times
        self.start_count = 0

    def start(self, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> FakeProcess:
        self.start_count += 1
        self.commands.append(command)
        process = FakeProcess()
        self.processes.append(process)
        return process


class MultiStartProcessRunner(FakeProcessRunner):
    """A FakeProcessRunner whose base class returns one shared FakeProcess for every
    start() — fine for single-launch tests, but a second slot's start() after a first
    slot was stopped (terminate() sets _terminated=True) would then see a pre-terminated
    process and look like an immediate crash. Needed whenever a test starts more than
    one slot against the same runner, e.g. GPU-exclusivity tests."""

    def start(self, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> FakeProcess:
        self.commands.append(command)
        process = FakeProcess()
        self.processes.append(process)
        return process


def _gpu_layers_in_command(command: list[str]) -> int:
    index = command.index("--gpu-layers") + 1
    return int(command[index])


def write_catalog(models_dir: Path, *, extra_runtime_fields: dict | None = None) -> None:
    runtime_dir = models_dir / "llama.cpp-win-runtime"
    runtime_dir.mkdir(exist_ok=True)
    (runtime_dir / "llama-server.exe").write_text("runtime", encoding="utf-8")
    (runtime_dir / "ggml.dll").write_text("ggml", encoding="utf-8")
    (runtime_dir / "libssl-3-x64.dll").write_text("ssl", encoding="utf-8")
    (runtime_dir / "libcrypto-3-x64.dll").write_text("crypto", encoding="utf-8")
    model_path = models_dir / "coder.gguf"
    model_path.write_bytes(b"GGUF")
    catalog = {
        "base_dir": str(models_dir),
        "runtime_dir": str(runtime_dir),
        "artifacts": [
            {
                "id": "coder",
                "name": "Coder Q4",
                "artifact_type": "model",
                "role": "CODE_MODEL",
                "capabilities": ["chat", "code"],
                "modality": ["text"],
                "file_path": str(model_path),
                "size_bytes": 1000,
                "quantization": "Q4_K_M",
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            }
        ],
    }
    runtime = {
        "artifacts": [
            {
                "id": "coder",
                "runtime": {"ctx": 4096, "gpu_layers": 12},
                "server": {"enabled": True, "preferred_port": 8091},
            }
        ],
        "models": {
            "coder": {
                "runtime": {"ctx": 8192, "gpu_layers": 20, "custom_flag": True},
                "server": {"enabled": True, "preferred_port": 8091, "bind_localhost": True},
                "last_good_preset": "hybrid",
                "custom_meta": "keep-me",
                **(extra_runtime_fields or {}),
            }
        },
    }
    state = {"health": {"coder": {"status": "ok"}}}
    (models_dir / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (models_dir / "models.runtime.json").write_text(json.dumps(runtime), encoding="utf-8")
    (models_dir / "models.state.json").write_text(json.dumps(state), encoding="utf-8")


def test_runtime_service_starts_llama_server_for_indexed_model(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    status = service.start_model("coder")

    assert status.state == "running"
    assert status.model_id == "coder"
    assert status.port == 8091
    assert runner.commands[0][0].endswith("llama-server.exe")
    assert "--ctx-size" in runner.commands[0]
    assert "--gpu-layers" in runner.commands[0]


def test_runtime_service_blocks_missing_model_before_process_start(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    (tmp_path / "coder.gguf").unlink()
    catalog_path = tmp_path / "models.catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["artifacts"][0]["file_path"] = str(tmp_path / "missing.gguf")
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    status = service.start_model("coder", slot_id="fast_gpu")

    assert status.state == "error"
    assert status.error_code == "model_not_ready"
    assert status.diagnostic_context is not None
    assert "missing_file" in status.diagnostic_context["exclusionReasons"]
    assert runner.commands == []


def _add_second_model_to_catalog(models_dir: Path, model_id: str) -> None:
    """GPU-exclusivity tests need two distinct models — reusing the same model_id
    across both slots would trigger the unrelated shared-slot-binding reuse path
    instead of a genuine new process launch."""
    model_path = models_dir / f"{model_id}.gguf"
    model_path.write_bytes(b"GGUF")
    catalog_path = models_dir / "models.catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["artifacts"].append(
        {
            "id": model_id,
            "name": model_id,
            "artifact_type": "model",
            "role": "VISION_MODEL",
            "capabilities": ["chat", "vision"],
            "modality": ["text", "image"],
            "file_path": str(model_path),
            "size_bytes": 1000,
            "quantization": "Q4_K_M",
            "backend": "llama.cpp",
            "loader": {"launcher": "llama-server"},
        }
    )
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")


def _add_mmproj_artifact_to_catalog(models_dir: Path, artifact_id: str) -> Path:
    """Adds an mmproj support artifact (artifact_type='mmproj') to the catalog,
    matching the shape build_index() maps into ModelIndex.support_artifacts.
    Returns the on-disk path of the fake projector file."""
    mmproj_path = models_dir / f"{artifact_id}.gguf"
    mmproj_path.write_bytes(b"MMPROJ")
    catalog_path = models_dir / "models.catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["artifacts"].append(
        {
            "id": artifact_id,
            "name": artifact_id,
            "artifact_type": "mmproj",
            "capabilities": ["vision"],
            "modality": ["image"],
            "file_path": str(mmproj_path),
            "size_bytes": 500,
            "quantization": "F16",
            "backend": "llama.cpp",
            "loader": {"launcher": "llama-server"},
        }
    )
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    return mmproj_path


def test_runtime_service_stops_vision_gpu_when_fast_gpu_starts(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    _add_second_model_to_catalog(tmp_path, "vision-model")
    runner = MultiStartProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("vision-model", slot_id="vision_gpu")
    assert service.status_for_slot("vision_gpu").state == "running"

    service.start_model("coder", slot_id="fast_gpu")

    assert service.status_for_slot("fast_gpu").state == "running"
    assert service.status_for_slot("vision_gpu").state == "stopped"


def test_runtime_service_stops_fast_gpu_when_vision_gpu_starts(tmp_path: Path) -> None:
    """GPU exclusivity must be symmetric, not just one-directional."""
    write_catalog(tmp_path)
    _add_second_model_to_catalog(tmp_path, "vision-model")
    runner = MultiStartProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="fast_gpu")
    assert service.status_for_slot("fast_gpu").state == "running"

    service.start_model("vision-model", slot_id="vision_gpu")

    assert service.status_for_slot("vision_gpu").state == "running"
    assert service.status_for_slot("fast_gpu").state == "stopped"


def test_runtime_service_gpu_exclusivity_waits_for_in_flight_request_to_drain(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    _add_second_model_to_catalog(tmp_path, "vision-model")
    runner = MultiStartProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="fast_gpu")
    service.residency.begin_request("fast_gpu")

    def finish_request_soon() -> None:
        time.sleep(0.05)
        service.residency.end_request("fast_gpu")

    threading.Thread(target=finish_request_soon).start()

    service.start_model("vision-model", slot_id="vision_gpu")

    assert service.status_for_slot("vision_gpu").state == "running"
    assert service.status_for_slot("fast_gpu").state == "stopped"


def test_runtime_service_reuses_shared_slot_binding_without_mmproj(tmp_path: Path) -> None:
    """Baseline (Plan 15, Phase 5): the same model_id started on a second slot
    with no mmproj_path in its config still uses the pre-existing shared-slot-
    binding reuse path — no second process. This must keep working; only an
    mmproj_path-bearing request should force a dedicated process (see
    test_runtime_service_dual_mode_vision_start_launches_dedicated_process)."""
    write_catalog(tmp_path)
    runner = MultiStartProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="orchestrator_cpu")
    assert service.status_for_slot("orchestrator_cpu").state == "running"

    service.start_model("coder", slot_id="quality_cpu")

    assert service.status_for_slot("quality_cpu").state == "running"
    assert len(runner.commands) == 1
    # No second process — quality_cpu is an alias of orchestrator_cpu's running
    # instance (same port/pid), which is how the shared-slot-binding reuse path
    # is actually observable here (it only falls back to the literal "Shared
    # runtime via slot" message text when the source status has no message).
    assert service.status_for_slot("quality_cpu").port == service.status_for_slot("orchestrator_cpu").port
    assert service.status_for_slot("quality_cpu").pid == service.status_for_slot("orchestrator_cpu").pid


def test_runtime_service_dual_mode_vision_start_launches_dedicated_process(tmp_path: Path) -> None:
    """Plan 15, Phase 5 (Dual-Mode Vision): a start request carrying an mmproj_path
    must never be silently aliased onto an already-running text-only instance of the
    same model_id via the shared-slot-binding reuse path — it must launch a genuinely
    separate process with --mmproj wired into its command, leaving the original slot
    untouched. Regression test for the gap documented in _add_second_model_to_catalog's
    docstring and fixed by the requires_dedicated_process guard in start_model()."""
    write_catalog(tmp_path)
    mmproj_path = _add_mmproj_artifact_to_catalog(tmp_path, "coder-mmproj")
    runner = MultiStartProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="orchestrator_cpu")
    assert service.status_for_slot("orchestrator_cpu").state == "running"

    service.start_model(
        "coder",
        slot_id="vision_gpu",
        config={"mmproj_path": str(mmproj_path), "mmproj_bytes": 500},
    )

    assert service.status_for_slot("vision_gpu").state == "running"
    assert service.status_for_slot("orchestrator_cpu").state == "running"

    assert len(runner.commands) == 2
    orchestrator_command, vision_command = runner.commands
    assert "--mmproj" not in orchestrator_command
    assert "--mmproj" in vision_command
    assert vision_command[vision_command.index("--mmproj") + 1] == str(mmproj_path)

    vision_status = service.status_for_slot("vision_gpu")
    assert "Shared runtime via slot" not in (vision_status.message or "")
    assert vision_status.port != service.status_for_slot("orchestrator_cpu").port


def test_runtime_service_leaves_quality_cpu_and_utility_slots_alone(tmp_path: Path) -> None:
    """Exclusivity is scoped to the two GPU slots — CPU slots must be unaffected."""
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="quality_cpu")
    service.start_model("coder", slot_id="fast_gpu")

    assert service.status_for_slot("quality_cpu").state == "running"
    assert service.status_for_slot("fast_gpu").state == "running"


def test_runtime_service_routes_antigravity_provider_to_antigravity_service() -> None:
    fake_service = FakeAntigravityService()
    runtime = RuntimeService(simulation_mode=True, antigravity_service=fake_service)

    response = runtime.chat(
        RuntimeChatRequest(
            messages=[
                RuntimeChatMessage(role="system", content="Sei kurz."),
                RuntimeChatMessage(role="user", content="Hallo"),
            ],
            provider="antigravity",
        )
    )

    assert response.message.content == "Antwort aus Antigravity"
    assert response.model_name == "antigravity"
    assert fake_service.calls
    assert "Hallo" in fake_service.calls[0][0]


def test_runtime_service_explicit_slots_use_isolated_default_ports_for_distinct_models(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    chat_model_path = tmp_path / "chat.gguf"
    chat_model_path.write_bytes(b"GGUF")
    catalog_path = tmp_path / "models.catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["artifacts"].append(
        {
            "id": "chat-model",
            "name": "Chat Q4",
            "artifact_type": "model",
            "role": "CHAT_MODEL",
            "capabilities": ["chat"],
            "modality": ["text"],
            "file_path": str(chat_model_path),
            "size_bytes": 1000,
            "quantization": "Q4_K_M",
            "backend": "llama.cpp",
            "loader": {"launcher": "llama-server"},
        }
    )
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    fast_status = service.start_model("coder", slot_id="fast_gpu")
    quality_status = service.start_model("chat-model", slot_id="quality_cpu")

    assert fast_status.state == "running"
    assert fast_status.port == 8082
    assert service.status_for_slot("fast_gpu").state == "running"
    assert quality_status.state == "running"
    assert quality_status.port == 8081
    assert service.status_for_slot("quality_cpu").state == "running"


def test_runtime_service_waits_for_slow_endpoint(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    checker = SlowEndpointChecker(ready_after=3)
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=checker,
        warmup_timeout_seconds=2,
        warmup_interval_seconds=0.01,
    )

    status = service.start_model("coder")

    assert status.state == "running"
    assert checker.calls >= 3


def test_runtime_service_reports_stderr_when_process_exits_early(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner(
        process=FakeProcess(exit_code=1),
        stderr="error: unable to load model weights",
    )
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: False,
        warmup_timeout_seconds=0.05,
        warmup_interval_seconds=0.01,
    )

    status = service.start_model("coder")

    assert status.state == "error"
    assert "unable to load model weights" in (status.message or "")
    assert "exited with code 1" in (status.message or "")
    assert "unable to load model weights" in status.stderr_tail


def test_runtime_service_does_not_silently_rebind_when_architecture_is_unsupported(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    gemma_path = tmp_path / "gemma4.gguf"
    gemma_path.write_bytes(b"GGUF")
    qwen_path = tmp_path / "qwen.gguf"
    qwen_path.write_bytes(b"GGUF")

    catalog_path = tmp_path / "models.catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["artifacts"].append(
        {
            "id": "gemma4",
            "name": "Gemma-4-E4B-Uncensored",
            "artifact_type": "model",
            "role": "CHAT_MODEL",
            "capabilities": ["chat"],
            "modality": ["text"],
            "file_path": str(gemma_path),
            "size_bytes": 1000,
            "quantization": "Q4_K_M",
            "backend": "llama.cpp",
            "loader": {"launcher": "llama-server"},
        }
    )
    catalog["artifacts"].append(
        {
            "id": "qwen",
            "name": "Qwen2.5-Coder-3B-Instruct",
            "artifact_type": "model",
            "role": "CODE_MODEL",
            "capabilities": ["chat", "code"],
            "modality": ["text"],
            "file_path": str(qwen_path),
            "size_bytes": 1000,
            "quantization": "Q4_K_M",
            "backend": "llama.cpp",
            "loader": {"launcher": "llama-server"},
        }
    )
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

    runtime_path = tmp_path / "models.runtime.json"
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    runtime["models"]["gemma4"] = {
        "runtime": {"ctx": 4096, "gpu_layers": 0},
        "server": {"enabled": True, "preferred_port": 8091},
    }
    runtime["models"]["qwen"] = {
        "runtime": {"ctx": 4096, "gpu_layers": 0},
        "server": {"enabled": True, "preferred_port": 8092},
    }
    runtime_path.write_text(json.dumps(runtime), encoding="utf-8")

    class FlakyProcessRunner(FakeProcessRunner):
        def start(self, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> FakeProcess:
            self.commands.append(command)
            if len(self.commands) == 1:
                return FakeProcess(exit_code=1)
            return FakeProcess()

    runner = FlakyProcessRunner(stderr="llama_model_load: error loading model architecture: unknown model architecture: 'gemma4'")
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
        warmup_timeout_seconds=0.05,
        warmup_interval_seconds=0.01,
    )

    status = service.start_model("gemma4")

    assert status.state == "error"
    assert "unknown model architecture" in status.stderr_tail
    assert len(runner.commands) == 1


def test_runtime_service_oom_retry_reduces_gpu_layers_and_succeeds(tmp_path: Path) -> None:
    """Acceptance test 3/4-precursor: OOM retry reduces layers each attempt and eventually succeeds."""
    write_catalog(tmp_path)
    runner = OomThenSucceedRunner(fail_times=2)
    gpu = GpuInfo(name="Test GPU", vram_mb=16384, recommended_gpu_layers=48, vendor="nvidia")
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: runner.start_count > runner.fail_times,
        warmup_timeout_seconds=0.05,
        warmup_interval_seconds=0.01,
        gpu_detector=lambda: gpu,
    )

    status = service.start_model("coder", slot_id="fast_gpu")

    assert status.state == "running"
    assert len(runner.commands) == 3
    layers = [_gpu_layers_in_command(command) for command in runner.commands]
    assert layers[0] > layers[1] > layers[2]  # strictly decreasing across retries
    assert layers[2] == _gpu_layers_in_command(runner.commands[-1])


def test_runtime_service_oom_retry_capped_at_three_attempts(tmp_path: Path) -> None:
    """Acceptance test 3: OOM retry is capped, never loops forever, and surfaces an error."""
    write_catalog(tmp_path)
    runner = OomThenSucceedRunner(fail_times=999)  # always fails
    gpu = GpuInfo(name="Test GPU", vram_mb=16384, recommended_gpu_layers=48, vendor="nvidia")
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: False,
        warmup_timeout_seconds=0.02,
        warmup_interval_seconds=0.005,
        gpu_detector=lambda: gpu,
    )

    status = service.start_model("coder", slot_id="fast_gpu")

    assert status.state == "error"
    assert len(runner.commands) == 3  # 1 initial attempt + 2 retries before the GPU-only slot aborts
    layers = [_gpu_layers_in_command(command) for command in runner.commands]
    assert layers == sorted(layers, reverse=True)
    assert layers[-1] > 0  # GPU-only slot aborts before a silent CPU-only fallback


def test_runtime_service_persists_resource_plan_with_hardware_fingerprint(tmp_path: Path) -> None:
    """Acceptance test 20 (persisted, hardware-scoped profile)."""
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    gpu = GpuInfo(name="Test GPU", vram_mb=16384, recommended_gpu_layers=48, vendor="nvidia")
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
        gpu_detector=lambda: gpu,
    )

    service.start_model("coder", slot_id="fast_gpu")

    saved = json.loads((tmp_path / "models.runtime.json").read_text(encoding="utf-8"))
    saved_plan_entry = saved["models"]["coder"]["last_good_resource_plan"]
    expected_hash = fingerprint_hash(collect_hardware_fingerprint(gpu))
    assert saved_plan_entry["hardware_fingerprint_hash"] == expected_hash
    assert isinstance(saved_plan_entry["plan"]["gpu_layers"], int)
    assert saved_plan_entry["plan"]["gpu_layers"] >= 0


def test_runtime_service_reuses_persisted_gpu_layers_avoiding_repeat_oom_loop(tmp_path: Path) -> None:
    """Acceptance test 4: a saved profile avoids re-triggering the OOM loop on the next start."""
    write_catalog(tmp_path)
    gpu = GpuInfo(name="Test GPU", vram_mb=16384, recommended_gpu_layers=48, vendor="nvidia")

    first_runner = OomThenSucceedRunner(fail_times=2)
    first_service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=first_runner,
        endpoint_checker=lambda _url: first_runner.start_count > first_runner.fail_times,
        warmup_timeout_seconds=0.05,
        warmup_interval_seconds=0.01,
        gpu_detector=lambda: gpu,
    )
    first_status = first_service.start_model("coder", slot_id="fast_gpu")
    assert first_status.state == "running"
    assert len(first_runner.commands) == 3
    reduced_gpu_layers = _gpu_layers_in_command(first_runner.commands[-1])

    # Fresh service instance (same models_dir / hardware) — a plain runner that would
    # fail if launched with the original, too-high gpu_layers value again.
    second_runner = FakeProcessRunner()
    second_service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=second_runner,
        endpoint_checker=lambda _url: True,
        gpu_detector=lambda: gpu,
    )
    second_status = second_service.start_model("coder", slot_id="fast_gpu")

    assert second_status.state == "running"
    assert len(second_runner.commands) == 1  # no OOM retry loop needed this time
    assert _gpu_layers_in_command(second_runner.commands[0]) == reduced_gpu_layers


def test_runtime_service_preserves_runtime_json_fields_when_saving_last_good_command(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="fast_gpu")

    saved = json.loads((tmp_path / "models.runtime.json").read_text(encoding="utf-8"))
    coder_entry = saved["models"]["coder"]
    assert coder_entry["custom_meta"] == "keep-me"
    assert coder_entry["runtime"]["custom_flag"] is True
    assert coder_entry["server"]["bind_localhost"] is True
    assert coder_entry["last_good_preset"] == "hybrid"
    ctx_index = runner.commands[0].index("--ctx-size") + 1
    expected_ctx = int(runner.commands[0][ctx_index])
    assert coder_entry["runtime"]["ctx"] == expected_ctx
    assert coder_entry["server"]["preferred_port"] == 8082
    assert coder_entry["load_ok"] is True


def test_runtime_service_stops_running_model(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder", slot_id="fast_gpu")

    status = service.stop_model()

    assert status.state == "stopped"
    assert runner.process.poll() == 0


def test_runtime_chat_system_prompt_avoids_product_identity_trap() -> None:
    assert "Du bist DBZS Code Assistant" not in RUNTIME_CHAT_SYSTEM_PROMPT
    assert "woertlich" in RUNTIME_CHAT_SYSTEM_PROMPT.lower()


def test_runtime_service_build_chat_messages_uses_optimized_system_prompt(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    service = RuntimeService(model_index_service=ModelIndexService(models_dir=tmp_path))

    messages = service._build_chat_messages(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="Zitiere die erste Ueberschrift aus der README.")],
            file_context={
                "path": "README.md",
                "language": "markdown",
                "content": "# Coding Assistant Test Workspace\n",
            },
        )
    )

    # The base system prompt and the file-context system message are
    # consecutive same-role messages, so they get merged into a single
    # system message (see _merge_consecutive_same_role_messages) to keep
    # strict-alternation chat templates (e.g. Gemma's) happy.
    assert messages[0].role == "system"
    assert messages[0].content.startswith(RUNTIME_CHAT_SYSTEM_PROMPT)
    assert "DBZS Code Assistant" not in messages[0].content
    assert "README.md" in messages[0].content
    assert len([m for m in messages if m.role == "system"]) == 1
    assert messages[-1].content.startswith("Zitiere")


def test_runtime_service_sends_chat_to_running_llama_server(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder", slot_id="fast_gpu")

    response = service.chat(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="Pruefe diese Datei.")],
            file_context={
                "path": "D:/Dev/repo/dbzs-codee/index.html",
                "language": "html",
                "content": "<main>DBZS</main>",
            },
        )
    )

    assert response.message.role == "assistant"
    assert response.message.content == "Antwort aus der lokalen Runtime."
    assert chat_client.endpoint == "http://127.0.0.1:8082"
    assert chat_client.payload is not None
    assert chat_client.payload["messages"][-1]["content"] == "Pruefe diese Datei."
    assert chat_client.payload["top_p"] == 0.88
    assert chat_client.payload["min_p"] == 0.05
    assert chat_client.payload["repeat_penalty"] == 1.18
    assert chat_client.payload["repeat_last_n"] == 256
    assert chat_client.payload["presence_penalty"] == 0.15
    assert chat_client.payload["frequency_penalty"] == 0.25


def test_runtime_service_sends_image_content_parts_to_llama_server(tmp_path: Path) -> None:
    """A user message with images must reach llama-server as OpenAI-style
    content parts, not silently dropped (previously the raw image bytes
    never reached any model at all -- see HANDOVER.md 2026-08-01)."""
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder", slot_id="fast_gpu")

    image_data_url = "data:image/png;base64,AAAA"
    response = service.chat(
        RuntimeChatRequest(
            messages=[
                RuntimeChatMessage(
                    role="user",
                    content="Was zeigt dieser Screenshot?",
                    images=[image_data_url],
                )
            ],
            slot_id="fast_gpu",
        )
    )

    assert response.message.content == "Antwort aus der lokalen Runtime."
    sent_content = chat_client.payload["messages"][-1]["content"]
    assert sent_content == [
        {"type": "text", "text": "Was zeigt dieser Screenshot?"},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]


def test_wire_chat_message_without_images_is_unchanged() -> None:
    message = RuntimeChatMessage(role="user", content="Hallo")

    assert _wire_chat_message(message, provider="llama.cpp") == {"role": "user", "content": "Hallo"}
    assert _wire_chat_message(message, provider="ollama") == {"role": "user", "content": "Hallo"}


def test_wire_chat_message_builds_ollama_images_field() -> None:
    message = RuntimeChatMessage(
        role="user",
        content="Was zeigt das?",
        images=["data:image/png;base64,AAAA", "raw-base64-without-prefix"],
    )

    assert _wire_chat_message(message, provider="ollama") == {
        "role": "user",
        "content": "Was zeigt das?",
        "images": ["AAAA", "raw-base64-without-prefix"],
    }


def test_wire_chat_message_omits_empty_text_part() -> None:
    message = RuntimeChatMessage(role="user", content="   ", images=["data:image/png;base64,AAAA"])

    assert _wire_chat_message(message, provider="llama.cpp") == {
        "role": "user",
        "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}],
    }


def test_strip_data_url_prefix() -> None:
    assert _strip_data_url_prefix("data:image/png;base64,AAAA") == "AAAA"
    assert _strip_data_url_prefix("already-raw-base64") == "already-raw-base64"


def test_merge_images() -> None:
    assert _merge_images(None, None) is None
    assert _merge_images(["a"], None) == ["a"]
    assert _merge_images(None, ["b"]) == ["b"]
    assert _merge_images(["a"], ["b"]) == ["a", "b"]


def test_build_strict_alternating_messages_preserves_images_through_merge() -> None:
    """Two consecutive user messages (one with an image) must keep the image
    attached to the merged message, not silently drop it."""
    normalized = RuntimeService._build_strict_alternating_messages(
        [RUNTIME_CHAT_SYSTEM_PROMPT],
        [
            RuntimeChatMessage(role="user", content="Erster Teil"),
            RuntimeChatMessage(role="user", content="Zweiter Teil", images=["data:image/png;base64,AAAA"]),
        ],
    )

    user_message = normalized[-1]
    assert user_message.role == "user"
    assert user_message.content == "Erster Teil\n\nZweiter Teil"
    assert user_message.images == ["data:image/png;base64,AAAA"]


def test_runtime_service_chat_logs_run_id_for_crash_correlation(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    with caplog.at_level("INFO"):
        service.chat(
            RuntimeChatRequest(
                messages=[RuntimeChatMessage(role="user", content="Hallo")],
                run_id="run-correlation-test",
            )
        )

    assert "run_id=run-correlation-test" in caplog.text


def test_runtime_service_chat_logs_without_run_id(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """A missing run_id (e.g. legacy caller) must not break logging or the chat call."""
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    with caplog.at_level("INFO"):
        response = service.chat(RuntimeChatRequest(messages=[RuntimeChatMessage(role="user", content="Hallo")]))

    assert response.message.role == "assistant"
    assert "run_id=None" in caplog.text


def test_runtime_service_provider_error_diagnostics_include_request_id(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        chat_client=FailingTemplateChatClient(),
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    with pytest.raises(RuntimeProviderError) as raised:
        service.chat(
            RuntimeChatRequest(
                messages=[RuntimeChatMessage(role="user", content="Hallo")],
                model_id="coder",
                slot_id="fast_gpu",
                request_id="req-provider-1",
            )
        )

    assert raised.value.code == "provider_template_error"
    assert raised.value.diagnostic_context["requestId"] == "req-provider-1"
    assert raised.value.diagnostic_context["stage"] == "chat_complete"


def test_runtime_service_chat_stream_captures_usage(tmp_path: Path) -> None:
    """Acceptance test 17: usage stats from llama-server surface via get_last_chat_usage()."""
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    chat_client = FakeChatClient(stream_usage={"prompt_tokens": 120, "completion_tokens": 45})
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    assert service.get_last_chat_usage() is None
    chunks = list(service.chat_stream(RuntimeChatRequest(messages=[RuntimeChatMessage(role="user", content="Hallo")])))

    assert chunks == ["Ant", "wort"]
    assert service.get_last_chat_usage() == {"prompt_tokens": 120, "completion_tokens": 45}


def test_runtime_service_chat_stream_usage_resets_when_absent(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    chat_client = FakeChatClient(stream_usage={"prompt_tokens": 10, "completion_tokens": 5})
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")
    list(service.chat_stream(RuntimeChatRequest(messages=[RuntimeChatMessage(role="user", content="Hallo")])))
    assert service.get_last_chat_usage() is not None

    chat_client.stream_usage = None
    list(service.chat_stream(RuntimeChatRequest(messages=[RuntimeChatMessage(role="user", content="Nochmal")])))

    assert service.get_last_chat_usage() is None


def test_runtime_service_respects_explicit_sampling_options(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    service.chat(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="Schreibe kurzen Code.")],
            top_p=0.75,
            min_p=0.02,
            repeat_penalty=1.3,
            repeat_last_n=512,
            presence_penalty=0.2,
            frequency_penalty=0.4,
        )
    )

    assert chat_client.payload is not None
    assert chat_client.payload["top_p"] == 0.75
    assert chat_client.payload["min_p"] == 0.02
    assert chat_client.payload["repeat_penalty"] == 1.3
    assert chat_client.payload["repeat_last_n"] == 512
    assert chat_client.payload["presence_penalty"] == 0.2
    assert chat_client.payload["frequency_penalty"] == 0.4


def test_runtime_service_does_not_forward_prompt_mode_tools_as_native_payload(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    service.chat(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="Schreibe kurzen Code.")],
            tools={
                "mode": "prompt",
                "definitions": [{"name": "read_file", "description": "read a file"}],
            },
        )
    )

    assert chat_client.payload is not None
    assert "tools" not in chat_client.payload


def test_runtime_service_forwards_native_mode_tools_as_provider_payload(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    chat_client = FakeChatClient()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        chat_client=chat_client,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    service.chat(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="Schreibe kurzen Code.")],
            tools={
                "mode": "native",
                "definitions": [{"type": "function", "function": {"name": "read_file"}}],
            },
        )
    )

    assert chat_client.payload is not None
    assert chat_client.payload["tools"] == [{"type": "function", "function": {"name": "read_file"}}]


def test_runtime_service_reuses_running_same_model_across_slots(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=FakeChatClient(),
        endpoint_checker=lambda _url: True,
    )

    first = service.start_model("coder", slot_id="fast_gpu")
    rebound = service.start_model("coder", slot_id="quality_cpu")

    assert len(runner.commands) == 1
    assert first.endpoint == "http://127.0.0.1:8082"
    assert rebound.endpoint == "http://127.0.0.1:8082"
    assert rebound.slot_id == "quality_cpu"
    assert service.status_for_slot("quality_cpu").model_id == "coder"
    assert service.status_for_slot("quality_cpu").endpoint == "http://127.0.0.1:8082"


def test_runtime_service_stopping_shared_slot_only_removes_binding(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=FakeChatClient(),
        endpoint_checker=lambda _url: True,
    )

    service.start_model("coder", slot_id="fast_gpu")
    service.start_model("coder", slot_id="quality_cpu")
    stopped = service.stop_model_for_slot("quality_cpu")

    assert stopped.state == "stopped"
    assert len(runner.commands) == 1
    assert service.status_for_slot("fast_gpu").state == "running"
    assert service.status_for_slot("fast_gpu").endpoint == "http://127.0.0.1:8082"


def test_runtime_service_adopts_existing_matching_listener_on_slot_port(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=FakeChatClient(),
        endpoint_checker=lambda _url: True,
    )

    class FakePsutil:
        CONN_LISTEN = "LISTEN"

        @staticmethod
        def net_connections(kind: str = "tcp"):
            return [types.SimpleNamespace(status="LISTEN", laddr=types.SimpleNamespace(port=8082), pid=777)]

        @staticmethod
        def Process(pid: int):
            return types.SimpleNamespace(cmdline=lambda: [r"D:\win_runtimes\llama\llama-server.exe", "-m", str(tmp_path / "coder.gguf")])

    monkeypatch.setattr("app.runtime.service.psutil", FakePsutil)

    status = service.start_model("coder", slot_id="fast_gpu")

    assert status.state == "running"
    assert status.pid == 777
    assert status.port == 8082
    assert "reused existing listener" in (status.message or "")
    assert runner.processes[0]._terminated is True


def test_runtime_service_reports_port_conflict_when_listener_serves_different_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=FakeChatClient(),
        endpoint_checker=lambda _url: True,
    )

    class FakePsutil:
        CONN_LISTEN = "LISTEN"

        @staticmethod
        def net_connections(kind: str = "tcp"):
            return [types.SimpleNamespace(status="LISTEN", laddr=types.SimpleNamespace(port=8082), pid=888)]

        @staticmethod
        def Process(pid: int):
            return types.SimpleNamespace(cmdline=lambda: [r"D:\win_runtimes\llama\llama-server.exe", "-m", r"D:\Models\llava\llava-1.6-mistral-7b.Q8_0.gguf"])

    monkeypatch.setattr("app.runtime.service.psutil", FakePsutil)

    status = service.start_model("coder", slot_id="fast_gpu")

    assert status.state == "error"
    assert "Port 8082 is already serving another runtime process" in (status.message or "")
    assert runner.processes[0]._terminated is True


def test_runtime_service_clears_stale_port_conflict_status_when_listener_gone(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write_catalog(tmp_path)
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        endpoint_checker=lambda _url: True,
    )
    service._statuses["quality_cpu"] = RuntimeStatus(
        state="error",
        slot_id="quality_cpu",
        message="Port 8081 is already serving another runtime process: stale listener",
    )

    class FakePsutil:
        CONN_LISTEN = "LISTEN"

        @staticmethod
        def net_connections(kind: str = "tcp"):  # noqa: ARG004
            return []

    monkeypatch.setattr("app.runtime.service.psutil", FakePsutil)

    status = service.status_for_slot("quality_cpu")

    assert status.state == "stopped"
    assert "Stale port-conflict state cleared." in (status.message or "")


def test_runtime_service_tokenize_returns_real_token_count(tmp_path: Path) -> None:
    from unittest.mock import patch

    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder", slot_id="fast_gpu")

    class FakeResponse:
        def read(self) -> bytes:
            return json.dumps({"tokens": [1, 2, 3, 4, 5]}).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, *args: object) -> None:
            return None

    calls: list[str] = []

    def fake_urlopen(http_request, timeout: float = 10):  # noqa: ARG001
        calls.append(http_request.full_url)
        return FakeResponse()

    with patch("app.runtime.service.request.urlopen", side_effect=fake_urlopen):
        token_count = service.tokenize("fast_gpu", "hello world")

    assert token_count == 5
    assert calls == ["http://127.0.0.1:8082/tokenize"]


def test_runtime_service_tokenize_raises_when_slot_not_running() -> None:
    service = RuntimeService()

    with pytest.raises(RuntimeError, match="target_slot_unavailable"):
        service.tokenize("fast_gpu", "hello")


def test_runtime_service_endpoint_checker_tries_health_and_models_paths() -> None:
    from unittest.mock import patch

    service = RuntimeService()
    calls: list[str] = []

    def fake_urlopen(url: str, timeout: float = 2):  # noqa: ARG001
        calls.append(url)
        if url.endswith("/v1/models"):
            class Response:
                status = 200

                def __enter__(self):
                    return self

                def __exit__(self, *args: object) -> None:
                    return None

            return Response()
        raise OSError("unreachable")

    with patch("app.runtime.service.request.urlopen", side_effect=fake_urlopen):
        assert service._endpoint_available("http://127.0.0.1:8091") is True

    assert calls == [
        "http://127.0.0.1:8091/",
        "http://127.0.0.1:8091/health",
        "http://127.0.0.1:8091/v1/models",
    ]


def test_runtime_service_get_logs_returns_stderr_tail(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner(stderr="warmup info")
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder")

    logs = service.get_logs()

    assert logs.state == "running"
    assert logs.stderr_tail == "warmup info"
    ollama_dir = tmp_path / "Ollama"
    manifests_dir = ollama_dir / "models" / "manifests" / "registry.ollama.ai" / "library" / "qwen2.5-coder"
    manifests_dir.mkdir(parents=True, exist_ok=True)
    (ollama_dir / "ollama.exe").write_text("runtime", encoding="utf-8")
    (manifests_dir / "latest").write_text(json.dumps({"layers": []}), encoding="utf-8")
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(
            models_dir=tmp_path,
            ollama_dir=ollama_dir,
            ollama_models_dir=ollama_dir / "models",
            discovery_mode="local_with_ollama",
        ),
        process_runner=runner,
        ollama_dir=ollama_dir,
        ollama_models_dir=ollama_dir / "models",
    )

    status = service.start_model("ollama_qwen2_5_coder_latest")

    assert status.state == "running"
    assert status.provider == "ollama"
    assert status.port == 11434
    assert runner.commands[0] == [str(ollama_dir / "ollama.exe"), "serve"]


def test_runtime_service_resolve_chat_target_uses_request_context() -> None:
    service = RuntimeService()
    request = RuntimeChatRequest(
        messages=[RuntimeChatMessage(role="user", content="Bitte prüfe den Code.")],
        slot_id="quality_cpu",
    )

    with pytest.raises(RuntimeError, match="target_slot_unavailable"):
        service.resolve_chat_target(request)


def test_runtime_service_strict_slot_routing_rejects_unavailable_target(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    runner = FakeProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )
    service.start_model("coder", slot_id="fast_gpu")

    with pytest.raises(RuntimeError, match="target_slot_unavailable"):
        service.chat(
            RuntimeChatRequest(
                messages=[RuntimeChatMessage(role="user", content="Bitte prüfe den Code.")],
                slot_id="quality_cpu",
            )
        )


def test_runtime_service_request_fallback_policy_wins_over_global_strict(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        endpoint_checker=lambda _url: True,
    )
    service.fallback_policy = "strict"
    service.start_model("coder", slot_id="fast_gpu")

    target = service.resolve_chat_target(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="Bitte pruefe den Code.")],
            slot_id="quality_cpu",
            fallback_policy="allow_local_fallback",
        )
    )

    assert target.slot_id == "fast_gpu"
    assert target.fallback_reason == "fallback to fast_gpu because quality_cpu was unavailable"


def test_runtime_service_decision_id_forces_strict_even_with_allow_local_fallback(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        endpoint_checker=lambda _url: True,
    )
    service.fallback_policy = "allow_local_fallback"
    service.start_model("coder", slot_id="fast_gpu")

    with pytest.raises(RuntimeError, match="target_slot_unavailable"):
        service.resolve_chat_target(
            RuntimeChatRequest(
                messages=[RuntimeChatMessage(role="user", content="Bitte pruefe den Code.")],
                slot_id="quality_cpu",
                fallback_policy="allow_local_fallback",
                decision_id="decision-binding-1",
            )
        )


def test_runtime_service_request_strict_policy_wins_over_global_fallback(tmp_path: Path) -> None:
    write_catalog(tmp_path)
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=FakeProcessRunner(),
        endpoint_checker=lambda _url: True,
    )
    service.fallback_policy = "allow_local_fallback"
    service.start_model("coder", slot_id="fast_gpu")

    with pytest.raises(RuntimeError, match="target_slot_unavailable"):
        service.resolve_chat_target(
            RuntimeChatRequest(
                messages=[RuntimeChatMessage(role="user", content="Bitte pruefe den Code.")],
                slot_id="quality_cpu",
                fallback_policy="strict",
                decision_id="decision-test-strict",
            )
        )


def test_vision_gpu_start_does_not_affect_orchestrator_cpu_residency(tmp_path: Path) -> None:
    """Plan 16, Stufe 5 Regressionstest:
    orchestrator_cpu-Residency bleibt beim parallelen vision_gpu-Start desselben
    Modells unberührt (vorher schaltete es gpu_layers hart auf 0 für beide
    wegen State-Lecks oder fehlendem mmproj-Support)."""
    write_catalog(tmp_path)
    runner = MultiStartProcessRunner()
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        endpoint_checker=lambda _url: True,
    )
    
    # 1. Start the model on orchestrator_cpu (expecting GPU layers == 0)
    status1 = service.start_model("coder", slot_id="orchestrator_cpu")
    
    # 2. Start on vision_gpu with mmproj_path (requires dedicated process, expecting GPU layers > 0)
    mmproj_file = tmp_path / "dummy.gguf"
    mmproj_file.write_text("dummy mmproj")
    status2 = service.start_model("coder", slot_id="vision_gpu", config={"mmproj_path": str(mmproj_file)})
    
    assert len(runner.commands) >= 2
    
    orch_cmd = runner.commands[-2]
    vision_cmd = runner.commands[-1]
    
    # vision_gpu might have --n-gpu-layers depending on fake hardware, but it should NOT be forced to 0
    # because of orchestrator_cpu.
    # We can check orchestrator_cpu definitely got --n-gpu-layers 0
    orch_layers = _gpu_layers_in_command(orch_cmd)
    assert orch_layers == 0, "orchestrator_cpu must have gpu_layers=0"
    
    vision_layers = _gpu_layers_in_command(vision_cmd)
    assert vision_layers > 0, "vision_gpu must retain its gpu_layers > 0 despite the orchestrator_cpu start"
