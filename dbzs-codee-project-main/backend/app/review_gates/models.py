"""Review Gate models and schemas."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ReviewGateStatus = Literal["pending", "approved", "rejected", "modified"]
ReviewGateScopeStatus = Literal["scoped", "legacy_unscoped"]
RiskLevel = Literal["low", "medium", "high"]


@dataclass
class ProposedChange:
    """Ein einzelner Änderungsvorschlag."""
    file_path: str
    old_content: str
    new_content: str
    diff: str
    risk_level: RiskLevel = "medium"
    risk_factors: list[str] = field(default_factory=list)


@dataclass
class ReviewGate:
    """Review Gate für Agent-Patches."""
    id: str
    job_id: str
    step_number: int
    status: ReviewGateStatus
    created_at: str
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    review_comment: str | None = None
    auto_apply_timeout_seconds: int = 300
    proposed_changes: list[ProposedChange] = field(default_factory=list)
    run_id: str | None = None
    step_id: str | None = None
    workspace_root: str | None = None
    workspace_id: str | None = None
    scope_status: ReviewGateScopeStatus = "legacy_unscoped"


@dataclass
class ReviewGateCreateRequest:
    """Request für Review-Gate-Erstellung."""
    job_id: str
    step_number: int
    proposed_changes: list[dict]  # ProposedChange als dict
    auto_apply_timeout_seconds: int = 300
    run_id: str | None = None
    step_id: str | None = None
    workspace_root: str | None = None
    workspace_id: str | None = None


@dataclass
class ReviewGateApproveRequest:
    """Request für Review-Gate-Freigabe."""
    reviewed_by: str
    review_comment: str | None = None
    workspace_id: str | None = None


@dataclass
class ReviewGateRejectRequest:
    """Request für Review-Gate-Ablehnung."""
    reviewed_by: str
    rejection_reason: str
    workspace_id: str | None = None
