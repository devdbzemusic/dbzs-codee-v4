"""Boot-time model index warmup (boot phase 9).

Runs ModelIndexService.build_index() as a tracked background task instead
of the lazy per-request path GET /models/index still uses (that endpoint
is unchanged — this is an additive first-run warmup so /health/ready can
report real progress instead of the model index being invisible to boot).
Must not block GET /health/ready itself: the caller schedules this via
asyncio.create_task, never awaits it inline.
"""

from __future__ import annotations

import asyncio
import logging

from app.core.boot_state import BootStateStore
from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService

logger = logging.getLogger(__name__)


async def run_model_index_startup(store: BootStateStore) -> None:
    await store.set_component("modelRegistry", "running", progress=0, total=0, message="Scanning model catalog...")

    errors: dict[str, str] = {}

    def on_progress(checked: int, total: int) -> None:
        # Called synchronously from the worker thread inside build_index();
        # scheduling the async update onto the loop keeps this thread-safe.
        asyncio.run_coroutine_threadsafe(
            store.set_component(
                "modelRegistry",
                "running",
                progress=checked,
                total=total,
                message=f"Checked {checked}/{total} models",
            ),
            loop,
        )

    def on_model_error(identifier: str, exc: Exception) -> None:
        errors[identifier] = str(exc)
        logger.warning("Model index: skipping unreadable model %s: %s", identifier, exc)

    loop = asyncio.get_running_loop()
    service = ModelIndexService(discovery_mode=get_model_discovery_mode())

    try:
        index = await asyncio.to_thread(
            service.build_index,
            on_progress=on_progress,
            on_model_error=on_model_error,
        )
    except Exception as exc:
        logger.error("Model index startup task failed: %s", exc)
        await store.set_component("modelRegistry", "failed", message=str(exc), error=str(exc))
        return

    model_count = len(index.models)
    if errors:
        message = f"Indexed {model_count} models ({len(errors)} skipped due to errors)"
        await store.set_component(
            "modelRegistry",
            "warning",
            progress=model_count,
            total=model_count,
            message=message,
            error="; ".join(f"{k}: {v}" for k, v in errors.items()),
        )
    else:
        await store.set_component(
            "modelRegistry",
            "success",
            progress=model_count,
            total=model_count,
            message=f"Indexed {model_count} models",
        )
