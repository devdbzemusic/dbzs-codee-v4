from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any


def parse_llama_server_sse_usage(line: str) -> dict[str, int] | None:
    """Extracts {"prompt_tokens", "completion_tokens"} from an SSE line's
    `usage` field, if present (llama-server sends this on the final chunk).
    Previously silently dropped — this is the Phase 5 usage-threading hook.
    """
    stripped = line.strip()
    if not stripped.startswith("data:"):
        return None

    payload = stripped[5:].strip()
    if payload == "[DONE]":
        return None

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    usage = data.get("usage")
    if not isinstance(usage, dict):
        return None

    prompt_tokens = usage.get("prompt_tokens")
    completion_tokens = usage.get("completion_tokens")
    if not isinstance(prompt_tokens, int) or not isinstance(completion_tokens, int):
        return None

    return {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens}


def parse_llama_server_sse_line(line: str) -> str | None:
    stripped = line.strip()
    if not stripped.startswith("data:"):
        return None

    payload = stripped[5:].strip()
    if payload == "[DONE]":
        return None

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    delta = choices[0].get("delta")
    if not isinstance(delta, dict):
        return None

    content = delta.get("content")
    if isinstance(content, str) and content:
        return content
    return None


def parse_llama_server_sse_finish_reason(line: str) -> str | None:
    stripped = line.strip()
    if not stripped.startswith("data:"):
        return None

    payload = stripped[5:].strip()
    if payload == "[DONE]":
        return "stop"

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    reason = choices[0].get("finish_reason") if isinstance(choices[0], dict) else None
    return reason if isinstance(reason, str) and reason else None


def parse_ollama_ndjson_line(line: str) -> tuple[str | None, bool]:
    stripped = line.strip()
    if not stripped:
        return None, False

    try:
        data = json.loads(stripped)
    except json.JSONDecodeError:
        return None, False

    message = data.get("message")
    content: str | None = None
    if isinstance(message, dict) and isinstance(message.get("content"), str):
        content = message["content"] or None

    return content, bool(data.get("done"))


def iter_llama_server_stream(
    response: Any,
    *,
    on_usage: Callable[[dict[str, int]], None] | None = None,
    on_finish: Callable[[str], None] | None = None,
) -> Iterator[str]:
    for raw_line in response:
        if not raw_line:
            continue
        line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else str(raw_line)
        chunk = parse_llama_server_sse_line(line)
        if chunk:
            yield chunk
        if on_usage is not None:
            usage = parse_llama_server_sse_usage(line)
            if usage is not None:
                on_usage(usage)
        finish_reason = parse_llama_server_sse_finish_reason(line)
        if finish_reason is not None:
            if on_finish is not None:
                on_finish(finish_reason)
            break


def iter_ollama_stream(response: Any) -> Iterator[str]:
    for raw_line in response:
        if not raw_line:
            continue
        line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else str(raw_line)
        chunk, done = parse_ollama_ndjson_line(line)
        if chunk:
            yield chunk
        if done:
            break
