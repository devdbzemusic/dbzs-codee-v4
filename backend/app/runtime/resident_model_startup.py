"""Boot-time resident/base-model autostart (boot phase 10, optional).

Adapted from the former `_autostart_orchestrator_runtime()` in app/main.py,
which only logged and was invoked post-hoc from the Electron side after the
desktop app's own health poll resolved "ready" (main.ts maybeAutostart-
OrchestratorRuntime()). That call site is removed: this task is now
backend-driven and writes real state transitions into BootStateStore,
including stderr and the resolved model id, so a failure is never surfaced
to the user as a bare "Failed to fetch". Failure here degrades the boot
(component stays "failed"/"skipped") but does not block GET /health/ready's
overall `ready: true` on its own, per this phase being optional -- though
the new (post-repair) "backend-ready" phase does wait for it to reach some
terminal state first (see bootPhaseDefinitions.ts).
"""

from __future__ import annotations

import logging

from app.api.health_contracts import ResidentModelDataModel
from app.core.boot_state import BootComponentError, BootStateStore

logger = logging.getLogger(__name__)


def _resident_model_data(model_id: str, status) -> dict[str, object]:
    return ResidentModelDataModel(
        modelId=model_id,
        modelName=status.model_name,
        slotId=status.slot_id or "orchestrator_cpu",
        provider=status.provider,
        pid=status.pid,
        port=status.port,
    ).model_dump()


async def run_resident_model_startup(store: BootStateStore) -> None:
    from app.api.runtime import get_runtime_service
    from app.models.discovery_mode import get_model_discovery_mode
    from app.models.index_service import FUNCTIONGEMMA_DEFAULT_PROFILE, ModelIndexService
    from app.settings.service import SettingsService

    try:
        settings = SettingsService().load()
    except Exception as exc:
        await store.set_component("residentModel", "skipped", message=f"Settings unavailable: {exc}")
        return

    if not settings.autoStartOrchestratorRuntime:
        await store.set_component("residentModel", "skipped", message="Autostart disabled in settings.")
        return

    await store.set_component("residentModel", "running", message="Resolving resident model...")

    model_index_service = ModelIndexService(discovery_mode=get_model_discovery_mode())
    model_id = settings.defaultOrchestratorModelId or None
    had_explicit_default = model_id is not None
    candidates: list[str] = []

    try:
        if not model_id:
            try:
                model_index_service.register_catalog_model_profile(FUNCTIONGEMMA_DEFAULT_PROFILE)
            except Exception as exc:
                logger.warning("Orchestrator catalog auto-registration failed: %s", exc)

            index = model_index_service.build_index()
            candidates = [m.id for m in index.models if m.role == "ORCHESTRATOR_MODEL"]
            model_id = candidates[0] if len(candidates) == 1 else None
            if len(candidates) > 1:
                # Multiple same-role candidates exist but none is configured as
                # the default — never silently guess which one to load.
                await store.set_component(
                    "residentModel",
                    "skipped",
                    message=f"{len(candidates)} orchestrator-role models found, none configured as default.",
                )
                return

        if not model_id:
            await store.set_component(
                "residentModel", "skipped", message="No orchestrator model resolved — nothing to autostart."
            )
            return
    except Exception as exc:
        await store.set_component(
            "residentModel",
            "failed",
            message=str(exc),
            error=BootComponentError(code="resident-model-resolve-failed", technical_detail=str(exc)),
        )
        return

    service = get_runtime_service()
    attempted: list[str] = []
    fallback_pool = [c for c in candidates if c != model_id]

    for attempt_model_id in [model_id, *fallback_pool]:
        attempted.append(attempt_model_id)
        is_fallback_attempt = attempt_model_id != model_id
        await store.set_component(
            "residentModel", "running", message=f"Loading resident model {attempt_model_id}..."
        )
        try:
            status = service.start_model(attempt_model_id, slot_id="orchestrator_cpu")
        except Exception as exc:
            logger.error("Resident model autostart raised for %s: %s", attempt_model_id, exc)
            continue

        if status.state == "running":
            data = _resident_model_data(attempt_model_id, status)
            if is_fallback_attempt:
                await store.set_component(
                    "residentModel",
                    "warning",
                    message=f"Resident model ready via fallback: {attempt_model_id} (primary model unavailable).",
                    data=data,
                )
            else:
                await store.set_component(
                    "residentModel", "success", message=f"Resident model ready: {attempt_model_id}", data=data
                )
            return

        logger.warning(
            "Resident model autostart did not reach 'running' for %s (state=%s): %s",
            attempt_model_id,
            status.state,
            status.message,
        )

    # The configured default (had_explicit_default) never had its
    # alternatives scanned above -- that scan is deferred to here, only once
    # actually needed, so the common case (the configured default just
    # works) never pays for an extra catalog scan.
    if had_explicit_default:
        try:
            index = model_index_service.build_index()
            extra_candidates = [m.id for m in index.models if m.role == "ORCHESTRATOR_MODEL" and m.id not in attempted]
        except Exception as exc:
            logger.warning("Fallback candidate scan failed: %s", exc)
            extra_candidates = []

        for attempt_model_id in extra_candidates:
            attempted.append(attempt_model_id)
            await store.set_component(
                "residentModel", "running", message=f"Loading resident model {attempt_model_id}..."
            )
            try:
                status = service.start_model(attempt_model_id, slot_id="orchestrator_cpu")
            except Exception as exc:
                logger.error("Resident model autostart raised for %s: %s", attempt_model_id, exc)
                continue

            if status.state == "running":
                data = _resident_model_data(attempt_model_id, status)
                await store.set_component(
                    "residentModel",
                    "warning",
                    message=f"Resident model ready via fallback: {attempt_model_id} (primary model unavailable).",
                    data=data,
                )
                return

            logger.warning(
                "Resident model autostart did not reach 'running' for %s (state=%s): %s",
                attempt_model_id,
                status.state,
                status.message,
            )

    # All attempts (primary + fallback candidates) failed.
    last_status_message = "; ".join(attempted)
    await store.set_component(
        "residentModel",
        "failed",
        message=f"No resident model could be started. Tried: {last_status_message}",
        error=BootComponentError(code="resident-model-start-failed", technical_detail=last_status_message),
    )
