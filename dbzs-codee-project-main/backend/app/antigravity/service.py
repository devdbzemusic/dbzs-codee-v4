from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Callable

try:
    from google.antigravity import Agent, LocalAgentConfig
    from google.antigravity.hooks import policy
except Exception as exc:  # pragma: no cover - import guard for optional dependency setup
    Agent = None  # type: ignore[assignment]
    LocalAgentConfig = None  # type: ignore[assignment]
    policy = None  # type: ignore[assignment]
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


@dataclass
class AntigravityRunResult:
    text: str
    model: str | None = None
    error: str | None = None


class AntigravityAgentService:
    """Thin wrapper around the local Antigravity SDK.

    This keeps the integration isolated so DBZS can use Antigravity without
    directly depending on the SDK internals in the rest of the backend.
    """

    def __init__(self, *, api_key: str | None = None) -> None:
        self._api_key = api_key or os.getenv("GEMINI_API_KEY")
        self._import_error = _IMPORT_ERROR

    def is_available(self) -> bool:
        return Agent is not None and LocalAgentConfig is not None and self._import_error is None

    async def run_prompt(self, prompt: str, *, system_instructions: str | None = None, tools: list[Callable[..., Any]] | None = None) -> AntigravityRunResult:
        if not self.is_available():
            return AntigravityRunResult(
                text="",
                error=f"Antigravity SDK could not be imported: {self._import_error}",
            )

        config_kwargs: dict[str, Any] = {}
        if self._api_key:
            config_kwargs["api_key"] = self._api_key
        if system_instructions:
            config_kwargs["system_instructions"] = system_instructions
        # SDK-Built-ins sind standardmaessig aktiv. CODEE fuehrt deshalb keine
        # SDK-Tools aus; alle Aktionen muessen durch die eigene Approval-Policy.
        config_kwargs["tools"] = []
        config_kwargs["policies"] = [policy.deny_all()]

        config = LocalAgentConfig(**config_kwargs)
        async with Agent(config) as agent:
            response = await agent.chat(prompt)
            text = await response.text()
            return AntigravityRunResult(text=text, model=getattr(config, "model", None))

    def run_prompt_sync(self, prompt: str, *, system_instructions: str | None = None, tools: list[Callable[..., Any]] | None = None) -> AntigravityRunResult:
        return asyncio.run(self.run_prompt(prompt, system_instructions=system_instructions, tools=tools))
