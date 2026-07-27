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

from app.core.boot_state import BootComponentError, BootStateStore
from app.models.discovery_mode import get_model_discovery_mode
from app.models.index_service import ModelIndexService

logger = logging.getLogger(__name__)


def _counts(scanned: int, candidates: int, invalid: int, cached: int = 0) -> dict[str, object]:
    """Structured progress counts (repair spec §14)."""
    return {
        "scannedFileCount": scanned,
        "candidateCount": candidates,
        "validModelCount": max(0, scanned - invalid),
        "invalidModelCount": invalid,
        "cachedModelCount": cached,
    }


async def run_model_index_startup(store: BootStateStore, *, cache_only: bool = False) -> None:
    await store.set_component(
        "modelRegistry",
        "running",
        progress=0,
        total=0,
        message="Loading model index from cache..." if cache_only else "Scanning model catalog...",
        data=_counts(0, 0, 0),
    )

    errors: dict[str, dict[str, str]] = {}

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
                data=_counts(checked, total, len(errors)),
            ),
            loop,
        )

    def on_model_error(identifier: str, exc: Exception) -> None:
        errors[identifier] = {"path": identifier, "code": type(exc).__name__, "message": str(exc)}
        logger.warning("Model index: skipping unreadable model %s: %s", identifier, exc)

    loop = asyncio.get_running_loop()
    service = ModelIndexService(discovery_mode=get_model_discovery_mode())

    try:
        if cache_only:
            index = await asyncio.to_thread(service.load_cached_index)
            if index is None:
                await store.set_component(
                    "modelRegistry",
                    "success",
                    progress=0,
                    total=0,
                    message="Sicherer Modus: kein Modellindex-Cache vorhanden, leerer Index wird toleriert.",
                    data=_counts(0, 0, 0, 0),
                )
                return
        else:
            index = await asyncio.to_thread(
                service.build_index,
                on_progress=on_progress,
                on_model_error=on_model_error,
            )
    except Exception as exc:
        logger.error("Model index startup task failed: %s", exc)
        await store.set_component(
            "modelRegistry",
            "failed",
            message=str(exc),
            error=BootComponentError(code="model-index-failed", technical_detail=str(exc)),
            data=_counts(0, 0, 0),
        )
        return

    model_count = len(index.models)
    raw_metrics = getattr(getattr(service, "last_build_metrics", None), "as_dict", lambda: {})()
    metrics = raw_metrics if isinstance(raw_metrics, dict) and raw_metrics else _counts(model_count + len(errors), model_count + len(errors), len(errors))
    total_scanned = max(model_count + len(errors), int(metrics.get("scannedFileCount", 0)))
    if errors:
        message = f"Indexed {model_count} models ({len(errors)} skipped due to errors)"
        await store.set_component(
            "modelRegistry",
            "warning",
            progress=model_count,
            total=model_count,
            message=message,
            data={"modelErrors": list(errors.values()), **metrics},
        )
    else:
        await store.set_component(
            "modelRegistry",
            "success",
            progress=model_count,
            total=model_count,
            message=(
                f"Modellindex aus Cache geladen ({model_count} Modelle)"
                if cache_only
                else f"Indexed {model_count} models"
            ),
            data=metrics if metrics else _counts(model_count, model_count, 0),
        )
