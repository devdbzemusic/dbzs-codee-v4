from fastapi import APIRouter, Depends, HTTPException

from app.task_board.models import TaskBoardItem, TaskCreateRequest, TaskJobLinkRequest, TaskUpdateRequest
from app.task_board.service import TaskBoardService

router = APIRouter(prefix="/task-board", tags=["task-board"])

_task_board_service = TaskBoardService()


def get_task_board_service() -> TaskBoardService:
    return _task_board_service


@router.get("")
def list_tasks(service: TaskBoardService = Depends(get_task_board_service)) -> list[TaskBoardItem]:
    return service.list_tasks()


@router.post("")
def create_task(
    request: TaskCreateRequest,
    service: TaskBoardService = Depends(get_task_board_service),
) -> TaskBoardItem:
    return service.create_task(request)


@router.put("/{task_id}")
def update_task(
    task_id: str,
    request: TaskUpdateRequest,
    service: TaskBoardService = Depends(get_task_board_service),
) -> TaskBoardItem:
    try:
        return service.update_task(task_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{task_id}")
def delete_task(
    task_id: str,
    service: TaskBoardService = Depends(get_task_board_service),
) -> dict[str, str]:
    deleted = service.delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown task: {task_id}")
    return {"status": "deleted"}


@router.post("/{task_id}/link-job")
def link_job_to_task(
    task_id: str,
    request: TaskJobLinkRequest,
    service: TaskBoardService = Depends(get_task_board_service),
) -> TaskBoardItem:
    try:
        return service.link_job(task_id, request.job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{task_id}/link-job/{job_id}")
def unlink_job_from_task(
    task_id: str,
    job_id: str,
    service: TaskBoardService = Depends(get_task_board_service),
) -> TaskBoardItem:
    try:
        return service.unlink_job(task_id, job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
