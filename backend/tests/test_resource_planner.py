from app.models.schemas import IndexedModel, ModelRuntimeHints
from app.runtime.gpu_detect import GpuInfo
from app.runtime.resource_planner import RuntimeResourcePlanner


def make_model(
    model_id: str = "model-7b",
    size_bytes: int = 5_000_000_000,
) -> IndexedModel:
    return IndexedModel(
        id=model_id,
        name=model_id,
        path=f"D:/Models/{model_id}.gguf",
        format="gguf",
        artifact_type="model",
        size_bytes=size_bytes,
        size_gb=size_bytes / (1024**3),
        quantization="Q4_K_M",
        backend="llama.cpp",
        runtime_launcher="llama-server",
        capabilities=["chat", "code"],
        modality=["text"],
        role=None,
        recommended_use="coding_candidate",
        compatibility="llama_server_ready",
        runtime=ModelRuntimeHints(),
    )


def make_gpu(vram_mb: int, recommended_gpu_layers: int = 0) -> GpuInfo:
    return GpuInfo(
        name="Test GPU",
        vram_mb=vram_mb,
        recommended_gpu_layers=recommended_gpu_layers,
        vendor="nvidia",
    )


def test_gpu_layers_computed_dynamically_from_vram() -> None:
    """Acceptance test 1: GPU layers computed dynamically, not blindly set to 99."""
    planner = RuntimeResourcePlanner()
    model = make_model()

    small_gpu_plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(4096), requested_profile="balanced")
    large_gpu_plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(24576), requested_profile="balanced")

    assert small_gpu_plan.gpu_layers < large_gpu_plan.gpu_layers
    assert large_gpu_plan.gpu_layers <= 99
    assert small_gpu_plan.gpu_layers != 99  # never blindly n_gpu_layers=99


def test_no_gpu_forces_cpu_only() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()

    plan = planner.plan(model, slot_id="fast_gpu", gpu=None, requested_profile="balanced")

    assert plan.gpu_layers == 0
    assert plan.hardware_mode == "cpu"
    assert "no_gpu_detected_forced_cpu" in plan.warnings


def test_vram_reserve_respected_for_low_vram_gpu() -> None:
    """Acceptance test 2: for ~4GB VRAM, reserve at least 512-768MB and never exceed budget."""
    planner = RuntimeResourcePlanner()
    model = make_model()

    plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(4096), requested_profile="balanced")

    assert plan.safety_reserve_bytes >= 512 * 1024 * 1024
    assert plan.available_vram_bytes == 4096 * 1024 * 1024
    assert plan.estimated_total_vram_bytes <= plan.available_vram_bytes - plan.safety_reserve_bytes


def test_vram_reserve_scales_with_available_vram() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()

    low_vram_plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(4096), requested_profile="balanced")
    high_vram_plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(24576), requested_profile="balanced")

    assert low_vram_plan.safety_reserve_bytes == 768 * 1024 * 1024
    assert high_vram_plan.safety_reserve_bytes > low_vram_plan.safety_reserve_bytes


def test_cpu_safe_profile_always_zero_gpu_layers() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()

    plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(24576, recommended_gpu_layers=99), requested_profile="cpu_safe")

    assert plan.gpu_layers == 0
    assert plan.hardware_mode == "cpu"


def test_hybrid_profile_uses_partial_gpu_layers() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()
    gpu = make_gpu(4096, recommended_gpu_layers=8)

    hybrid = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="hybrid")
    cpu_safe = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="cpu_safe")
    fast = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="fast")

    assert hybrid.gpu_layers > 0
    assert hybrid.gpu_layers <= fast.gpu_layers
    assert hybrid.hardware_mode in ("hybrid", "gpu")
    assert hybrid.cache_type_k == "q8_0"
    assert cpu_safe.gpu_layers == 0


def test_hardware_profiles_are_separated() -> None:
    """Acceptance test 20 (profiles part): Fast/Balanced/Large Context/CPU Safe differ meaningfully."""
    planner = RuntimeResourcePlanner()
    model = make_model()
    gpu = make_gpu(16384, recommended_gpu_layers=48)

    fast_plan = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="fast")
    balanced_plan = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="balanced")
    large_context_plan = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="large_context")
    cpu_safe_plan = planner.plan(model, slot_id="fast_gpu", gpu=gpu, requested_profile="cpu_safe")

    assert fast_plan.context_size < balanced_plan.context_size < large_context_plan.context_size
    assert cpu_safe_plan.gpu_layers == 0
    assert large_context_plan.gpu_layers <= fast_plan.gpu_layers


def test_reduce_for_oom_lowers_gpu_layers_and_records_warning() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()
    plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(16384, recommended_gpu_layers=48), requested_profile="balanced")
    assert plan.gpu_layers > 0

    reduced_once = planner.reduce_for_oom(plan, attempt=1)
    reduced_twice = planner.reduce_for_oom(reduced_once, attempt=2)

    assert reduced_once.gpu_layers < plan.gpu_layers
    assert reduced_twice.gpu_layers < reduced_once.gpu_layers
    assert any("oom_retry_attempt_1" in warning for warning in reduced_once.warnings)


def test_reduce_for_oom_eventually_reaches_cpu_only() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()
    plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(8192, recommended_gpu_layers=24), requested_profile="balanced")

    for attempt in range(1, 4):
        plan = planner.reduce_for_oom(plan, attempt=attempt)

    assert plan.gpu_layers == 0
    assert plan.hardware_mode == "cpu"
    assert "oom_retry_forced_cpu_only" in plan.warnings


def test_model_size_estimated_from_index_when_available() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model(size_bytes=13_000_000_000)

    plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(24576, recommended_gpu_layers=99), requested_profile="balanced")

    assert plan.estimated_model_bytes == 13_000_000_000


def test_model_size_falls_back_to_name_bucket_when_index_missing_size() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model(model_id="qwen-13b-instruct", size_bytes=0)

    plan = planner.plan(model, slot_id="fast_gpu", gpu=make_gpu(24576, recommended_gpu_layers=99), requested_profile="balanced")

    assert plan.estimated_model_bytes == 8_000_000_000


def test_mmproj_bytes_reduces_chosen_gpu_layers_on_low_vram_card() -> None:
    """Plan 15, Phase 5: a loaded MMProj projector (InternScience: ~0.626 GiB)
    must be budgeted for up front on a 4GB-class card, not silently ignored
    until llama-server OOMs."""
    planner = RuntimeResourcePlanner()
    model = make_model()
    gpu = make_gpu(4096, recommended_gpu_layers=16)

    without_mmproj = planner.plan(model, slot_id="vision_gpu", gpu=gpu, requested_profile="balanced")
    with_mmproj = planner.plan(
        model, slot_id="vision_gpu", gpu=gpu, requested_profile="balanced", mmproj_bytes=672_000_000
    )

    assert with_mmproj.gpu_layers <= without_mmproj.gpu_layers


def test_mmproj_bytes_included_in_estimated_total_vram() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()
    gpu = make_gpu(24576, recommended_gpu_layers=99)

    without_mmproj = planner.plan(model, slot_id="vision_gpu", gpu=gpu, requested_profile="balanced")
    with_mmproj = planner.plan(
        model, slot_id="vision_gpu", gpu=gpu, requested_profile="balanced", mmproj_bytes=672_000_000
    )

    assert with_mmproj.estimated_total_vram_bytes == without_mmproj.estimated_total_vram_bytes + 672_000_000


def test_mmproj_bytes_defaults_to_zero_when_unset() -> None:
    planner = RuntimeResourcePlanner()
    model = make_model()

    plan = planner.plan(model, slot_id="vision_gpu", gpu=make_gpu(16384, recommended_gpu_layers=48), requested_profile="balanced")

    assert plan.gpu_layers > 0


def test_reduce_for_oom_carries_mmproj_bytes_through_retries() -> None:
    """Plan 16, Stufe 5: reduce_for_oom() must not drop mmproj_bytes so that
    estimated_total_vram_bytes stays accurate across multiple OOM retries on a
    vision_gpu slot that loaded a projector alongside the base model."""
    planner = RuntimeResourcePlanner()
    model = make_model()
    gpu = make_gpu(8192, recommended_gpu_layers=32)
    mmproj = 672_000_000  # ~640 MB projector

    original = planner.plan(
        model, slot_id="vision_gpu", gpu=gpu, requested_profile="balanced", mmproj_bytes=mmproj
    )
    assert original.mmproj_bytes == mmproj

    reduced_1 = planner.reduce_for_oom(original, attempt=1)
    assert reduced_1.mmproj_bytes == mmproj, "mmproj_bytes must survive first OOM retry"
    assert reduced_1.gpu_layers < original.gpu_layers
    if reduced_1.gpu_layers > 0:
        assert reduced_1.estimated_total_vram_bytes >= mmproj, (
            "estimated_total_vram_bytes must include projector even after layer reduction"
        )

    reduced_2 = planner.reduce_for_oom(reduced_1, attempt=2)
    assert reduced_2.mmproj_bytes == mmproj, "mmproj_bytes must survive second OOM retry"


def test_reduce_for_oom_cpu_fallback_zeros_vram_not_projector() -> None:
    """When OOM forces cpu-only (gpu_layers=0) the projector is not loaded
    at all, so estimated_total_vram_bytes should be 0."""
    planner = RuntimeResourcePlanner()
    model = make_model(size_bytes=40_000_000_000)  # 40 GB – forces CPU on small GPU
    gpu = make_gpu(2048, recommended_gpu_layers=4)
    mmproj = 300_000_000

    original = planner.plan(
        model, slot_id="vision_gpu", gpu=gpu, requested_profile="balanced", mmproj_bytes=mmproj
    )
    # Force cpu-only via aggressive reduction
    cpu_plan = planner.reduce_for_oom(planner.reduce_for_oom(original, attempt=1), attempt=2)
    if cpu_plan.gpu_layers == 0:
        assert cpu_plan.estimated_total_vram_bytes == 0
        assert cpu_plan.hardware_mode == "cpu"
