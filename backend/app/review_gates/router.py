"""Review Gates API Router."""

from fastapi import APIRouter, HTTPException
from typing import Literal

from app.review_gates.service import ReviewGateScopeError, ReviewGateService
from app.review_gates.models import (
    ReviewGateCreateRequest,
    ReviewGateApproveRequest,
    ReviewGateRejectRequest,
)


router = APIRouter(prefix="/review-gates", tags=["review-gates"])
_service = ReviewGateService()


@router.get("/pending")
def list_pending_gates(job_id: str | None = None, workspace_id: str | None = None):
    """Listet alle offenen Review-Gates."""
    gates = _service.list_pending_gates(job_id=job_id, workspace_id=workspace_id)
    return {
        "gates": [
            {
                "id": g.id,
                "job_id": g.job_id,
                "step_number": g.step_number,
                "status": g.status,
                "created_at": g.created_at,
                "workspace_root": g.workspace_root,
                "workspace_id": g.workspace_id,
                "run_id": g.run_id,
                "scope_status": g.scope_status,
                "proposed_changes_count": len(g.proposed_changes),
                "proposed_changes": [
                    {
                        "file_path": change.file_path,
                        "risk_level": change.risk_level,
                        "risk_factors": change.risk_factors,
                        "diff": change.diff,
                    }
                    for change in g.proposed_changes
                ],
            }
            for g in gates
        ]
    }


@router.get("/{gate_id}")
def get_gate(gate_id: str):
    """Ruft Review-Gate Details ab."""
    try:
        gate = _service.get_gate(gate_id)
        return {
            "gate": {
                "id": gate.id,
                "job_id": gate.job_id,
                "step_number": gate.step_number,
                "status": gate.status,
                "created_at": gate.created_at,
                "reviewed_at": gate.reviewed_at,
                "reviewed_by": gate.reviewed_by,
                "review_comment": gate.review_comment,
                "auto_apply_timeout_seconds": gate.auto_apply_timeout_seconds,
                "proposed_changes": [
                    {
                        "file_path": c.file_path,
                        "risk_level": c.risk_level,
                        "risk_factors": c.risk_factors,
                        "diff": c.diff,
                    }
                    for c in gate.proposed_changes
                ],
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{gate_id}/approve")
def approve_gate(gate_id: str, request: ReviewGateApproveRequest):
    """Genehmigt Review-Gate."""
    try:
        gate = _service.approve_gate(gate_id, request)
        return {"gate": {"id": gate.id, "status": gate.status}}
    except ReviewGateScopeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{gate_id}/reject")
def reject_gate(gate_id: str, request: ReviewGateRejectRequest):
    """Lehnt Review-Gate ab."""
    try:
        gate = _service.reject_gate(gate_id, request)
        return {"gate": {"id": gate.id, "status": gate.status}}
    except ReviewGateScopeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{gate_id}")
def delete_gate(gate_id: str):
    """Löscht Review-Gate."""
    _service.delete_gate(gate_id)
    return {"deleted": True}


@router.get("/{gate_id}/auto-apply")
def check_auto_apply(gate_id: str):
    """Prüft ob Auto-Apply-Timeout abgelaufen ist."""
    try:
        should_apply = _service.check_auto_apply(gate_id)
        return {"should_auto_apply": should_apply}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
