"""Cloud LLM fallback — Anthropic oder OpenAI, ausgewählt per Settings oder Env-Var."""
from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.settings.models import AppSettings


class CloudRuntimeClient:
    """Thin wrapper around Anthropic/OpenAI for cloud fallback chat."""

    def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        settings: "AppSettings | None" = None,
    ) -> str:
        anthropic_key = (
            (settings.anthropicApiKey.strip() if settings else "") or os.getenv("ANTHROPIC_API_KEY", "")
        )
        openai_key = (
            (settings.openaiApiKey.strip() if settings else "") or os.getenv("OPENAI_API_KEY", "")
        )

        if anthropic_key:
            try:
                return self._anthropic_chat(messages, model or "claude-haiku-4-5-20251001", anthropic_key)
            except Exception as exc:
                # Fallback zu OpenAI wenn Anthropic fehlschlaegt (z.B. credit balance)
                print(f"Anthropic fallback triggered: {exc}")
                if not openai_key:
                    raise

        if openai_key:
            return self._openai_chat(messages, model or "gpt-4o-mini", openai_key)
        
        raise RuntimeError(
            "Kein Cloud-API-Key konfiguriert (ANTHROPIC_API_KEY, OPENAI_API_KEY oder App-Einstellungen)."
        )

    def is_available(self, settings: "AppSettings | None" = None) -> bool:
        """True wenn mindestens ein Cloud-Key vorhanden ist."""
        anthropic_key = (
            (settings.anthropicApiKey.strip() if settings else "") or os.getenv("ANTHROPIC_API_KEY", "")
        )
        openai_key = (
            (settings.openaiApiKey.strip() if settings else "") or os.getenv("OPENAI_API_KEY", "")
        )
        return bool(anthropic_key or openai_key)

    def _anthropic_chat(self, messages: list[dict], model: str, api_key: str) -> str:
        import anthropic  # type: ignore[import-untyped]
        client = anthropic.Anthropic(api_key=api_key)
        system_msgs = [m["content"] for m in messages if m.get("role") == "system"]
        user_msgs = [m for m in messages if m.get("role") != "system"]
        resp = client.messages.create(
            model=model,
            max_tokens=1024,
            system="\n".join(system_msgs) if system_msgs else "Du bist ein hilfreicher Assistent.",
            messages=user_msgs,
        )
        return str(resp.content[0].text) if resp.content else ""

    def _openai_chat(self, messages: list[dict], model: str, api_key: str) -> str:
        from openai import OpenAI  # type: ignore[import-untyped]
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(model=model, messages=messages, max_tokens=1024)  # type: ignore[arg-type]
        return str(resp.choices[0].message.content or "")