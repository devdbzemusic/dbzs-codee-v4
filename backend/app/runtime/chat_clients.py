from __future__ import annotations

import json
import os
from typing import Callable, Iterator
from urllib import error, request

from app.runtime.chat_stream import iter_llama_server_stream, iter_ollama_stream


def _chat_timeout_seconds() -> float:
    return float(os.getenv("DBZS_RUNTIME_CHAT_TIMEOUT_SECONDS", "1800"))


def _raise_chat_request_error(provider: str, exc: BaseException) -> None:
    if isinstance(exc, TimeoutError):
      raise RuntimeError(
          f"{provider} request timed out after {int(_chat_timeout_seconds())}s. "
          "Modell antwortet zu langsam - kleineren Prompt, weniger max_tokens oder schnelleres Modell verwenden."
      ) from exc

    if isinstance(exc, error.HTTPError):
        details = ""
        try:
            details = exc.read().decode("utf-8", errors="replace")
        except Exception:
            details = str(exc)
        details = details.strip()
        suffix = f" | {details}" if details else ""
        raise RuntimeError(f"{provider} request failed: HTTP Error {exc.code}{suffix}") from exc

    raise RuntimeError(f"{provider} request failed: {exc}") from exc


class LlamaServerChatClient:
    last_finish_reason: str | None = None

    def complete(self, endpoint: str, payload: dict) -> str:
        body = json.dumps(payload).encode("utf-8")
        http_request = request.Request(
            f"{endpoint}/v1/chat/completions",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(http_request, timeout=_chat_timeout_seconds()) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (error.URLError, TimeoutError, OSError) as exc:
            _raise_chat_request_error("llama-server", exc)

        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("llama-server response did not include choices.")

        message = choices[0].get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise RuntimeError("llama-server response did not include assistant content.")

        return message["content"]

    def stream(
        self,
        endpoint: str,
        payload: dict,
        *,
        on_usage: Callable[[dict[str, int]], None] | None = None,
        on_finish: Callable[[str], None] | None = None,
    ) -> Iterator[str]:
        stream_payload = {**payload, "stream": True, "stream_options": {"include_usage": True}}
        body = json.dumps(stream_payload).encode("utf-8")
        http_request = request.Request(
            f"{endpoint}/v1/chat/completions",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(http_request, timeout=_chat_timeout_seconds()) as response:
                self.last_finish_reason = None

                def capture_finish(reason: str) -> None:
                    self.last_finish_reason = reason
                    if on_finish is not None:
                        on_finish(reason)

                yield from iter_llama_server_stream(
                    response,
                    on_usage=on_usage,
                    on_finish=capture_finish,
                )
        except (error.URLError, TimeoutError, OSError) as exc:
            _raise_chat_request_error("llama-server", exc)


class OllamaChatClient:
    def complete(self, endpoint: str, payload: dict) -> str:
        body = json.dumps(payload).encode("utf-8")
        http_request = request.Request(
            f"{endpoint}/api/chat",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(http_request, timeout=_chat_timeout_seconds()) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (error.URLError, TimeoutError, OSError) as exc:
            _raise_chat_request_error("Ollama", exc)

        message = data.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise RuntimeError("Ollama response did not include assistant content.")

        return message["content"]

    def stream(self, endpoint: str, payload: dict) -> Iterator[str]:
        stream_payload = {**payload, "stream": True}
        body = json.dumps(stream_payload).encode("utf-8")
        http_request = request.Request(
            f"{endpoint}/api/chat",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(http_request, timeout=_chat_timeout_seconds()) as response:
                yield from iter_ollama_stream(response)
        except (error.URLError, TimeoutError, OSError) as exc:
            _raise_chat_request_error("Ollama", exc)
