from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.download_service import DownloadTask, get_download_service

router = APIRouter(prefix="/models", tags=["models"])


class StartDownloadRequest(BaseModel):
    repo_id: str
    filename: str
    dest_dir: str


@router.post("/download")
def start_download(req: StartDownloadRequest) -> DownloadTask:
    svc = get_download_service()
    if not req.repo_id.strip() or not req.filename.strip() or not req.dest_dir.strip():
        raise HTTPException(status_code=400, detail="repo_id, filename und dest_dir sind erforderlich.")
    return svc.start_download(req.repo_id.strip(), req.filename.strip(), req.dest_dir.strip())


@router.get("/download")
def list_downloads() -> list[DownloadTask]:
    return get_download_service().list_tasks()


@router.get("/download/{task_id}/status")
def get_download_status(task_id: str) -> DownloadTask:
    task = get_download_service().get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Download-Task nicht gefunden.")
    return task
