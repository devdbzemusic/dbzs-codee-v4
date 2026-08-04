"""
Tests for model profiles and multi-server manager.
"""

import pytest
from pathlib import Path
import tempfile

from app.models.profiles import (
    ServerProfile,
    ModelInstance,
    GPUConfig,
    ContextConfig,
    get_default_profiles,
)
from app.models.profile_service import ProfileService
from app.runtime.schemas import RuntimeStatus


@pytest.fixture(autouse=True)
def _isolate_win_runtimes_discovery(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # See the identical fixture in tests/test_runtime_doctor.py: without this,
    # get_win_runtimes_dir() falls back to the real D:\win_runtimes on this
    # machine, which is why test_profile_validation alone took ~71s despite
    # passing -- ModelIndexService's own runtime-dir resolution and
    # build_launch_plan()'s OpenSSL DLL discovery both walk it uncached.
    monkeypatch.setenv("DBZS_WIN_RUNTIMES_DIR", str(tmp_path / "win_runtimes"))


def test_default_profiles_exist():
    """Test that default profiles are created."""
    profiles = get_default_profiles()
    assert len(profiles) > 0
    assert "chat-focused" in profiles
    assert "heavy-compute" in profiles
    assert "balanced" in profiles


def test_profile_service_init():
    """Test ProfileService initialization."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        assert service.active_profile is not None
        profiles = service.list_profiles()
        assert len(profiles) > 0


def test_profile_service_list_profiles():
    """Test listing profiles."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        profiles = service.list_profiles()
        assert "chat-focused" in profiles
        assert "balanced" in profiles


def test_profile_service_get_profile():
    """Test getting a profile by name."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        profile = service.get_profile("chat-focused")
        assert profile is not None
        assert profile.name == "chat-focused"
        assert len(profile.models) > 0


def test_profile_service_set_active_profile():
    """Test setting active profile."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        
        # Change to different profile
        result = service.set_active_profile("heavy-compute")
        assert result is True
        assert service.active_profile.name == "heavy-compute"
        
        # Try invalid profile
        result = service.set_active_profile("nonexistent")
        assert result is False


def test_profile_service_get_models_for_task():
    """Test getting models for a specific task."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        service.set_active_profile("chat-focused")
        
        models = service.get_models_for_task("chat")
        assert len(models) > 0
        
        # All returned models should have "chat" in their task affinity
        for model in models:
            assert "chat" in model.task_affinity


def test_profile_service_get_highest_priority_model():
    """Test getting highest priority model for a task."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        service.set_active_profile("balanced")
        
        model = service.get_highest_priority_model_for_task("chat")
        assert model is not None
        assert "chat" in model.task_affinity


def test_profile_service_register_model_instance():
    """Test registering a model instance."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        
        status = RuntimeStatus(
            state="running",
            port=8001,
            model_id="test-model",
            endpoint="http://localhost:8001"
        )
        
        service.register_model_instance("test-model", status)
        retrieved = service.get_model_instance_status("test-model")
        assert retrieved is not None
        assert retrieved.state == "running"


def test_profile_validation():
    """Test profile resource validation."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        profile = service.get_profile("chat-focused")
        
        is_valid, error_msg = service.validate_profile_resources(profile)
        assert is_valid is True
        assert error_msg == ""


def test_profile_estimate_resources():
    """Test resource estimation for a profile."""
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ProfileService(Path(tmpdir), model_lab_repository=None, settings_service=None)
        service.set_active_profile("chat-focused")
        
        resources = service.estimate_total_resource_usage()
        assert "total_gpu_memory_mb" in resources
        assert "total_vram_usage_mb" in resources
        assert "total_cpu_threads" in resources
        assert resources["total_vram_usage_mb"] > 0


def test_profile_persistence():
    """Test that profiles are saved and loaded correctly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        
        # Create and save config
        service1 = ProfileService(tmppath, model_lab_repository=None, settings_service=None)
        service1.set_active_profile("heavy-compute")
        service1.save_config()

        # Load in new service instance
        service2 = ProfileService(tmppath, model_lab_repository=None, settings_service=None)
        assert service2.active_profile.name == "heavy-compute"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
