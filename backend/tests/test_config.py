from pathlib import Path

from app.core.config import get_ollama_models_dir


def test_ollama_models_dir_prefers_ollama_models_env(monkeypatch) -> None:
    monkeypatch.delenv("DBZS_OLLAMA_MODELS_DIR", raising=False)
    monkeypatch.setenv("OLLAMA_MODELS", "D:\\Ollama")

    assert get_ollama_models_dir() == Path("D:/Ollama").resolve()
