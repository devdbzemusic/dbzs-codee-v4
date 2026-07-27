from fastapi import APIRouter, Depends

from app.agent_runner.models import AgentRunOnceRequest, AgentRunResult, AgentRunnerStatus
from app.agent_runner.service import AgentRunnerService
from app.runtime.cloud_client import CloudRuntimeClient

router = APIRouter(prefix="/agent-runner", tags=["agent-runner"])

_runner: AgentRunnerService | None = None
_cloud_client = CloudRuntimeClient()


def get_runner() -> AgentRunnerService:
    global _runner
    if _runner is None:
        from app.api.runtime import get_runtime_service

        _runner = AgentRunnerService(
            runtime_service=get_runtime_service(),
            cloud_client=_cloud_client,
        )
    return _runner


@router.get("/status", response_model=AgentRunnerStatus)
def get_status(runner: AgentRunnerService = Depends(get_runner)) -> AgentRunnerStatus:
    return runner.status


@router.post("/run-once", response_model=AgentRunResult)
def run_once(
    request: AgentRunOnceRequest,
    runner: AgentRunnerService = Depends(get_runner),
) -> AgentRunResult:
    return runner.run_once(
        agent_id=request.agent_id,
        workspace_root=request.workspace_root,
        roles=request.supported_roles,
    )
