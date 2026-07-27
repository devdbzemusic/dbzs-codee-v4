import pytest

from app.runtime.service import LlamaServerChatClient, OllamaChatClient


def test_llama_server_chat_client_wraps_timeout(monkeypatch) -> None:
    def raise_timeout(*_args, **_kwargs) -> None:
        raise TimeoutError("timed out")

    monkeypatch.setattr("urllib.request.urlopen", raise_timeout)
    client = LlamaServerChatClient()

    with pytest.raises(RuntimeError, match="timed out after"):
        client.complete("http://127.0.0.1:8091", {"messages": []})


def test_ollama_chat_client_wraps_timeout(monkeypatch) -> None:
    def raise_timeout(*_args, **_kwargs) -> None:
        raise TimeoutError("timed out")

    monkeypatch.setattr("urllib.request.urlopen", raise_timeout)
    client = OllamaChatClient()

    with pytest.raises(RuntimeError, match="timed out after"):
        client.complete("http://127.0.0.1:11434", {"messages": []})
