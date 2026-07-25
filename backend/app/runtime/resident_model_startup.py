"""Boot-time resident/base-model autostart (boot phase 11, optional).

Adapted from the former `_autostart_orchestrator_runtime()` in app/main.py,
which only logged and was invoked post-hoc from the Electron side after the
desktop app's own health poll resolved "ready" (main.ts maybeAutostart-
OrchestratorRuntime()). That call site is removed: this task is now
backend-driven and writes real state transitions (starting -> loading ->
warming -> ready|failed) into BootStateStore, including stderr and the
resolved model id, so a failure is never surfaced to the user as a bare
"Failed to fetch". Failure here degrades the boot (component stays
"failed"/"skipped") but does not block GET /health/ready's overall
`ready: true`, per this phase being optional.
"""

from __future__ import annotations

import logging

from app.core.boot_state import BootStateStore

logger = logging.getLogger(__name__)


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

    await store.set_component("residentModel", "starting", message="Resolving resident model...")

    model_index_service = ModelIndexService(discovery_mode=get_model_discovery_mode())
    model_id = settings.defaultOrchestratorModelId or None
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
        await store.set_component("residentModel", "failed", message=str(exc), error=str(exc))
        return

    service = get_runtime_service()
    attempted: list[str] = []
    fallback_pool = [c for c in candidates if c != model_id]

    for attempt_model_id in [model_id, *fallback_pool]:
        attempted.append(attempt_model_id)
        state_label = "starting" if attempt_model_id == model_id else "retrying"
        await store.set_component(
            "residentModel", state_label, message=f"Loading resident model {attempt_model_id}..."
        )
        try:
            status = service.start_model(attempt_model_id, slot_id="orchestrator_cpu")
        except Exception as exc:
            logger.error("Resident model autostart raised for %s: %s", attempt_model_id, exc)
            continue

        if status.state == "running":
            note = "" if attempt_model_id == model_id else " (fallback model)"
            await store.set_component(
                "residentModel",
                "success",
                message=f"Resident model ready: {attempt_model_id}{note}",
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
        error=last_status_message,
    )
