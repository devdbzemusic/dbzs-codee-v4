"""Inhaltsunabhaengige Secret-Redaction fuer Logs, Fehler und Persistenz."""
from __future__ import annotations

import re
from typing import Any

_KEYS = {"api_key", "apikey", "token", "access_token", "secret", "password", "authorization", "cookie", "set-cookie", "system_prompt"}
_PATTERNS = [
    re.compile(r"(?i)\b(api[_-]?key|access[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*([^\s,;]+)"),
    re.compile(r"(?i)\b([A-Za-z0-9_.-]*?(?:api[_-]?key|access[_-]?token|token|secret|password|authorization))\b\s*[:=]\s*([^\s,;]+)"),
    re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL),
]


def redact_text(value: str, limit: int | None = None) -> str:
    result = value
    for pattern in _PATTERNS:
        result = pattern.sub(lambda match: f"{match.group(1)}=[REDACTED]" if match.lastindex else "[REDACTED]", result)
    return result if limit is None else result[:limit]


def redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower() in _KEYS else redact_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_value(item) for item in value)
    return redact_text(value) if isinstance(value, str) else value
