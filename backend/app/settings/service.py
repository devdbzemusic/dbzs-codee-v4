from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import os

from app.core.config import get_app_data_dir, get_models_dir, get_win_runtimes_dir
from app.settings.migrations import migrate as migrate_settings_dict
from app.settings.models import AppSettings, SettingsRevisionConflict

SECRET_KEYS = ("openaiApiKey", "anthropicApiKey", "huggingfaceApiKey")

ORPHANED_SETTINGS = [
    "autoSave",
    "terminalShell",
    "agentExecutionEnabled",
    "runtimeChatUseBroker",
    "ollamaBaseUrl",
    "autoStartVisionRuntime",
    "autoStartReviewRuntime",
    "legacyStructuredMarkupParser",
]

HIDDEN_USER_TUNABLE = [
    "safeCommandConfirmation",
    "cloudModelsEnabled",
    "preferLocalModels",
    "localOnlyModels",
    "localOnly",
    "maxAutonomousSteps",
    "maxDebugRetries",
    "maxFailedTaskRetries",
    "modelDiscoveryMode",
    "contextSpoolerEnabled",
    "hybridRetrievalEnabled",
    "reasoningTraceEnabled",
    "tokenBudgetOutputReserveRatio",
    "tokenBudgetToolReserveRatio",
    "tokenBudgetSafetyReserveRatio",
    "conversationControlV2",
]


class SettingsService:
    def __init__(self, settings_path: Path | None = None) -> None:
        self.settings_path = settings_path or get_app_data_dir() / "settings.json"
        self._loaded_at: str | None = None

    def load(self) -> AppSettings:
        if not self.settings_path.exists():
            settings = AppSettings()
            saved = self.save(settings, bump_revision=False)
            self._loaded_at = datetime.now(timezone.utc).isoformat()
            return saved

        try:
            raw_text = self.settings_path.read_text(encoding="utf-8")
            raw = json.loads(raw_text)
        except (OSError, json.JSONDecodeError, UnicodeError):
            self._backup_corrupt()
            settings = AppSettings()
            saved = self.save(settings, bump_revision=False)
            self._loaded_at = datetime.now(timezone.utc).isoformat()
            return saved

        if not isinstance(raw, dict):
            self._backup_corrupt()
            settings = AppSettings()
            saved = self.save(settings, bump_revision=False)
            self._loaded_at = datetime.now(timezone.utc).isoformat()
            return saved

        from_version = raw.get("schemaVersion", 1) if isinstance(raw.get("schemaVersion"), int) else 1
        raw, migrated = migrate_settings_dict(raw)
        to_version = raw.get("schemaVersion", from_version)
        if migrated and to_version != from_version:
            # Only back up when an actual migration ran (schema content changed),
            # not for the trivial "schemaVersion field was entirely missing" case.
            self._backup_before_migration(from_version, to_version)

        try:
            settings = AppSettings.model_validate(raw)
        except Exception:
            self._backup_corrupt()
            settings = AppSettings()
            saved = self.save(settings, bump_revision=False)
            self._loaded_at = datetime.now(timezone.utc).isoformat()
            return saved

        if migrated:
            settings = self.save(settings, bump_revision=True)
        self._loaded_at = datetime.now(timezone.utc).isoformat()
        return settings

    def save(self, settings: AppSettings, *, bump_revision: bool = True) -> AppSettings:
        next_settings = settings.model_copy(deep=True)
        if bump_revision:
            next_settings.revision = int(next_settings.revision) + 1
        next_settings.updatedAt = datetime.now(timezone.utc).isoformat()
        if next_settings.schemaVersion < 1:
            next_settings.schemaVersion = 1

        validated = AppSettings.model_validate(next_settings.model_dump())
        self._atomic_write(validated)
        reloaded = AppSettings.model_validate(
            json.loads(self.settings_path.read_text(encoding="utf-8"))
        )
        self._loaded_at = datetime.now(timezone.utc).isoformat()
        return reloaded

    def patch(self, base_revision: int, changes: dict) -> tuple[AppSettings, list[str]]:
        current = self.load()
        if int(base_revision) != int(current.revision):
            raise SettingsRevisionConflict(SettingsRevisionConflict.code)

        known = set(AppSettings.model_fields.keys())
        blocked = {"schemaVersion", "revision", "updatedAt"}
        filtered = {
            key: value
            for key, value in changes.items()
            if key in known and key not in blocked
        }
        applied_keys = list(filtered.keys())
        merged = {**current.model_dump(), **filtered}
        next_settings = AppSettings.model_validate(merged)
        saved = self.save(next_settings, bump_revision=True)
        return saved, applied_keys

    def diagnostics(self) -> dict:
        settings = self.load()
        dump = settings.model_dump()
        for key in SECRET_KEYS:
            if key in dump and dump[key]:
                dump[key] = "***"

        models_env = os.getenv("DBZS_MODELS_DIR")
        app_data_env = os.getenv("DBZS_APP_DATA_DIR")
        openai_settings = bool(str(settings.openaiApiKey or "").strip())
        anthropic_settings = bool(str(settings.anthropicApiKey or "").strip())
        openai_env = bool(str(os.getenv("OPENAI_API_KEY") or "").strip())
        anthropic_env = bool(str(os.getenv("ANTHROPIC_API_KEY") or "").strip())

        def _secret_source(from_settings: bool, from_env: bool) -> str:
            # Matches cloud_client: settings value wins when non-empty.
            if from_settings:
                return "settings_file"
            if from_env:
                return "environment"
            return "default"

        return {
            "schemaVersion": settings.schemaVersion,
            "revision": settings.revision,
            "settingsPath": str(self.settings_path),
            "appDataDir": str(get_app_data_dir()),
            "modelsDir": str(get_models_dir()),
            "loadedAt": self._loaded_at or datetime.now(timezone.utc).isoformat(),
            "lastSavedAt": settings.updatedAt,
            "validationErrors": [],
            "orphanedSettings": list(ORPHANED_SETTINGS),
            "hiddenUserTunableSettings": list(HIDDEN_USER_TUNABLE),
            "hardcodedRuntimeValues": [
                {
                    "key": "defaultOllamaDir",
                    "value": "G:/Ollama",
                    "path": "backend/app/core/config.py",
                    "classification": "B",
                },
                {
                    "key": "defaultWinRuntimesDir",
                    "value": "D:/win_runtimes",
                    "path": "backend/app/core/config.py",
                    "classification": "A",
                    "note": "Override via DBZS_WIN_RUNTIMES_DIR; llama-server searched recursively",
                },
                {
                    "key": "slotPorts",
                    "value": {
                        "quality_cpu": 8081,
                        "fast_gpu": 8082,
                        "utility": 8083,
                        "orchestrator_cpu": 8084,
                    },
                    "path": "packages/shared/runtime-slots.json",
                    "classification": "B",
                },
            ],
            "effectiveSources": {
                "modelsPath": "environment" if models_env else "settings_file",
                "appDataDir": "environment" if app_data_env else "default",
                "openaiApiKey": _secret_source(openai_settings, openai_env),
                "anthropicApiKey": _secret_source(anthropic_settings, anthropic_env),
                "winRuntimesDir": (
                    "environment"
                    if os.getenv("DBZS_WIN_RUNTIMES_DIR")
                    else "default"
                ),
            },
            "settingsRedacted": dump,
            "winRuntimesDir": str(get_win_runtimes_dir()),
        }

    def _atomic_write(self, settings: AppSettings) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.settings_path.with_name(self.settings_path.name + ".tmp")
        payload = settings.model_dump_json(indent=2)
        with tmp_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            try:
                os.fsync(handle.fileno())
            except OSError:
                pass
        os.replace(tmp_path, self.settings_path)

    def _backup_corrupt(self) -> None:
        if not self.settings_path.exists():
            return
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = self.settings_path.with_name(f"settings.json.corrupt.{stamp}")
        try:
            os.replace(self.settings_path, backup)
        except OSError:
            try:
                backup.write_bytes(self.settings_path.read_bytes())
            except OSError:
                pass

    def _backup_before_migration(self, from_version: int, to_version: int) -> None:
        """Copies the pre-migration settings.json aside — best-effort, must
        never block loading (a missing backup is much less bad than a user
        stuck unable to start the app because a migration backup failed)."""
        if not self.settings_path.exists():
            return
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = self.settings_path.with_name(
            f"settings.json.pre-migration-v{from_version}-to-v{to_version}.{stamp}"
        )
        try:
            backup.write_bytes(self.settings_path.read_bytes())
        except OSError:
            pass


def get_settings_service() -> SettingsService:
    return SettingsService()
