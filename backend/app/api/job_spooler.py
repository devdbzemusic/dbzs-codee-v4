from fastapi import APIRouter, Depends, HTTPException, Query

from app.job_spooler.models import (
    JobArtifact,
    JobArtifactCreateRequest,
    JobClaimRequest,
    JobClaimResponse,
    JobCompleteRequest,
    JobDetail,
    JobEnqueueRequest,
    JobEvent,
    JobFailRequest,
    JobHeartbeatRequest,
    JobRecord,
    JobStatus,
    JobVerification,
    JobVerifyRequest,
    JobWaypointRequest,
)
from app.job_spooler.service import JobSpoolerService

router = APIRouter(prefix="/job-spooler", tags=["job-spooler"])

_job_spooler_service = JobSpoolerService()


def get_job_spooler_service() -> JobSpoolerService:
    return _job_spooler_service


@router.get("")
def list_jobs(
    status: JobStatus | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> list[JobRecord]:
    return service.list_jobs(status=status, limit=limit)


@router.post("/enqueue")
def enqueue_job(
    request: JobEnqueueRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobRecord:
    return service.enqueue_job(request)


@router.post("/claim")
def claim_next_job(
    request: JobClaimRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobClaimResponse:
    return JobClaimResponse(job=service.claim_next_job(request))


@router.post("/requeue-stale")
def requeue_stale_jobs(
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> dict[str, int]:
    return {"requeued": service.requeue_stale_jobs()}


@router.post("/clear-all")
def clear_all_jobs(
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> dict[str, int]:
    return {"deleted": service.clear_jobs(completed_and_failed_only=False)}


@router.post("/prune-finished")
def prune_finished_jobs(
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> dict[str, int]:
    return {"deleted": service.clear_jobs(completed_and_failed_only=True)}


@router.get("/{job_id}")
def get_job(
    job_id: str,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobRecord:
    try:
        return service.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{job_id}/detail")
def get_job_detail(
    job_id: str,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobDetail:
    try:
        return service.get_job_detail(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/heartbeat")
def heartbeat_job(
    job_id: str,
    request: JobHeartbeatRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobRecord:
    try:
        return service.heartbeat(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/waypoints")
def add_waypoint(
    job_id: str,
    request: JobWaypointRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobEvent:
    try:
        return service.add_waypoint(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{job_id}/artifacts")
def add_artifact(
    job_id: str,
    request: JobArtifactCreateRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobArtifact:
    try:
        return service.add_artifact(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/verify")
def verify_job(
    job_id: str,
    request: JobVerifyRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobVerification:
    try:
        return service.verify_job(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{job_id}/complete")
def complete_job(
    job_id: str,
    request: JobCompleteRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobRecord:
    try:
        return service.complete_job(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{job_id}/fail")
def fail_job(
    job_id: str,
    request: JobFailRequest,
    service: JobSpoolerService = Depends(get_job_spooler_service),
) -> JobRecord:
    try:
        return service.fail_job(job_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
