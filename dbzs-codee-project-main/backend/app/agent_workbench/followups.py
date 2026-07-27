"""Follow-up messages and plan revision."""

from __future__ import annotations

from app.agent_workbench.models import AgentFollowUp, FollowUpRequest, PlanStepInput
from app.agent_workbench.planner import generate_plan_from_goal
from app.agent_workbench.repository import AgentWorkbenchRepository


class FollowUpService:
    """Process user follow-ups and revise plans."""

    def __init__(self, repo: AgentWorkbenchRepository) -> None:
        self._repo = repo

    def create_followup(self, run_id: str, request: FollowUpRequest) -> AgentFollowUp:
        followup = AgentFollowUp(
            id=self._repo.make_followup_id(),
            run_id=run_id,
            text=request.text,
            status="pending",
            created_at=self._repo.now(),
        )
        return self._repo.insert_followup(followup)

    def apply_followup(
        self,
        followup_id: str,
        *,
        revised_steps: list[PlanStepInput] | None = None,
        goal: str | None = None,
    ) -> tuple[AgentFollowUp, list[PlanStepInput]]:
        followup = self._repo.get_followup(followup_id)
        if followup is None:
            raise ValueError(f"Follow-up {followup_id} nicht gefunden")
        if followup.status == "applied":
            return followup, revised_steps or []

        steps = revised_steps
        if steps is None and goal:
            combined_goal = f"{goal}\n\nFollow-up: {followup.text}"
            steps = generate_plan_from_goal(combined_goal)

        now = self._repo.now()
        self._repo.update_followup(
            followup_id,
            "applied",
            processed_at=now,
            effect_summary=f"Plan revised with {len(steps or [])} steps",
        )
        followup.status = "applied"
        followup.processed_at = now
        return followup, steps or []

    def reject_followup(self, followup_id: str, reason: str = "") -> AgentFollowUp:
        followup = self._repo.get_followup(followup_id)
        if followup is None:
            raise ValueError(f"Follow-up {followup_id} nicht gefunden")
        now = self._repo.now()
        self._repo.update_followup(
            followup_id,
            "rejected",
            processed_at=now,
            effect_summary=reason or "Rejected",
        )
        followup.status = "rejected"
        return followup

    def list_for_run(self, run_id: str) -> list[AgentFollowUp]:
        return self._repo.list_followups_for_run(run_id)

    def get_followup(self, followup_id: str) -> AgentFollowUp | None:
        return self._repo.get_followup(followup_id)
