from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.settings.models import AppSettings, SettingsPatchRequest, SettingsRevisionConflict
from app.settings.service import SettingsService, get_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def get_settings(
    service: SettingsService = Depends(get_settings_service),
) -> AppSettings:
    return service.load()


@router.put("")
def update_settings(
    settings: AppSettings,
    service: SettingsService = Depends(get_settings_service),
) -> AppSettings:
    current = service.load()
    incoming = settings.model_copy(deep=True)
    # Preserve revision counter from disk; save() bumps it.
    incoming.revision = current.revision
    incoming.schemaVersion = max(incoming.schemaVersion, current.schemaVersion, 1)
    return service.save(incoming, bump_revision=True)


@router.patch("")
def patch_settings(
    body: SettingsPatchRequest,
    service: SettingsService = Depends(get_settings_service),
) -> dict:
    try:
        saved, applied_keys = service.patch(body.baseRevision, body.changes)
    except SettingsRevisionConflict as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc

    restart_requirements: dict[str, str] = {}
    for key in applied_keys:
        if key in {"modelsPath", "modelDiscoveryMode", "autoStartOrchestratorRuntime"}:
            restart_requirements[key] = "backend_restart"
        elif key in {"backendUrl"}:
            restart_requirements[key] = "app_restart"
        elif key.startswith("autoStart") or key.endswith("RuntimePort"):
            restart_requirements[key] = "runtime_restart"
        elif key in {
            "idleUnloadWorkModelsMinutes",
            "theme",
            "editorFontSize",
            "reasoningDisplayMode",
            "stopDesktopRuntimesOnExit",
        }:
            restart_requirements[key] = "none"
        else:
            restart_requirements[key] = "next_run"

    return {
        "settings": saved,
        "revision": saved.revision,
        "appliedKeys": applied_keys,
        "restartRequirements": restart_requirements,
    }


@router.get("/diagnostics")
def get_settings_diagnostics(
    service: SettingsService = Depends(get_settings_service),
) -> dict:
    return service.diagnostics()
