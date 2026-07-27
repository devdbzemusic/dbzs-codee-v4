from fastapi import APIRouter, Depends, HTTPException

from app.agents.models import AgentCreateRequest, AgentHealthInfo, AgentLogEntry, AgentRecord, AgentUpdateRequest
from app.agents.service import AgentRegistryService

router = APIRouter(prefix="/agents", tags=["agents"])

_agent_registry_service = AgentRegistryService()


def get_agent_registry_service() -> AgentRegistryService:
    return _agent_registry_service


@router.get("")
def list_agents(
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> list[AgentRecord]:
    return service.list_agents()


@router.get("/{agent_id}")
def get_agent(
    agent_id: str,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> AgentRecord:
    try:
        return service.get_agent(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("")
def create_agent(
    request: AgentCreateRequest,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> AgentRecord:
    try:
        return service.create_agent(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{agent_id}")
def update_agent(
    agent_id: str,
    request: AgentUpdateRequest,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> AgentRecord:
    try:
        return service.update_agent(agent_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{agent_id}/start")
def start_agent(
    agent_id: str,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> AgentRecord:
    try:
        return service.start_agent(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{agent_id}/stop")
def stop_agent(
    agent_id: str,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> AgentRecord:
    try:
        return service.stop_agent(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: str,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> dict[str, str]:
    try:
        service.delete_agent(agent_id)
        return {"status": "deleted", "agent_id": agent_id}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{agent_id}/logs")
def list_agent_logs(
    agent_id: str,
    limit: int = 100,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> list[AgentLogEntry]:
    try:
        return [AgentLogEntry.model_validate(item) for item in service.list_logs(agent_id, limit=limit)]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{agent_id}/health")
def get_agent_health(
    agent_id: str,
    service: AgentRegistryService = Depends(get_agent_registry_service),
) -> AgentHealthInfo:
    try:
        return service.get_agent_health(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
