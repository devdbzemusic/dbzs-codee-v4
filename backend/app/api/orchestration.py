from fastapi import APIRouter, Depends

from app.orchestration.models import (
    ContextPrepareRequest,
    ContextPrepareResponse,
    ToolCatalogResponse,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from app.orchestration.service import OrchestrationService

router = APIRouter(prefix="/orchestration", tags=["orchestration"])

_orchestration_service = OrchestrationService()


def get_orchestration_service() -> OrchestrationService:
    return _orchestration_service


@router.get("/tools")
def list_tool_capabilities(
    service: OrchestrationService = Depends(get_orchestration_service),
) -> ToolCatalogResponse:
    return service.list_tools()


@router.post("/context/prepare")
def prepare_orchestration_context(
    request: ContextPrepareRequest,
    service: OrchestrationService = Depends(get_orchestration_service),
) -> ContextPrepareResponse:
    return service.prepare_context(request)


@router.post("/tools/execute")
def execute_orchestration_tool(
    request: ToolExecutionRequest,
    service: OrchestrationService = Depends(get_orchestration_service),
) -> ToolExecutionResponse:
    return service.execute_tool(request)
