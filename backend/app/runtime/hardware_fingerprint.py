"""Hardware fingerprinting for the Runtime Resource Planner (Phase 1).

A fingerprint identifies the machine a resource plan was computed for, so a
persisted "last good" plan is only reused when the hardware still matches —
never blindly replayed on different hardware.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform

from app.runtime.gpu_detect import GpuInfo
from app.runtime.schemas import HardwareFingerprint

try:
    import psutil  # type: ignore[import-not-found]
except ModuleNotFoundError:
    psutil = None  # type: ignore[assignment]


def _cpu_model() -> str | None:
    try:
        return platform.processor() or None
    except Exception:
        return None


def _cpu_threads() -> int:
    count = os.cpu_count()
    return count if count else 1


def _ram_bytes() -> int:
    if psutil is not None:
        try:
            return int(psutil.virtual_memory().total)
        except Exception:
            pass
    return 0


def _runtime_backend_for_gpu(gpu: GpuInfo | None) -> str:
    if gpu is None:
        return "cpu"
    if gpu.vendor == "nvidia":
        return "cuda"
    if gpu.vendor == "amd":
        return "vulkan"
    return "cpu"


def collect_hardware_fingerprint(gpu: GpuInfo | None) -> HardwareFingerprint:
    """Build a fingerprint from the current machine plus an already-detected GPU.

    Callers pass in the result of `gpu_detect.detect_gpu()` rather than this
    module re-detecting it, so a single detection pass can be reused for both
    the fingerprint and the resource plan.
    """
    return HardwareFingerprint(
        os=platform.system(),
        architecture=platform.machine(),
        cpu_model=_cpu_model(),
        cpu_threads=_cpu_threads(),
        ram_bytes=_ram_bytes(),
        gpu_name=gpu.name if gpu else None,
        gpu_vendor=gpu.vendor if gpu else None,
        vram_bytes=(gpu.vram_mb * 1024 * 1024) if gpu else None,
        runtime_backend=_runtime_backend_for_gpu(gpu),
    )


def fingerprint_hash(fingerprint: HardwareFingerprint) -> str:
    """Stable hash used to key persisted plans and compare hardware compatibility."""
    payload = fingerprint.model_dump()
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
