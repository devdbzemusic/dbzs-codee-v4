"""Runtime Resource Planner (Phase 1).

Computes a hardware-fit RuntimeResourcePlan for a model/slot instead of the
previous approach of blindly setting `n_gpu_layers=99` or relying on a single
slot-hardcoded override (see docs/RUNTIME_RESOURCE_AUDIT.md). Reuses the
model-size-aware VRAM math already present in
`app.models.profile_service.ProfileService.estimate_resource_usage_for_profile`
instead of reinventing it, and extends its size buckets to cover larger models.
"""
from __future__ import annotations

from app.models.schemas import IndexedModel
from app.runtime.gpu_detect import GpuInfo, _estimate_gpu_layers
from app.runtime.schemas import RuntimeProfileName, RuntimeResourcePlan, RuntimeSlotId

# Extends the name-substring buckets in profile_service.py::estimate_resource_usage_for_profile
# (which only covers 7b/3b/2b/1.5b) with larger tiers, since this planner must also size models
# the profile estimator was never asked to handle.
_SIZE_BUCKETS_BYTES: list[tuple[str, int]] = [
    ("70b", 40_000_000_000),
    ("34b", 20_000_000_000),
    ("13b", 8_000_000_000),
    ("8b", 5_500_000_000),
    ("7b", 5_000_000_000),
    ("4b", 3_000_000_000),
    ("3b", 2_500_000_000),
    ("2b", 1_600_000_000),
    ("1.5b", 1_600_000_000),
]
_DEFAULT_MODEL_BYTES = 2_000_000_000

# KV cache size relative to f16 (llama.cpp's q8_0 cache is ~half f16, q4_0 ~quarter).
_CACHE_TYPE_RELATIVE_TO_F16: dict[str, float] = {"f16": 1.0, "q8_0": 0.5, "q4_0": 0.25}

_BYTES_PER_MB = 1024 * 1024
_MIN_SAFETY_RESERVE_BYTES = 512 * _BYTES_PER_MB
_LOW_VRAM_SAFETY_RESERVE_BYTES = 768 * _BYTES_PER_MB
_LOW_VRAM_THRESHOLD_BYTES = int(4.5 * 1024 * _BYTES_PER_MB)
_GPU_LAYER_STEP = 4

_PROFILE_CONTEXT_SIZE: dict[str, int] = {
    "fast": 2048,
    "balanced": 4096,
    "large_context": 16384,
    "cpu_safe": 4096,
    "hybrid": 4096,
}


def _estimate_model_bytes(model: IndexedModel) -> int:
    if model.size_bytes:
        return model.size_bytes
    haystack = f"{model.id} {model.name}".lower()
    for token, size in _SIZE_BUCKETS_BYTES:
        if token in haystack:
            return size
    return _DEFAULT_MODEL_BYTES


def _estimate_kv_cache_bytes(context_size: int, cache_type_k: str, cache_type_v: str) -> int:
    # Coarse per-token proxy, mirroring profile_service.py's existing
    # `cache_size_mb = max(256, min(4096, context_size // 4))` heuristic — the
    # model index does not carry per-model layer/head-count metadata needed
    # for an exact formula, so callers must treat this as approximate
    # (see the "kv_cache_estimate_approximate" warning added by plan()).
    base_mb = max(256, min(4096, context_size // 4))
    relative = (
        _CACHE_TYPE_RELATIVE_TO_F16.get(cache_type_k, 1.0)
        + _CACHE_TYPE_RELATIVE_TO_F16.get(cache_type_v, 1.0)
    ) / 2.0
    return int(base_mb * relative * _BYTES_PER_MB)


def _estimate_compute_buffer_bytes(batch_size: int) -> int:
    return max(256 * _BYTES_PER_MB, int(batch_size * 1.5 * _BYTES_PER_MB))


def _safety_reserve_bytes(available_vram_bytes: int | None) -> int:
    if available_vram_bytes is None:
        return _MIN_SAFETY_RESERVE_BYTES
    reserve = max(_MIN_SAFETY_RESERVE_BYTES, round(available_vram_bytes * 0.15))
    if available_vram_bytes <= _LOW_VRAM_THRESHOLD_BYTES:
        reserve = max(reserve, _LOW_VRAM_SAFETY_RESERVE_BYTES)
    return reserve


def _fits_in_vram(total_bytes: int, available_vram_bytes: int | None, safety_reserve_bytes: int) -> bool:
    if available_vram_bytes is None:
        return True
    return total_bytes <= available_vram_bytes - safety_reserve_bytes


def _choose_gpu_layers(
    *,
    model_bytes: int,
    context_size: int,
    batch_size: int,
    cache_type_k: str,
    cache_type_v: str,
    gpu: GpuInfo | None,
    available_vram_bytes: int | None,
    safety_reserve_bytes: int,
    max_layers_hint: int | None = None,
) -> int:
    if gpu is None:
        return 0

    ceiling = max_layers_hint if max_layers_hint is not None else _estimate_gpu_layers(gpu.vram_mb)
    if ceiling <= 0:
        return 0

    compute_buffer_bytes = _estimate_compute_buffer_bytes(batch_size)
    kv_cache_bytes = _estimate_kv_cache_bytes(context_size, cache_type_k, cache_type_v)

    layers = ceiling
    while layers > 0:
        gpu_ratio = min(layers / 32.0, 1.0)
        total = int(model_bytes * gpu_ratio) + kv_cache_bytes + compute_buffer_bytes
        if _fits_in_vram(total, available_vram_bytes, safety_reserve_bytes):
            return layers
        layers -= _GPU_LAYER_STEP

    return 0


class RuntimeResourcePlanner:
    def __init__(self) -> None:
        pass

    def plan(
        self,
        model: IndexedModel,
        *,
        slot_id: RuntimeSlotId,
        gpu: GpuInfo | None,
        requested_profile: RuntimeProfileName | None = None,
        custom_overrides: dict[str, object] | None = None,
        mmproj_bytes: int = 0,
    ) -> RuntimeResourcePlan:
        warnings: list[str] = ["kv_cache_estimate_approximate"]
        overrides = custom_overrides or {}
        profile = requested_profile or "balanced"

        context_size = int(overrides.get("context_size", _PROFILE_CONTEXT_SIZE.get(profile, 4096)))
        batch_size = int(overrides.get("batch_size", 512 if profile != "hybrid" else 384))
        micro_batch_size = int(overrides.get("micro_batch_size", min(128, batch_size)))
        parallel = int(overrides.get("parallel", 1))
        threads = int(overrides.get("threads", 4))
        default_cache = "q8_0" if profile == "hybrid" else "f16"
        cache_type_k = str(overrides.get("cache_type_k", default_cache))
        cache_type_v = str(overrides.get("cache_type_v", default_cache))

        available_vram_bytes = (gpu.vram_mb * _BYTES_PER_MB) if gpu else None
        safety_reserve_bytes = _safety_reserve_bytes(available_vram_bytes)
        model_bytes = _estimate_model_bytes(model)
        # Plan 15, Phase 5: a loaded MMProj (vision projector) occupies VRAM
        # alongside the base model's layers. Budget for it up front by shrinking
        # the VRAM available for gpu_layers selection, so a dual-mode vision
        # start on vision_gpu doesn't silently eat into the safety reserve.
        available_vram_bytes_for_layers = (
            max(0, available_vram_bytes - mmproj_bytes) if available_vram_bytes is not None else None
        )

        if profile == "cpu_safe":
            gpu_layers = 0
        elif "gpu_layers" in overrides:
            gpu_layers = int(overrides["gpu_layers"])
        else:
            max_layers_hint = None
            if profile == "fast" and gpu is not None:
                max_layers_hint = _estimate_gpu_layers(gpu.vram_mb)
            elif profile == "hybrid" and gpu is not None:
                # Partial offload: keep headroom for KV + driver on 4GB-class cards.
                max_layers_hint = max(4, _estimate_gpu_layers(gpu.vram_mb) // 2)
            elif profile == "large_context" and gpu is not None:
                # Larger context reserves more room for KV cache, so bias toward
                # fewer GPU layers than the VRAM tier's default recommendation.
                max_layers_hint = max(0, _estimate_gpu_layers(gpu.vram_mb) // 2)

            gpu_layers = _choose_gpu_layers(
                model_bytes=model_bytes,
                context_size=context_size,
                batch_size=batch_size,
                cache_type_k=cache_type_k,
                cache_type_v=cache_type_v,
                gpu=gpu,
                available_vram_bytes=available_vram_bytes_for_layers,
                safety_reserve_bytes=safety_reserve_bytes,
                max_layers_hint=max_layers_hint,
            )
            if profile == "hybrid" and gpu is not None and gpu_layers == 0:
                # Prefer a tiny offload over pure CPU when the user asked for hybrid.
                gpu_layers = min(4, _estimate_gpu_layers(gpu.vram_mb))

        estimated_kv_cache_bytes = _estimate_kv_cache_bytes(context_size, cache_type_k, cache_type_v)
        estimated_compute_buffer_bytes = _estimate_compute_buffer_bytes(batch_size)
        gpu_ratio = min(gpu_layers / 32.0, 1.0) if gpu_layers else 0.0
        estimated_total_vram_bytes = (
            int(model_bytes * gpu_ratio) + estimated_kv_cache_bytes + estimated_compute_buffer_bytes + mmproj_bytes
            if gpu_layers > 0
            else 0
        )

        if gpu_layers == 0:
            hardware_mode = "cpu"
        elif gpu is not None and gpu_layers >= _estimate_gpu_layers(gpu.vram_mb):
            hardware_mode = "gpu"
        else:
            hardware_mode = "hybrid"

        if gpu is None and profile != "cpu_safe" and "gpu_layers" not in overrides:
            warnings.append("no_gpu_detected_forced_cpu")
        if available_vram_bytes is not None and estimated_total_vram_bytes > available_vram_bytes - safety_reserve_bytes:
            warnings.append("estimated_vram_exceeds_safety_reserve")

        return RuntimeResourcePlan(
            model_id=model.id,
            slot_id=slot_id,
            context_size=context_size,
            reserved_output_tokens=int(overrides.get("reserved_output_tokens", round(context_size * 0.22))),
            reserved_tool_tokens=int(overrides.get("reserved_tool_tokens", round(context_size * 0.07))),
            gpu_layers=gpu_layers,
            batch_size=batch_size,
            micro_batch_size=micro_batch_size,
            parallel=parallel,
            threads=threads,
            cache_type_k=cache_type_k,  # type: ignore[arg-type]
            cache_type_v=cache_type_v,  # type: ignore[arg-type]
            estimated_model_bytes=model_bytes,
            estimated_kv_cache_bytes=estimated_kv_cache_bytes,
            estimated_compute_buffer_bytes=estimated_compute_buffer_bytes,
            estimated_total_vram_bytes=estimated_total_vram_bytes,
            available_vram_bytes=available_vram_bytes,
            safety_reserve_bytes=safety_reserve_bytes,
            hardware_mode=hardware_mode,
            warnings=warnings,
            mmproj_bytes=mmproj_bytes,
        )

    def reduce_for_oom(self, previous_plan: RuntimeResourcePlan, attempt: int) -> RuntimeResourcePlan:
        """Return a copy of previous_plan with fewer GPU layers, for OOM retry.

        `attempt` is the retry count so far (1, 2, 3, ...); the reduction gets
        more aggressive each attempt. Never silently drops to gpu_layers=0
        without recording why in `warnings`.
        """
        reduction_factor = 0.5 ** attempt
        new_gpu_layers = max(0, int(previous_plan.gpu_layers * reduction_factor))
        if new_gpu_layers == previous_plan.gpu_layers and new_gpu_layers > 0:
            new_gpu_layers = max(0, new_gpu_layers - _GPU_LAYER_STEP)

        warnings = list(previous_plan.warnings)
        warnings.append(f"oom_retry_attempt_{attempt}_reduced_gpu_layers_to_{new_gpu_layers}")
        if new_gpu_layers == 0:
            warnings.append("oom_retry_forced_cpu_only")

        gpu_ratio = min(new_gpu_layers / 32.0, 1.0) if new_gpu_layers else 0.0
        # Carry the original mmproj_bytes forward: the projector is still loaded
        # even when we reduce gpu_layers, so it still consumes VRAM.  Including
        # it keeps estimated_total_vram_bytes honest across retries.
        mmproj = previous_plan.mmproj_bytes
        estimated_total_vram_bytes = (
            int(previous_plan.estimated_model_bytes * gpu_ratio)
            + previous_plan.estimated_kv_cache_bytes
            + previous_plan.estimated_compute_buffer_bytes
            + mmproj
            if new_gpu_layers > 0
            else 0
        )

        return previous_plan.model_copy(
            update={
                "gpu_layers": new_gpu_layers,
                "estimated_total_vram_bytes": estimated_total_vram_bytes,
                "hardware_mode": "cpu" if new_gpu_layers == 0 else "hybrid",
                "warnings": warnings,
                # mmproj_bytes unchanged — projector residency is independent of
                # gpu_layers: llama-server keeps it mapped in VRAM regardless.
            }
        )
