from __future__ import annotations

import json

from app.core.config import get_app_data_dir
from app.settings.models import ModelDiscoveryMode


def get_model_discovery_mode() -> ModelDiscoveryMode:
    try:
        settings_path = get_app_data_dir() / "settings.json"
        if settings_path.exists():
            raw = json.loads(settings_path.read_text(encoding="utf-8"))
            mode = raw.get("modelDiscoveryMode", "project_local_strict")
            if mode in ("project_local_strict", "local_with_ollama", "cloud_enabled"):
                return mode
    except Exception:
        pass
    return "project_local_strict"
