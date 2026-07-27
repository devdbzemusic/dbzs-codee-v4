"""Anthropic API Client — Dynamische Modellliste."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


class AnthropicClient:
    """Client für Anthropic API mit dynamischer Modellliste."""

    API_BASE_URL = "https://api.anthropic.com/v1"
    CACHE_DURATION_SECONDS = 86400  # 24 Stunden

    def __init__(self, api_key: str | None = None, cache_dir: str | None = None) -> None:
        self.api_key = api_key
        self.cache_dir = Path(cache_dir) if cache_dir else self._default_cache_dir()
        self._ensure_cache_dir()

    def _default_cache_dir(self) -> Path:
        """Default Cache-Verzeichnis."""
        from app.config import get_app_data_dir
        return Path(get_app_data_dir()) / "anthropic_cache"

    def _ensure_cache_dir(self) -> None:
        """Stellt sicher, dass Cache-Verzeichnis existiert."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_cache_path(self) -> Path:
        """Pfad zur Cache-Datei."""
        return self.cache_dir / "models_cache.json"

    def _load_from_cache(self) -> list[str] | None:
        """Lädt Modellliste aus Cache falls nicht expired."""
        cache_path = self._get_cache_path()
        if not cache_path.exists():
            return None

        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            cached_at = data.get("cached_at", 0)
            if time.time() - cached_at > self.CACHE_DURATION_SECONDS:
                return None  # Cache expired

            return data.get("models", [])
        except (json.JSONDecodeError, IOError):
            return None

    def _save_to_cache(self, models: list[str]) -> None:
        """Speichert Modellliste im Cache."""
        cache_path = self._get_cache_path()
        data = {
            "models": models,
            "cached_at": time.time(),
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def list_models(self) -> list[str]:
        """
        Ruft Liste verfügbarer Anthropic-Modelle ab.

        Returns:
            Liste von Modell-IDs (z.B. ["claude-3-sonnet-20240229", ...])

        Notes:
            - Verwendet 24h-Cache um API-Calls zu minimieren
            - Fallback auf statische Liste bei API-Fehler
        """
        # Try cache first
        cached = self._load_from_cache()
        if cached:
            return cached

        # Fetch from API
        models = self._fetch_models_from_api()
        if models:
            self._save_to_cache(models)
            return models

        # Fallback to static list
        return self._get_static_fallback()

    def _fetch_models_from_api(self) -> list[str]:
        """Fetch models from Anthropic API."""
        if not self.api_key:
            return []

        try:
            import urllib.request

            req = urllib.request.Request(
                f"{self.API_BASE_URL}/models",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
            )

            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                return [model["id"] for model in data.get("data", [])]
        except Exception as e:
            print(f"[AnthropicClient] API fetch failed: {e}")
            return []

    def _get_static_fallback(self) -> list[str]:
        """Statische Fallback-Modellliste."""
        return [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307",
        ]

    def is_model_available(self, model_id: str) -> bool:
        """Prüft ob ein Modell verfügbar ist."""
        models = self.list_models()
        return model_id in models

    def clear_cache(self) -> None:
        """Löscht den Modell-Cache."""
        cache_path = self._get_cache_path()
        if cache_path.exists():
            cache_path.unlink()
