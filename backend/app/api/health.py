import os
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

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
    """Process is up and can accept HTTP requests. No DB/service access,
    no boot-state read — must answer within milliseconds even while startup
    tasks are still running, so the desktop boot orchestrator can treat this
    as the "backend process is alive" signal, independent of readiness.

    Echoes back DBZS_BOOT_NONCE (set by the desktop process only when IT
    spawned this backend) so the caller can tell "the process I spawned" apart
    from "some other backend happens to be listening on this port"."""
    return {
        "status": "ok",
        "pid": os.getpid(),
        "uptimeMs": int((time.time() - _process_start_time) * 1000),
        "instanceId": get_boot_state_store().instance_id,
        "bootNonce": os.environ.get("DBZS_BOOT_NONCE"),
    }


@router.get("/health/startup")
def get_health_startup() -> dict[str, object]:
    """Structured, multi-component boot progress. Always answers 200 --
    this is a status report, not a readiness gate (that's /health/ready).
    The desktop boot orchestrator polls this while phases 7-11 are still
    in progress, to render per-component progress on the splash screen."""
    return get_boot_state_store().snapshot()


@router.get("/health/ready")
def get_health_ready() -> JSONResponse:
    """Final readiness gate. `ready` is true once database/modelRegistry/
    runtimeManager have all succeeded; a failed residentModel alone degrades
    `status` to "degraded" without blocking `ready`, since it's optional.
    Returns HTTP 503 (not 200) while not yet ready, so callers can't mistake
    a bare "the endpoint responded" for "the app is actually usable"."""
    summary = get_boot_state_store().readiness_summary()
    if not summary["ready"]:
        return JSONResponse(
            status_code=503,
            content={
                "status": summary["status"],
                "ready": False,
                "instanceId": summary["instanceId"],
            },
        )
    return JSONResponse(status_code=200, content=summary)
