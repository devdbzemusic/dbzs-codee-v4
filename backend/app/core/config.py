from pathlib import Path
import os

APP_NAME = "DBZS Code Assistant"
APP_VERSION = "0.4.0-rc.1"


def _normalize_config_path(value: str) -> Path:
    normalized = value.strip().replace("\\", "/")
    return Path(normalized).expanduser().resolve()


def get_app_data_dir() -> Path:
    configured = os.getenv("DBZS_APP_DATA_DIR")
    if configured:
        return _normalize_config_path(configured)

    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "DBZS" / "CodeAssistant"

    return Path.home() / ".dbzs" / "code-assistant"


def get_models_dir() -> Path:
    configured = os.getenv("DBZS_MODELS_DIR")
    if configured:
        return _normalize_config_path(configured)

    try:
        app_data = get_app_data_dir()
        settings_path = app_data / "settings.json"
        if settings_path.exists():
            import json
            raw = json.loads(settings_path.read_text(encoding="utf-8"))
            models_path = raw.get("modelsPath")
            if models_path:
                return _normalize_config_path(models_path)
    except Exception:
        pass

    project_root = Path(__file__).resolve().parent.parent.parent.parent
    return project_root / "models"


def get_ollama_dir() -> Path:
    configured = os.getenv("DBZS_OLLAMA_DIR")
    if configured:
        return _normalize_config_path(configured)

    return Path("G:/Ollama")


def get_ollama_models_dir() -> Path:
    configured = os.getenv("DBZS_OLLAMA_MODELS_DIR")
    if configured:
        return _normalize_config_path(configured)

    ollama_models = os.getenv("OLLAMA_MODELS")
    if ollama_models:
        return _normalize_config_path(ollama_models)

    colocated = get_ollama_dir() / "models"
    if colocated.exists():
        return colocated

    return Path.home() / ".ollama" / "models"


def get_win_runtimes_dir() -> Path:
    """Root for Windows tool/runtime bundles (llama-server, OpenSSL, …)."""
    configured = os.getenv("DBZS_WIN_RUNTIMES_DIR")
    if configured:
        return _normalize_config_path(configured)
    return Path("D:/win_runtimes")
