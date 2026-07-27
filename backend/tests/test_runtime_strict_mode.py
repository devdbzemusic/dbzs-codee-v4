"""
P1 Phase 4: Tests for Strict Model Discovery Mode.

Verifies that project_local_strict mode:
- Only allows project-local models
- Rejects Ollama and cloud models
- Enforces repository-local paths
- Never uses catalog IDs over relative IDs
"""

import pytest
from pathlib import Path
from app.models.discovery import ModelDiscoveryService, get_project_models_dir
from app.models.index_service import ModelIndexService


class TestStrictModelDiscovery:
    """Test suite for strict model discovery enforcement."""

    def test_get_project_models_dir_returns_absolute_path(self, tmp_path):
        """
        P1 Requirement 9.2: get_project_models_dir() returns repository-local path.
        """
        models_dir = get_project_models_dir()
        
        # Must be absolute
        assert models_dir.is_absolute()
        
        # Must end with 'models'
        assert models_dir.name == "models"
        
        # Should exist (in actual repo)
        # Note: In test env may not exist, but path should be valid

    def test_strict_mode_rejects_non_project_local_paths(self, tmp_path):
        """
        P1 Requirement 9: Strict mode should reject non-project-local paths.
        """
        models_dir = tmp_path / "models"
        models_dir.mkdir(exist_ok=True)
        external_dir = tmp_path / "external_models"
        external_dir.mkdir(exist_ok=True)
        
        service = ModelDiscoveryService(
            mode="project_local_strict",
            models_dir=models_dir,
        )
        
        # Project-local model should be OK
        project_model = models_dir / "llm" / "model.gguf"
        project_model.parent.mkdir(parents=True, exist_ok=True)
        project_model.write_text("model")
        
        assert service._is_project_local(str(project_model)) is True
        
        # External model should be rejected
        external_model = external_dir / "external.gguf"
        external_model.write_text("model")
        
        assert service._is_project_local(str(external_model)) is False

    def test_strict_mode_enforces_relative_ids(self, tmp_path):
        """
        P1 Requirement 9.1: In strict mode, relative IDs are mandatory.
        """
        models_dir = tmp_path / "models"
        models_dir.mkdir(exist_ok=True)
        
        service = ModelDiscoveryService(
            mode="project_local_strict",
            models_dir=models_dir,
        )
        
        model_path = models_dir / "llm" / "qwen-7b-q8_0.gguf"
        model_path.parent.mkdir(parents=True, exist_ok=True)
        model_path.write_text("model")
        
        # Should generate relative ID
        relative_id = service.get_project_relative_id(str(model_path))
        
        assert relative_id is not None
        assert relative_id == "llm/qwen-7b-q8_0.gguf"
        assert not relative_id.startswith("/")  # Not absolute

    def test_strict_mode_rejects_ollama_models(self, tmp_path):
        """
        P1 Requirement 9: Strict mode should reject Ollama models.
        """
        models_dir = tmp_path / "models"
        models_dir.mkdir(exist_ok=True)
        ollama_dir = tmp_path / "ollama_models"
        ollama_dir.mkdir(exist_ok=True)
        
        service = ModelDiscoveryService(
            mode="project_local_strict",
            models_dir=models_dir,
            ollama_models_dir=ollama_dir,
        )
        
        ollama_model = ollama_dir / "mistral" / "model.gguf"
        ollama_model.parent.mkdir(parents=True, exist_ok=True)
        ollama_model.write_text("model")
        
        # Ollama model should NOT be project-local
        assert service._is_project_local(str(ollama_model)) is False
        
        # In strict mode, Ollama models are not allowed
        assert service.allows_ollama() is False

    def test_non_strict_mode_allows_multiple_sources(self, tmp_path):
        """
        Verify that non-strict modes (local_with_ollama, cloud_enabled)
        can access multiple model sources.
        """
        models_dir = tmp_path / "models"
        models_dir.mkdir(exist_ok=True)
        ollama_dir = tmp_path / "ollama"
        ollama_dir.mkdir(exist_ok=True)
        
        service_local = ModelDiscoveryService(
            mode="local_with_ollama",
            models_dir=models_dir,
            ollama_models_dir=ollama_dir,
        )
        
        # local_with_ollama should allow Ollama
        assert service_local.allows_ollama() is True
        assert service_local.allows_cloud() is False
        
        service_cloud = ModelDiscoveryService(
            mode="cloud_enabled",
            models_dir=models_dir,
            ollama_models_dir=ollama_dir,
        )
        
        # cloud_enabled should allow everything
        assert service_cloud.allows_ollama() is True
        assert service_cloud.allows_cloud() is True

    def test_strict_mode_validates_model_path(self, tmp_path):
        """
        P1 Requirement 9: validate_model_path() enforces strict boundaries.
        """
        models_dir = tmp_path / "models"
        models_dir.mkdir(exist_ok=True)
        external_dir = tmp_path / "external"
        external_dir.mkdir(exist_ok=True)
        
        service = ModelDiscoveryService(
            mode="project_local_strict",
            models_dir=models_dir,
        )
        
        project_model = models_dir / "model.gguf"
        project_model.write_text("model")
        external_model = external_dir / "model.gguf"
        external_model.write_text("model")
        
        # Strict mode: only project-local is valid
        assert service.validate_model_path(str(project_model)) is True
        assert service.validate_model_path(str(external_model)) is False
