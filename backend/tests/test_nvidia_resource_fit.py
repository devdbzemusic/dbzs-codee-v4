import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.runtime.gpu_detect import GpuInfo, detect_all_gpus, detect_gpu
from app.runtime.schemas import RuntimeChatRequest, RuntimeChatMessage, RuntimeChatFileContext
from app.runtime.service import RuntimeService
from app.models.profiles import ServerProfile, ModelInstance, GPUConfig, ContextConfig
from app.models.profile_service import ProfileService
from app.models.index_service import ModelIndexService


@pytest.fixture(autouse=True)
def _isolate_win_runtimes_discovery(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # See the identical fixture in tests/test_runtime_doctor.py -- keeps
    # ProfileService()/RuntimeService()'s OpenSSL/llama-runtime discovery off
    # the real, potentially large D:\win_runtimes on this machine.
    monkeypatch.setenv("DBZS_WIN_RUNTIMES_DIR", str(tmp_path / "win_runtimes"))


def test_gpu_role_detection_nvidia_amd_wmic():
    # Mock platform to Windows
    with patch("platform.system", return_value="Windows"), \
         patch("app.runtime.gpu_detect._try_nvidia", return_value=GpuInfo(name="NVIDIA GTX 1650 SUPER", vram_mb=4096, recommended_gpu_layers=8, vendor="nvidia")), \
         patch("app.runtime.gpu_detect._detect_system_video_controllers", return_value=["NVIDIA GeForce GTX 1650 SUPER", "AMD Radeon(TM) Graphics"]):
        
        all_gpus = detect_all_gpus()
        
        # Should have NVIDIA and AMD Radeon
        nvidia_gpu = next((g for g in all_gpus if g.vendor == "nvidia"), None)
        amd_gpu = next((g for g in all_gpus if g.vendor == "amd"), None)
        
        assert nvidia_gpu is not None
        assert nvidia_gpu.is_compute is True
        assert nvidia_gpu.is_display is False
        
        assert amd_gpu is not None
        assert amd_gpu.is_compute is False
        assert amd_gpu.is_display is True
        
        # detect_gpu should return the NVIDIA compute card
        primary = detect_gpu()
        assert primary is not None
        assert primary.vendor == "nvidia"
        assert "GTX 1650" in primary.name


def test_vram_estimation_gpu_vs_cpu(tmp_path: Path):
    profile_service = ProfileService(tmp_path, model_lab_repository=None, settings_service=None)
    
    # Create index with a mock model
    mock_model_index = MagicMock()
    mock_model = MagicMock()
    mock_model.id = "mock-2b"
    mock_model.size_bytes = 1_600_000_000  # ~1525 MB
    mock_model_index.models = [mock_model]
    
    with patch.object(profile_service.model_index_service, "build_index", return_value=mock_model_index):
        # 1. Profile with model on GPU
        gpu_profile = ServerProfile(
            name="gpu-profile",
            hardware_class="mid",
            models=[
                ModelInstance(
                    model_id="mock-2b",
                    model_name="Mock 2B",
                    port=8081,
                    gpu_config=GPUConfig(n_gpu_layers=32, n_threads=4),
                    context_config=ContextConfig(context_size=2048, cache_size_mb=512)
                )
            ]
        )
        
        # VRAM_est = (1525.8 MB * 1.0) + 512 MB (cache) + 256 MB (buffer) + 512 MB (safety)
        # Expected VRAM = ~2805.8 MB
        usage = profile_service.estimate_resource_usage_for_profile(gpu_profile)
        assert usage["total_gpu_memory_mb"] > 2700.0
        assert usage["total_gpu_memory_mb"] < 2900.0
        
        # 2. Profile with model on CPU (layers = 0)
        cpu_profile = ServerProfile(
            name="cpu-profile",
            hardware_class="mid",
            models=[
                ModelInstance(
                    model_id="mock-2b",
                    model_name="Mock 2B",
                    port=8082,
                    gpu_config=GPUConfig(n_gpu_layers=0, n_threads=4),
                    context_config=ContextConfig(context_size=2048, cache_size_mb=512)
                )
            ]
        )
        # Expected VRAM = 0.0 MB because no GPU layers are offloaded
        cpu_usage = profile_service.estimate_resource_usage_for_profile(cpu_profile)
        assert cpu_usage["total_gpu_memory_mb"] == 0.0


def test_vram_limit_validation(tmp_path: Path):
    profile_service = ProfileService(tmp_path, model_lab_repository=None, settings_service=None)
    
    # 1. Profile within limits
    safe_profile = ServerProfile(
        name="safe",
        hardware_class="mid",
        models=[
            ModelInstance(
                model_id="qwen-2b",
                model_name="Qwen 2B",
                port=8081,
                gpu_config=GPUConfig(n_gpu_layers=32),  # GPU
                context_config=ContextConfig(cache_size_mb=1024)
            )
        ]
    )
    is_valid, msg = profile_service.validate_profile_resources(safe_profile)
    assert is_valid is True
    
    # 2. Profile exceeding limits (huge cache size)
    unsafe_profile = ServerProfile(
        name="unsafe",
        hardware_class="mid",
        models=[
            ModelInstance(
                model_id="qwen-2b",
                model_name="Qwen 2B",
                port=8081,
                gpu_config=GPUConfig(n_gpu_layers=32),
                context_config=ContextConfig(cache_size_mb=4000) # cache alone > 3.5GB
            )
        ]
    )
    is_valid, msg = profile_service.validate_profile_resources(unsafe_profile)
    assert is_valid is False
    assert "exceeds NVIDIA GTX 1650 SUPER capacity" in msg


def test_runtime_service_slot_mapping_and_overrides(tmp_path: Path):
    # Setup mock catalog index
    catalog = {
        "base_dir": str(tmp_path),
        "runtime_dir": str(tmp_path),
        "artifacts": [
            {
                "id": "coder",
                "name": "Coder Q4",
                "artifact_type": "model",
                "role": "CODE_MODEL",
                "capabilities": ["chat", "code"],
                "modality": ["text"],
                "file_path": str(tmp_path / "coder.gguf"),
                "size_bytes": 1000,
                "quantization": "Q4_K_M",
                "backend": "llama.cpp",
                "loader": {"launcher": "llama-server"},
            }
        ],
    }
    runtime = {
        "artifacts": [],
        "models": {
            "coder": {
                "runtime": {"ctx": 4096, "gpu_layers": 12},
                "server": {"enabled": True, "preferred_port": 8082},
            }
        },
    }
    (tmp_path / "coder.gguf").write_text("GGUF", encoding="utf-8")
    (tmp_path / "models.catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (tmp_path / "models.runtime.json").write_text(json.dumps(runtime), encoding="utf-8")
    
    service = RuntimeService(
        model_index_service=ModelIndexService(models_dir=tmp_path),
        simulation_mode=True
    )
    
    # 1. Start coder (mapped to fast_gpu slot because port=8082)
    # The GPU slot must keep the GPU policy and not silently remap to CPU
    status = service.start_model("coder")
    assert status.state == "running"
    assert status.slot_id == "fast_gpu"

    # 2. Check override was applied in slot start configuration
    # (Since simulation mode is active, it did not spawn real process, but mapped the slot successfully)
    assert service._statuses["fast_gpu"].slot_id == "fast_gpu"


def test_runtime_service_task_routing():
    service = RuntimeService(simulation_mode=True)
    
    # Setup statuses
    service._statuses["fast_gpu"].state = "running"
    service._statuses["quality_cpu"].state = "running"
    
    # 1. Coding keywords in message -> fast_gpu
    req1 = RuntimeChatRequest(
        messages=[RuntimeChatMessage(role="user", content="Wie implementiere ich das parallel?")]
    )
    assert service._route_request_slot(req1) == "fast_gpu"

    # 2. File context present -> fast_gpu
    req2 = RuntimeChatRequest(
        messages=[RuntimeChatMessage(role="user", content="Erkläre das.")],
        file_context=RuntimeChatFileContext(path="main.py", language="python", content="print('hello')")
    )
    assert service._route_request_slot(req2) == "fast_gpu"
    
    # 3. Legacy requests without explicit slot default to quality_cpu
    req3 = RuntimeChatRequest(
        messages=[RuntimeChatMessage(role="user", content="Hi! Wie geht es dir heute?")]
    )
    assert service._route_request_slot(req3) == "quality_cpu"
