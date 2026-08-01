from __future__ import annotations

from typing import Any


class RuntimeProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        recoverable: bool,
        diagnostic_context: dict[str, Any] | None = None,
        recommended_action: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable
        self.diagnostic_context = diagnostic_context or {}
        self.recommended_action = recommended_action
