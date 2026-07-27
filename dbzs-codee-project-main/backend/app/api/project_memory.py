from fastapi import APIRouter, Depends, HTTPException, Query

from app.project_memory.models import ProjectMemoryEntry, ProjectMemoryUpsertRequest
from app.project_memory.service import ProjectMemoryService

router = APIRouter(prefix="/project-memory", tags=["project-memory"])

_project_memory_service = ProjectMemoryService()


def get_project_memory_service() -> ProjectMemoryService:
    return _project_memory_service


@router.get("")
def list_project_memory(
    workspace: str = Query(min_length=1),
    service: ProjectMemoryService = Depends(get_project_memory_service),
) -> list[ProjectMemoryEntry]:
    return service.list_entries(workspace)


@router.put("")
def upsert_project_memory(
    request: ProjectMemoryUpsertRequest,
    service: ProjectMemoryService = Depends(get_project_memory_service),
) -> ProjectMemoryEntry:
    return service.upsert_entry(request)


@router.delete("/{entry_id}")
def delete_project_memory(
    entry_id: int,
    service: ProjectMemoryService = Depends(get_project_memory_service),
) -> dict[str, str | int]:
    deleted = service.delete_entry(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown memory entry: {entry_id}")
    return {"status": "deleted", "id": entry_id}
