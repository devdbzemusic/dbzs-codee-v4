import json
from pathlib import Path

from app.models.index_service import ModelIndexService
from app.models.schemas import IndexedModel, ModelRuntimeHints
from app.runtime.gpu_detect import GpuInfo
from app.runtime.residency import DEFAULT_SLOT_POLICY, ResidencyPolicy, RuntimeResidencyRegistry, compute_launch_fingerprint
from app.runtime.resource_planner import RuntimeResourcePlanner
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest
from app.runtime.service import RuntimeService


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
    def __init__(self) -> None:
        self.commands: list[list[str]] = []
        self.processes: list[FakeProcess] = []

    def start(self, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> FakeProcess:
        self.commands.append(command)
        process = FakeProcess()
        self.processes.append(process)
        return process

    def drain_process(self, _process: FakeProcess) -> None:
        return None

    def stderr_tail(self, _process: FakeProcess) -> str:
        return ""


class FakeChatClient:
    def complete(self, endpoint: str, payload: dict) -> str:
        return "ok"


def write_catalog(models_dir: Path) -> None:
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
    (models_dir / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")


def make_model(model_id: str = "model-a") -> IndexedModel:
    return IndexedModel(
        id=model_id,
        name=model_id,
        path=f"D:/Models/{model_id}.gguf",
        format="gguf",
        artifact_type="model",
        size_bytes=1_000_000,
        size_gb=0.001,
        quantization="Q4_K_M",
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=["chat"],
        modality=["text"],
        role=None,
        recommended_use="coding_candidate",
        compatibility="llama_server_ready",
        runtime=ModelRuntimeHints(),
    )


def make_plan(context_size: int = 4096, gpu_layers: int = 24):
    planner = RuntimeResourcePlanner()
    gpu = GpuInfo(name="Test GPU", vram_mb=16384, recommended_gpu_layers=48, vendor="nvidia")
    return planner.plan(
        make_model(),
        slot_id="fast_gpu",
        gpu=gpu,
        requested_profile="balanced",
        custom_overrides={"context_size": context_size, "gpu_layers": gpu_layers},
    )


def _new_service(tmp_path: Path, *, runner: FakeProcessRunner | None = None) -> tuple[RuntimeService, FakeProcessRunner]:
    write_catalog(tmp_path)
    runner = runner or FakeProcessRunner()
    gpu = GpuInfo(name="Test GPU", vram_mb=16384, recommended_gpu_layers=48, vendor="nvidia")
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        process_runner=runner,
        chat_client=FakeChatClient(),
        endpoint_checker=lambda _url: True,
        gpu_detector=lambda: gpu,
    )
    return service, runner


def test_launch_fingerprint_is_deterministic_for_identical_inputs() -> None:
    model = make_model()
    plan = make_plan()

    fp1 = compute_launch_fingerprint(model, plan, runtime_version="1.0", runtime_backend="cuda")
    fp2 = compute_launch_fingerprint(model, plan, runtime_version="1.0", runtime_backend="cuda")

    assert fp1 == fp2


def test_launch_fingerprint_changes_with_context_size_or_gpu_layers() -> None:
    model = make_model()
    base_plan = make_plan(context_size=4096, gpu_layers=24)
    different_ctx_plan = make_plan(context_size=8192, gpu_layers=24)
    different_layers_plan = make_plan(context_size=4096, gpu_layers=12)

    base_fp = compute_launch_fingerprint(model, base_plan, runtime_version="1.0", runtime_backend="cuda")
    ctx_fp = compute_launch_fingerprint(model, different_ctx_plan, runtime_version="1.0", runtime_backend="cuda")
    layers_fp = compute_launch_fingerprint(model, different_layers_plan, runtime_version="1.0", runtime_backend="cuda")

    assert base_fp != ctx_fp
    assert base_fp != layers_fp


def test_launch_fingerprint_changes_with_runtime_version_or_backend() -> None:
    model = make_model()
    plan = make_plan()

    fp_v1 = compute_launch_fingerprint(model, plan, runtime_version="1.0", runtime_backend="cuda")
    fp_v2 = compute_launch_fingerprint(model, plan, runtime_version="2.0", runtime_backend="cuda")
    fp_vulkan = compute_launch_fingerprint(model, plan, runtime_version="1.0", runtime_backend="vulkan")

    assert fp_v1 != fp_v2
    assert fp_v1 != fp_vulkan


def test_residency_registry_can_reuse_only_on_matching_fingerprint() -> None:
    registry = RuntimeResidencyRegistry()
    plan = make_plan()
    registry.record_started(
        "fast_gpu", model_id="coder", process_id=1, endpoint="http://127.0.0.1:8081",
        launch_fingerprint="fp-a", plan=plan,
    )

    assert registry.can_reuse("fast_gpu", "fp-a") is True
    assert registry.can_reuse("fast_gpu", "fp-b") is False
    assert registry.can_reuse("quality_cpu", "fp-a") is False


def test_default_slot_policies_match_spec() -> None:
    assert DEFAULT_SLOT_POLICY["quality_cpu"] == ResidencyPolicy.KEEP_RESIDENT
    assert DEFAULT_SLOT_POLICY["fast_gpu"] == ResidencyPolicy.KEEP_RESIDENT
    assert DEFAULT_SLOT_POLICY["utility"] == ResidencyPolicy.IDLE_EVICT
    assert DEFAULT_SLOT_POLICY["vision_gpu"] == ResidencyPolicy.IDLE_EVICT


def test_compatible_runtime_reused_no_duplicate_process(tmp_path: Path) -> None:
    """Acceptance test 6/8: same model, same effective config -> reused, no second process."""
    service, runner = _new_service(tmp_path)

    first = service.start_model("coder", slot_id="fast_gpu")
    second = service.start_model("coder", slot_id="fast_gpu")

    assert first.state == "running"
    assert second.state == "running"
    assert len(runner.commands) == 1  # only one process ever started
    assert service.residency.entry_for_slot("fast_gpu") is not None


def test_incompatible_runtime_restarted_on_profile_change(tmp_path: Path) -> None:
    """Acceptance test 7: same model_id but a different requested profile must restart, not reuse."""
    service, runner = _new_service(tmp_path)

    service.start_model("coder", slot_id="fast_gpu", config={"profile": "fast"})
    first_pid = runner.processes[0].pid
    first_command = runner.commands[0]

    service.start_model("coder", slot_id="fast_gpu", config={"profile": "large_context"})

    assert len(runner.commands) == 2  # restarted, not reused
    assert runner.commands[1] != first_command
    # the first process must have been terminated before the second started
    assert runner.processes[0]._terminated is True


def test_launch_fingerprint_recorded_on_successful_start(tmp_path: Path) -> None:
    """Acceptance test 5: launch fingerprint is correct/present after a real start."""
    service, runner = _new_service(tmp_path)

    service.start_model("coder", slot_id="fast_gpu")

    entry = service.residency.entry_for_slot("fast_gpu")
    assert entry is not None
    assert entry.model_id == "coder"
    assert len(entry.launch_fingerprint) == 64  # sha256 hex digest
    assert entry.state == "ready"
    assert entry.active_requests == 0


def test_residency_tracks_active_requests_during_chat(tmp_path: Path) -> None:
    service, runner = _new_service(tmp_path)
    service.start_model("coder", slot_id="fast_gpu")

    service.chat(
        RuntimeChatRequest(
            messages=[RuntimeChatMessage(role="user", content="hi")],
            slot_id="fast_gpu",
        )
    )

    entry = service.residency.entry_for_slot("fast_gpu")
    assert entry is not None
    assert entry.active_requests == 0  # request completed, back to idle
    assert entry.state == "idle"
    assert entry.idle_since is not None


def test_residency_removed_on_stop(tmp_path: Path) -> None:
    service, runner = _new_service(tmp_path)
    service.start_model("coder", slot_id="fast_gpu")
    assert service.residency.entry_for_slot("fast_gpu") is not None

    service.stop_model_for_slot("fast_gpu")

    assert service.residency.entry_for_slot("fast_gpu") is None


def test_sweep_idle_slots_evicts_utility_but_not_keep_resident(tmp_path: Path) -> None:
    """Acceptance-adjacent: idle_evict policy (utility) is swept; keep_resident (fast_gpu) is not."""
    service, runner = _new_service(tmp_path)
    service.start_model("coder", slot_id="fast_gpu")
    service.start_model("coder", slot_id="utility")

    # Force both entries to appear long-idle without waiting in real time.
    for slot_id in ("fast_gpu", "utility"):
        entry = service.residency.entry_for_slot(slot_id)
        assert entry is not None
        entry.idle_since = "2000-01-01T00:00:00+00:00"
        entry.state = "idle"

    evicted = service.sweep_idle_slots(idle_timeout_seconds=1)

    assert evicted == ["utility"]
    assert service.residency.entry_for_slot("utility") is None
    assert service.residency.entry_for_slot("fast_gpu") is not None
    assert service.status_for_slot("fast_gpu").state == "running"
