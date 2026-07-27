"""
GPU detection utilities — tries nvidia-smi, then rocm-smi, falls back to CPU-only.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass
class GpuInfo:
    name: str
    vram_mb: int
    recommended_gpu_layers: int
    vendor: str  # "nvidia" | "amd" | "unknown"
    is_compute: bool = True
    is_display: bool = False


def _detect_system_video_controllers() -> list[str]:
    import platform
    if platform.system() != "Windows":
        return []
    try:
        result = subprocess.run(
            ["wmic", "path", "win32_VideoController", "get", "name"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.returncode == 0:
            lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
            if lines and lines[0].lower() == "name":
                return lines[1:]
            return lines
    except Exception:
        pass
    return []


def detect_all_gpus() -> list[GpuInfo]:
    gpus: list[GpuInfo] = []
    
    # 1. Try to detect NVIDIA Compute GPU via nvidia-smi
    nvidia = _try_nvidia()
    if nvidia:
        nvidia.is_compute = True
        nvidia.is_display = False
        gpus.append(nvidia)
        
    # 2. Try to detect other GPUs via WMI on Windows
    controllers = _detect_system_video_controllers()
    for name in controllers:
        name_lower = name.lower()
        if "nvidia" in name_lower or "geforce" in name_lower:
            if not any(g.vendor == "nvidia" for g in gpus):
                gpus.append(GpuInfo(name=name, vram_mb=4096, recommended_gpu_layers=8, vendor="nvidia", is_compute=True, is_display=False))
            continue
            
        if "amd" in name_lower or "radeon" in name_lower:
            # AMD Radeon iGPU is display-only
            gpus.append(GpuInfo(name=name, vram_mb=2048, recommended_gpu_layers=0, vendor="amd", is_compute=False, is_display=True))
            
    # Default fallback: if nothing detected but rocm-smi succeeded
    if not gpus:
        amd = _try_amd()
        if amd:
            amd.is_compute = True
            amd.is_display = False
            gpus.append(amd)
            
    return gpus


def detect_gpu() -> GpuInfo | None:
    """
    Returns GpuInfo if a discrete GPU is detected, otherwise None.
    Tries NVIDIA first, then AMD ROCm.
    """
    for gpu in detect_all_gpus():
        if gpu.is_compute:
            return gpu
    return None


def _try_nvidia() -> GpuInfo | None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        first_line = result.stdout.strip().splitlines()[0]
        parts = [p.strip() for p in first_line.split(",")]
        if len(parts) < 2:
            return None

        name = parts[0]
        vram_mb = int(parts[1])
        gpu_layers = _estimate_gpu_layers(vram_mb)
        return GpuInfo(name=name, vram_mb=vram_mb, recommended_gpu_layers=gpu_layers, vendor="nvidia")
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        return None


def _try_amd() -> GpuInfo | None:
    try:
        result = subprocess.run(
            ["rocm-smi", "--showmeminfo", "vram", "--json"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        import json
        data = json.loads(result.stdout)
        # rocm-smi JSON format varies — try to extract a vram total
        for key, val in data.items():
            if isinstance(val, dict):
                vram_total = val.get("VRAM Total Memory (B)")
                if vram_total:
                    vram_mb = int(vram_total) // (1024 * 1024)
                    gpu_layers = _estimate_gpu_layers(vram_mb)
                    return GpuInfo(name=f"AMD GPU ({key})", vram_mb=vram_mb, recommended_gpu_layers=gpu_layers, vendor="amd")
        return None
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError, Exception):
        return None


def _estimate_gpu_layers(vram_mb: int) -> int:
    """Heuristic: map VRAM to recommended llama.cpp --gpu-layers value."""
    if vram_mb >= 24_000:
        return 99  # All layers for 24+ GB
    if vram_mb >= 16_000:
        return 48
    if vram_mb >= 12_000:
        return 36
    if vram_mb >= 8_000:
        return 24
    if vram_mb >= 6_000:
        return 16
    if vram_mb >= 4_000:
        return 8
    return 0  # CPU only below 4 GB
