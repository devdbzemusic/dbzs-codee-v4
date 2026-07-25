import os
import time

from fastapi import APIRouter

from app.core.boot_state import get_boot_state_store
from app.core.config import APP_NAME, APP_VERSION

router = APIRouter(tags=["health"])

_process_start_time = time.time()


@router.get("/health")
def get_health() -> dict[str, str]:
    return {
        "status": "ok",
        "app": APP_NAME,
        "version": APP_VERSION,
    }


@router.get("/health/live")
def get_health_live() -> dict[str, object]:
    """Process is up and can accept HTTP requests. No DB/service access —
    must answer within milliseconds even while startup tasks are still
    running, so the desktop boot orchestrator can treat this as the
    "backend process is alive" signal (boot phase 6)."""
    return {
        "status": "ok",
        "pid": os.getpid(),
        "uptimeMs": int((time.time() - _process_start_time) * 1000),
    }


@router.get("/health/ready")
async def get_health_ready() -> dict[str, object]:
    """Structured, multi-component readiness (boot phases 7-11). `ready`
    is true once database/modelRegistry/runtimeManager all succeeded;
    a failed/skipped residentModel alone degrades `status` without
    blocking `ready`, since the resident model is an optional boot phase."""
    return get_boot_state_store().snapshot()
