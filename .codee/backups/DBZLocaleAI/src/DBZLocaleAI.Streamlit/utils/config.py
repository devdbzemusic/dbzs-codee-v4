import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
import streamlit as st

class Config:
    """Configuration management for DBZ Locale AI Streamlit app"""
    
    def __init__(self):
        self.config_dir = Path.home() / ".dbz_locale_ai"
        self.config_file = self.config_dir / "config.json"
        self.ensure_config_dir()
    
    def ensure_config_dir(self):
        """Ensure configuration directory exists"""
        self.config_dir.mkdir(exist_ok=True)
    
    def load_config(self) -> Dict[str, Any]:
        """Load configuration from file"""
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                st.error(f"Fehler beim Laden der Konfiguration: {e}")
                return self.get_default_config()
        else:
            return self.get_default_config()
    
    def save_config(self, config: Dict[str, Any]) -> bool:
        """Save configuration to file"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            st.error(f"Fehler beim Speichern der Konfiguration: {e}")
            return False
    
    def get_default_config(self) -> Dict[str, Any]:
        """Get default configuration"""
        return {
            "api": {
                "openai": {
                    "enabled": False,
                    "api_key": "",
                    "base_url": "https://api.openai.com/v1",
                    "model": "gpt-4"
                },
                "claude": {
                    "enabled": False,
                    "api_key": "",
                    "model": "claude-3-5-sonnet-20241022"
                },
                "mistral": {
                    "enabled": False,
                    "api_key": "",
                    "model": "mistral-large-latest"
                }
            },
            "local_models": {
                "enabled": True,
                "model_path": "",
                "available_models": [],
                "default_model": ""
            },
            "performance": {
                "max_tokens": 2048,
                "temperature": 0.7,
                "use_gpu": True,
                "gpu_layers": 20,
                "context_length": 4096
            },
            "ui": {
                "theme": "light",
                "language": "de",
                "chat_history_limit": 100,
                "auto_save": True
            },
            "agents": {
                "enabled": True,
                "max_concurrent": 3,
                "timeout": 300,
                "available_agents": [
                    {
                        "name": "Research Agent",
                        "description": "Spezialisiert auf Recherche und Informationsbeschaffung",
                        "capabilities": ["search", "analysis", "summarization"]
                    },
                    {
                        "name": "Code Agent",
                        "description": "Spezialisiert auf Programmierung und Code-Analyse",
                        "capabilities": ["coding", "debugging", "code_review"]
                    },
                    {
                        "name": "Writing Agent",
                        "description": "Spezialisiert auf Texterstellung und -bearbeitung",
                        "capabilities": ["writing", "editing", "translation"]
                    }
                ]
            },
            "storage": {
                "project_path": str(Path.home() / "DBZ_Locale_AI_Projects"),
                "cloud_storage": "local",
                "auto_backup": True,
                "backup_interval": 3600
            }
        }

# Global configuration instance
_config_instance = None

def get_config() -> Config:
    """Get global configuration instance"""
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance

def load_config() -> Dict[str, Any]:
    """Load configuration"""
    return get_config().load_config()

def save_config(config: Dict[str, Any]) -> bool:
    """Save configuration"""
    return get_config().save_config(config)

def get_api_key(provider: str) -> Optional[str]:
    """Get API key for a specific provider"""
    config = load_config()
    api_config = config.get("api", {}).get(provider, {})
    if api_config.get("enabled", False):
        return api_config.get("api_key", "")
    return None

def is_api_enabled(provider: str) -> bool:
    """Check if API provider is enabled"""
    config = load_config()
    return config.get("api", {}).get(provider, {}).get("enabled", False)

def get_available_models() -> Dict[str, list]:
    """Get available models by category"""
    config = load_config()
    models = {
        "local": [],
        "api": []
    }
    
    # Local models
    if config.get("local_models", {}).get("enabled", False):
        models["local"] = config.get("local_models", {}).get("available_models", [])
    
    # API models
    api_config = config.get("api", {})
    for provider, settings in api_config.items():
        if settings.get("enabled", False):
            model_name = settings.get("model", "")
            if model_name:
                models["api"].append(f"{provider}: {model_name}")
    
    return models

def update_config_value(key_path: str, value: Any) -> bool:
    """Update a specific configuration value using dot notation"""
    config = load_config()
    keys = key_path.split('.')
    
    # Navigate to the parent of the target key
    current = config
    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        current = current[key]
    
    # Set the value
    current[keys[-1]] = value
    
    return save_config(config)

def get_config_value(key_path: str, default: Any = None) -> Any:
    """Get a specific configuration value using dot notation"""
    config = load_config()
    keys = key_path.split('.')
    
    current = config
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return default
    
    return current

