"""Agent Workbench API routes."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.agent_workbench.event_stream import router as sse_router
from app.agent_workbench.models import (
    AcceptWorkspaceChangesRequest,
    CreateRunRequest,
    FollowUpRequest,
    HostActionClaimRequest,
    HostActionCompleteRequest,
    HostActionFailRequest,
    PauseRunRequest,
    PlanStepInput,
    ProposeFileChangeRequest,
    SetPlanRequest,
)
from app.agent_workbench.service import AgentWorkbenchService, get_agent_workbench_service
from app.agent_workbench.state_machine import InvalidTransitionError

router = APIRouter(prefix="/agent-workbench", tags=["agent-workbench"])

_idempotency_cache: dict[str, Any] = {}


def _svc() -> AgentWorkbenchService:
    return get_agent_workbench_service()


class CreateRunBody(BaseModel):
    workspace_root: str
    goal: str
    workspace_name: str = ""
    execution_mode: str = "supervised"
    provider: str = "local"
    model_id: str = "default"
    max_steps: int = 20
    job_id: str | None = None


class PlanStepBody(BaseModel):
    title: str
    description: str = ""
    role: str = "general"
    depends_on: list[str] = Field(default_factory=list)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    max_attempts: int = 3


class SetPlanBody(BaseModel):
    steps: list[PlanStepBody]
    auto_start: bool = False


class PauseBody(BaseModel):
    reason: str = "user_requested"


class FollowUpBody(BaseModel):
    text: str


class ProposeChangeBody(BaseModel):
    file_path: str
    operation: str
    summary: str
    proposed_content: str = ""
    expected_before_hash: str | None = None


class HostCompleteBody(BaseModel):
    result: dict[str, Any] = Field(default_factory=dict)
    executor_id: str = "desktop-primary"


class HostFailBody(BaseModel):
    error_message: str
    executor_id: str = "desktop-primary"


class HostClaimBody(BaseModel):
    executor_id: str = "desktop-primary"


class AcceptWorkspaceChangesBody(BaseModel):
    expected_changed_files: list[str] | None = None


def _run_dict(run: Any) -> dict[str, Any]:
    return {
        "id": run.id,
        "job_id": run.job_id,
        "workspace_root": run.workspace_root,
        "workspace_name": run.workspace_name,
        "goal": run.goal,
        "status": run.status,
        "execution_mode": run.execution_mode,
        "provider": run.provider,
        "model_id": run.model_id,
        "current_step_id": run.current_step_id,
        "max_steps": run.max_steps,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "pause_reason": run.pause_reason,
        "error_message": run.error_message,
        "execution_backend": run.execution_backend,
        "runtime_provider": run.runtime_provider,
        "runtime_model_id": run.runtime_model_id,
        "runtime_model_name": run.runtime_model_name,
        "runtime_endpoint": run.runtime_endpoint,
        "runtime_pid": run.runtime_pid,
        "runtime_health_state": run.runtime_health_state,
        "runtime_verified_at": run.runtime_verified_at,
    }


def _step_dict(step: Any) -> dict[str, Any]:
    return {
        "id": step.id,
        "run_id": step.run_id,
        "ordinal": step.ordinal,
        "title": step.title,
        "description": step.description,
        "status": step.status,
        "role": step.role,
        "attempt_count": step.attempt_count,
        "max_attempts": step.max_attempts,
        "created_at": step.created_at,
        "started_at": step.started_at,
        "finished_at": step.finished_at,
        "error_message": step.error_message,
    }


def _event_dict(event: Any) -> dict[str, Any]:
    return {
        "sequence": event.sequence,
        "id": event.id,
        "run_id": event.run_id,
        "step_id": event.step_id,
        "event_type": event.event_type,
        "severity": event.severity,
        "summary": event.summary,
        "payload": json.loads(event.payload_json or "{}"),
        "created_at": event.created_at,
    }


def _host_action_dict(action: Any) -> dict[str, Any]:
    return {
        "id": action.id,
        "run_id": action.run_id,
        "step_id": action.step_id,
        "action_type": action.action_type,
        "status": action.status,
        "payload": json.loads(action.payload_json or "{}"),
        "result": json.loads(action.result_json or "{}") if action.result_json else None,
        "created_at": action.created_at,
        "claimed_at": action.claimed_at,
        "completed_at": action.completed_at,
        "error_message": action.error_message,
    }


def _handle_value_error(exc: ValueError) -> HTTPException:
    msg = str(exc)
    if msg in {"resume_baseline_not_required", "workspace_changes_not_required"}:
        return HTTPException(status_code=422, detail=msg)
    if ("409" in msg or "Hash" in msg or msg.startswith("workspace_changed:")
            or msg.startswith("resume_baseline_") or msg.startswith("migration_")
            or msg.startswith("workspace_changes_mismatch:")):
        return HTTPException(status_code=409, detail=msg)
    if "nicht gefunden" in msg:
        return HTTPException(status_code=404, detail=msg)
    return HTTPException(status_code=422, detail=msg)


@router.post("/runs")
def create_run(
    body: CreateRunBody,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if idempotency_key and idempotency_key in _idempotency_cache:
        return _idempotency_cache[idempotency_key]

    try:
        run = _svc().create_run(
            CreateRunRequest(
                workspace_root=body.workspace_root,
                goal=body.goal,
                workspace_name=body.workspace_name,
                execution_mode=body.execution_mode,  # type: ignore[arg-type]
                provider=body.provider,
                model_id=body.model_id,
                max_steps=body.max_steps,
                job_id=body.job_id,
            )
        )
        result = {"run": _run_dict(run)}
        if idempotency_key:
            _idempotency_cache[idempotency_key] = result
        return result
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.get("/runs")
def list_runs(limit: int = 50):
    runs = _svc().list_runs(limit=limit)
    return {"runs": [_run_dict(r) for r in runs]}


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    try:
        run = _svc().get_run(run_id)
        steps = _svc().list_steps(run_id)
        return {"run": _run_dict(run), "steps": [_step_dict(s) for s in steps]}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/plan")
def set_plan(run_id: str, body: SetPlanBody):
    steps = [
        PlanStepInput(
            title=s.title,
            description=s.description,
            role=s.role,  # type: ignore[arg-type]
            depends_on=s.depends_on,
            tool_policy=s.tool_policy,
            max_attempts=s.max_attempts,
        )
        for s in body.steps
    ]
    try:
        run, created_steps = _svc().set_plan(
            run_id,
            SetPlanRequest(steps=steps, auto_start=body.auto_start),
        )
        return {
            "run": _run_dict(run),
            "steps": [_step_dict(s) for s in created_steps],
        }
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.post("/runs/{run_id}/start")
def start_run(run_id: str):
    try:
        run = _svc().start_run(run_id)
        return {"run": _run_dict(run)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.post("/runs/{run_id}/pause")
def pause_run(run_id: str, body: PauseBody | None = None):
    try:
        run = _svc().pause_run(run_id, PauseRunRequest(reason=body.reason if body else "user_requested"))
        return {"run": _run_dict(run)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/resume")
def resume_run(run_id: str):
    try:
        run = _svc().resume_run(run_id)
        return {"run": _run_dict(run)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.post("/runs/{run_id}/accept-resume-baseline")
def accept_resume_baseline(run_id: str):
    try:
        return {"run": _run_dict(_svc().accept_resume_baseline(run_id))}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.get("/runs/{run_id}/workspace-changes")
def get_workspace_changes(run_id: str):
    try:
        return {"changed_files": _svc().get_workspace_changes(run_id)}
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.post("/runs/{run_id}/accept-workspace-changes")
def accept_workspace_changes(run_id: str, body: AcceptWorkspaceChangesBody | None = None):
    try:
        request = AcceptWorkspaceChangesRequest(
            expected_changed_files=body.expected_changed_files if body else None
        )
        return {"run": _run_dict(_svc().accept_workspace_changes(run_id, request))}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str):
    try:
        run = _svc().cancel_run(run_id)
        return {"run": _run_dict(run)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/followups")
def create_followup(run_id: str, body: FollowUpBody):
    try:
        followup = _svc().add_followup(run_id, FollowUpRequest(text=body.text))
        return {
            "followup": {
                "id": followup.id,
                "run_id": followup.run_id,
                "text": followup.text,
                "status": followup.status,
                "created_at": followup.created_at,
            }
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/followups/{followup_id}/apply")
def apply_followup(run_id: str, followup_id: str):
    try:
        run, steps = _svc().apply_followup_plan(run_id, followup_id)
        return {"run": _run_dict(run), "steps": [_step_dict(s) for s in steps]}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/events")
def list_events(run_id: str, after_sequence: int = 0):
    try:
        events = _svc().list_events(run_id, after_sequence=after_sequence)
        return {"events": [_event_dict(e) for e in events]}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/steps/{step_id}/file-changes")
def propose_file_change(run_id: str, step_id: str, body: ProposeChangeBody):
    try:
        change = _svc().propose_file_change(
            run_id,
            step_id,
            ProposeFileChangeRequest(
                file_path=body.file_path,
                operation=body.operation,  # type: ignore[arg-type]
                summary=body.summary,
                proposed_content=body.proposed_content,
                expected_before_hash=body.expected_before_hash,
            ),
        )
        return {
            "file_change": {
                "id": change.id,
                "file_path": change.file_path,
                "status": change.status,
                "review_gate_id": change.review_gate_id,
            }
        }
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.get("/host-actions/next")
def next_host_action(executor_id: str = "desktop-primary"):
    action = _svc().host_actions.next_pending(executor_id)
    if action is None:
        return {"action": None}
    return {
        "action": {
            "id": action.id,
            "run_id": action.run_id,
            "step_id": action.step_id,
            "action_type": action.action_type,
            "status": action.status,
            "payload": json.loads(action.payload_json or "{}"),
        }
    }


@router.post("/host-actions/{action_id}/claim")
def claim_host_action(action_id: str, body: HostClaimBody | None = None):
    executor_id = body.executor_id if body else "desktop-primary"
    try:
        action = _svc().host_actions.claim(action_id, executor_id)
        return {"action": _host_action_dict(action)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/host-actions/{action_id}/complete")
def complete_host_action(action_id: str, body: HostCompleteBody | None = None):
    try:
        action = _svc().complete_host_action(
            action_id,
            result=body.result if body else {},
            executor_id=body.executor_id if body else "desktop-primary",
        )
        return {"action": _host_action_dict(action)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise _handle_value_error(exc) from exc


@router.post("/host-actions/{action_id}/fail")
def fail_host_action(action_id: str, body: HostFailBody):
    try:
        action = _svc().host_actions.fail(
            action_id,
            error_message=body.error_message,
            executor_id=body.executor_id,
        )
        return {"action": _host_action_dict(action)}
    except InvalidTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


router.include_router(sse_router)
