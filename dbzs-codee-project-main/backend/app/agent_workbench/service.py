"""Agent Workbench business logic."""

from __future__ import annotations

from pathlib import Path
from dataclasses import replace
from typing import Any

from app.agent_workbench.events import EventService
from app.agent_workbench.file_changes import FileChangeService
from app.agent_workbench.followups import FollowUpService
from app.agent_workbench.host_actions import HostActionService
from app.agent_workbench.models import (
    AcceptWorkspaceChangesRequest,
    AgentEvent,
    AgentRun,
    AgentStep,
    CreateRunRequest,
    FollowUpRequest,
    PauseRunRequest,
    PlanStepInput,
    ProposeFileChangeRequest,
    SetPlanRequest,
)
from app.agent_workbench.planner import generate_plan_from_goal
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.state_machine import InvalidTransitionError, validate_run_transition, validate_step_transition
from app.agent_workbench.tools import AgentToolRuntime
from app.agent_workbench.task_manifest import TaskManifestStore


class AgentWorkbenchService:
    """Core service for agent run lifecycle."""

    def __init__(
        self,
        db_path: str | None = None,
        *,
        simulate_llm: bool = False,
        auto_start_worker: bool = True,
        runtime_service: Any | None = None,
    ) -> None:
        self._repo = AgentWorkbenchRepository(db_path=db_path)
        self._events = EventService(self._repo)
        self._host_actions = HostActionService(self._repo)
        self._file_changes = FileChangeService(self._repo)
        self._followups = FollowUpService(self._repo)
        self._tools = AgentToolRuntime(self._repo, simulate_llm=simulate_llm)
        self._manifests = TaskManifestStore()
        self._simulate_llm = simulate_llm
        self._auto_start_worker = auto_start_worker
        self._worker = None

        # Build runtime adapter
        if runtime_service is None:
            from app.runtime.service import RuntimeService
            # In production, we'll try to use the global runtime service or instantiate a default one
            try:
                # Assuming models_dir relative to current structure, or customized
                base_dir = Path(__file__).resolve().parent.parent.parent
                models_dir = base_dir / "models"
                runtime_service = RuntimeService(models_dir=models_dir)
            except Exception:
                runtime_service = None

        if runtime_service is not None:
            from app.agent_workbench.runtime_adapter import DefaultAgentRuntimeAdapter
            self._runtime_adapter = DefaultAgentRuntimeAdapter(runtime_service, self._repo)
        else:
            self._runtime_adapter = None

        self.recover_on_startup()
        if auto_start_worker:
            self._ensure_worker()

    @property
    def runtime_adapter(self) -> Any | None:
        """The bound runtime adapter for LLM/Agent loops."""
        return self._runtime_adapter

    @property
    def repo(self) -> AgentWorkbenchRepository:
        return self._repo

    @property
    def host_actions(self) -> HostActionService:
        return self._host_actions

    @property
    def file_changes(self) -> FileChangeService:
        return self._file_changes

    @property
    def followups(self) -> FollowUpService:
        return self._followups

    @property
    def tools(self) -> AgentToolRuntime:
        return self._tools

    def _ensure_worker(self) -> None:
        if not self._auto_start_worker:
            return
        from app.agent_workbench.worker import AgentWorkbenchWorker

        if self._worker is None:
            self._worker = AgentWorkbenchWorker(self)
            self._worker.start()

    def recover_on_startup(self) -> int:
        """Mark running runs as paused_recovery after backend restart."""
        running = self._repo.list_runs_by_status("running")
        count = 0
        for run in running:
            conn = self._repo.transaction()
            try:
                self._events.transition_run_with_event(
                    conn,
                    run_id=run.id,
                    new_status="paused_recovery",
                    event_type="run.recovered",
                    summary="Run paused for recovery after backend restart",
                    payload={"previous_status": "running"},
                )
                self._repo.commit(conn)
                count += 1
            except Exception:
                self._repo.rollback(conn)
        return count

    def create_run(self, request: CreateRunRequest) -> AgentRun:
        workspace = Path(request.workspace_root).resolve()
        if not workspace.exists():
            raise ValueError("Workspace nicht gefunden")

        now = self._repo.now()
        run = AgentRun(
            id=self._repo.make_run_id(),
            job_id=request.job_id,
            workspace_root=str(workspace),
            workspace_name=request.workspace_name or workspace.name,
            goal=request.goal,
            status="created",
            execution_mode=request.execution_mode,
            provider=request.provider,
            model_id=request.model_id,
            max_steps=request.max_steps,
            created_at=now,
            updated_at=now,
        )
        conn = self._repo.transaction()
        try:
            self._repo.insert_run(run, conn=conn)
            self._events.append_event(
                conn,
                run_id=run.id,
                event_type="run.created",
                summary="AgentRun erstellt",
                payload={"goal": request.goal, "execution_mode": request.execution_mode},
            )
            self._manifests.materialize(run, [], [])
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            import shutil
            shutil.rmtree(self._manifests.task_dir(run), ignore_errors=True)
            raise
        return run

    def get_run(self, run_id: str) -> AgentRun:
        run = self._repo.get_run(run_id)
        if run is None:
            raise ValueError(f"Run {run_id} nicht gefunden")
        return run

    def list_runs(self, limit: int = 50) -> list[AgentRun]:
        return self._repo.list_runs(limit=limit)

    def list_steps(self, run_id: str) -> list[AgentStep]:
        self.get_run(run_id)
        return self._repo.list_steps_for_run(run_id)

    def list_events(self, run_id: str, after_sequence: int = 0) -> list[AgentEvent]:
        self.get_run(run_id)
        return self._repo.list_events(run_id, after_sequence=after_sequence)

    def set_plan(self, run_id: str, request: SetPlanRequest) -> tuple[AgentRun, list[AgentStep]]:
        run = self.get_run(run_id)
        if run.status not in {"created", "planning", "waiting_plan_review", "ready", "paused", "paused_recovery"}:
            raise InvalidTransitionError("run", run.status, "planning")

        now = self._repo.now()
        steps: list[AgentStep] = []
        conn = self._repo.transaction()
        manifest_backup = self._manifests.backup(run)
        try:
            validate_run_transition(run.status, "planning")
            self._repo.delete_steps_for_run(run_id, conn=conn)
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="planning",
                event_type="run.planning_started",
                summary="Planung gestartet",
            )

            for idx, step_input in enumerate(request.steps, start=1):
                step = AgentStep(
                    id=self._repo.make_step_id(),
                    run_id=run_id,
                    ordinal=idx,
                    title=step_input.title,
                    description=step_input.description,
                    status="pending",
                    role=step_input.role,
                    depends_on_json=self._repo.dumps(step_input.depends_on),
                    tool_policy_json=self._repo.dumps(step_input.tool_policy),
                    attempt_count=0,
                    max_attempts=step_input.max_attempts,
                    created_at=now,
                )
                self._repo._insert_step_row(conn, step)
                steps.append(step)
                self._events.append_event(
                    conn,
                    run_id=run_id,
                    step_id=step.id,
                    event_type="step.created",
                    summary=f"Step erstellt: {step.title}",
                    payload={"ordinal": idx, "title": step.title},
                )

            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="ready",
                event_type="run.plan_ready",
                summary="Plan bereit",
                payload={"step_count": len(steps)},
            )
            self._manifests.materialize(replace(run, status="ready", updated_at=now), steps)
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            self._manifests.restore_backup(run, manifest_backup)
            raise

        self._manifests.discard_backup(manifest_backup)

        updated_run = self.get_run(run_id)
        self._manifests.materialize(updated_run, steps, self.list_events(run_id))
        if request.auto_start:
            updated_run = self.start_run(run_id)
        return updated_run, steps

    def auto_plan(self, run_id: str, *, auto_start: bool = False) -> tuple[AgentRun, list[AgentStep]]:
        run = self.get_run(run_id)
        steps = generate_plan_from_goal(run.goal)
        return self.set_plan(
            run_id,
            SetPlanRequest(steps=steps, auto_start=auto_start),
        )

    def start_run(self, run_id: str) -> AgentRun:
        run = self.get_run(run_id)
        steps = self._repo.list_steps_for_run(run_id)
        if not steps:
            raise ValueError("Kein Plan vorhanden — zuerst Plan setzen")
        validate_run_transition(run.status, "running")

        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="running",
                event_type="run.started",
                summary="Run gestartet",
                started_at=self._repo.now(),
                clear_pause_reason=True,
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise

        self._ensure_worker()
        if self._worker:
            self._worker.wake()

        return self.get_run(run_id)

    def pause_run(self, run_id: str, request: PauseRunRequest | None = None) -> AgentRun:
        run = self.get_run(run_id)
        reason = (request.reason if request else None) or "user_requested"
        validate_run_transition(run.status, "paused")

        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="paused",
                event_type="run.paused",
                summary=f"Run pausiert: {reason}",
                pause_reason=reason,
                payload={"reason": reason},
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise
        return self.get_run(run_id)

    def resume_run(self, run_id: str) -> AgentRun:
        run = self.get_run(run_id)
        if not (Path(run.workspace_root) / ".codee" / "tasks" / run.id / "task.json").exists():
            if run.status not in {"paused", "paused_recovery", "migration_review_required", "workspace_review_required"}:
                raise ValueError("resume_baseline_missing: run is not paused")
            if run.status == "workspace_review_required":
                raise ValueError("workspace_changed: explicit workspace approval required")
            if run.status != "migration_review_required":
                validate_run_transition(run.status, "migration_review_required")
                conn = self._repo.transaction()
                try:
                    self._events.transition_run_with_event(
                        conn, run_id=run_id, new_status="migration_review_required",
                        event_type="run.resume_baseline_missing",
                        summary="Task manifest missing; explicit migration approval required",
                        pause_reason="resume_baseline_missing",
                    )
                    self._repo.commit(conn)
                except Exception:
                    self._repo.rollback(conn)
                    raise
            raise ValueError("resume_baseline_missing: explicit migration approval required")

        changed_files = self._manifests.validate(run)
        if changed_files:
            if run.status in {"paused", "paused_recovery"}:
                conn = self._repo.transaction()
                try:
                    self._events.transition_run_with_event(
                        conn,
                        run_id=run_id,
                        new_status="workspace_review_required",
                        event_type="run.workspace_changes_detected",
                        summary="Workspace changed since last accepted resume baseline",
                        pause_reason="workspace_changed",
                        payload={"changed_files": changed_files[:100]},
                    )
                    self._repo.commit(conn)
                except Exception:
                    self._repo.rollback(conn)
                    raise
            raise ValueError("workspace_changed: " + ", ".join(changed_files[:20]))
        if run.status == "workspace_review_required":
            raise ValueError("workspace_changed: explicit workspace approval required")
        if run.status == "paused_recovery":
            target = "running"
        else:
            validate_run_transition(run.status, "running")
            target = "running"

        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status=target,
                event_type="run.resumed",
                summary="Run fortgesetzt",
                clear_pause_reason=True,
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise

        if self._worker:
            self._worker.wake()
        return self.get_run(run_id)

    def get_workspace_changes(self, run_id: str) -> list[str]:
        run = self.get_run(run_id)
        if run.status not in {"paused", "paused_recovery", "workspace_review_required"}:
            raise ValueError("workspace_changes_not_required")
        return self._manifests.validate(run)

    def accept_workspace_changes(self, run_id: str, request: AcceptWorkspaceChangesRequest | None = None) -> AgentRun:
        run = self.get_run(run_id)
        if run.status not in {"paused", "paused_recovery", "workspace_review_required"}:
            raise ValueError("workspace_changes_not_required")
        changed_files = self._manifests.validate(run)
        if not changed_files:
            if run.status == "workspace_review_required":
                self._manifests.materialize(run, self.list_steps(run.id), self.list_events(run.id))
                validate_run_transition(run.status, "paused")
                conn = self._repo.transaction()
                try:
                    self._events.transition_run_with_event(
                        conn,
                        run_id=run_id,
                        new_status="paused",
                        event_type="run.workspace_changes_accepted",
                        summary="Workspace review cleared; no pending drift remains",
                        pause_reason="workspace_changes_cleared",
                        payload={"changed_files": []},
                    )
                    self._repo.commit(conn)
                except Exception:
                    self._repo.rollback(conn)
                    raise
                accepted = self.get_run(run_id)
                self._manifests.materialize(accepted, self.list_steps(run.id), self.list_events(run.id))
                return accepted
            raise ValueError("workspace_changes_not_required")
        if request and request.expected_changed_files is not None:
            expected = sorted(set(request.expected_changed_files))
            actual = sorted(set(changed_files))
            if expected != actual:
                raise ValueError("workspace_changes_mismatch: " + ", ".join(actual[:20]))

        backup = self._manifests.backup(run)
        self._manifests.materialize(run, self.list_steps(run.id), self.list_events(run.id))
        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="paused",
                event_type="run.workspace_changes_accepted",
                summary="Workspace changes explicitly accepted as new resume baseline",
                pause_reason="workspace_changes_accepted",
                payload={"changed_files": changed_files[:100]},
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            self._manifests.restore_backup(run, backup)
            raise
        self._manifests.discard_backup(backup)
        accepted = self.get_run(run_id)
        self._manifests.materialize(accepted, self.list_steps(run.id), self.list_events(run.id))
        return accepted

    def accept_resume_baseline(self, run_id: str) -> AgentRun:
        run = self.get_run(run_id)
        if run.status != "migration_review_required":
            raise ValueError("resume_baseline_not_required")
        self._manifests.materialize(run, self.list_steps(run.id), self.list_events(run.id))
        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn, run_id=run_id, new_status="paused",
                event_type="run.resume_baseline_accepted",
                summary="Resume baseline explicitly accepted",
                pause_reason="resume_baseline_accepted",
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            (self._manifests.task_dir(run) / "task.json").unlink(missing_ok=True)
            raise
        accepted = self.get_run(run_id)
        self._manifests.materialize(accepted, self.list_steps(run.id), self.list_events(run.id))
        return accepted

    def complete_host_action(
        self,
        action_id: str,
        *,
        result: dict[str, Any] | None = None,
        executor_id: str = "desktop-primary",
    ) -> Any:
        """Schließt eine Host-Aktion ab und akzeptiert ihren Workspace-Zustand als neue Resume-Basis."""
        action = self._host_actions.complete(action_id, result=result, executor_id=executor_id)
        if action.action_type in {"apply_patch", "refresh_workspace"}:
            run = self.get_run(action.run_id)
            self._manifests.materialize(run, self.list_steps(run.id), self.list_events(run.id))
        return action

    def cancel_run(self, run_id: str) -> AgentRun:
        run = self.get_run(run_id)
        validate_run_transition(run.status, "cancelled")

        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="cancelled",
                event_type="run.cancelled",
                summary="Run abgebrochen",
                finished_at=self._repo.now(),
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise
        return self.get_run(run_id)

    def activate_step(self, run_id: str, step_id: str) -> AgentStep:
        run = self.get_run(run_id)
        step = self._repo.get_step(step_id)
        if step is None or step.run_id != run_id:
            raise ValueError(f"Step {step_id} nicht gefunden")

        if self._repo.count_active_steps(run_id) >= 1:
            active = [s for s in self._repo.list_steps_for_run(run_id) if s.status == "active"]
            if active and active[0].id != step_id:
                raise InvalidTransitionError("step", "active", "active")

        validate_step_transition(step.status, "active")
        now = self._repo.now()
        conn = self._repo.transaction()
        try:
            self._events.transition_step_with_event(
                conn,
                run_id=run_id,
                step_id=step_id,
                new_status="active",
                event_type="step.started",
                summary=f"Step gestartet: {step.title}",
                started_at=now,
                attempt_count=step.attempt_count + 1,
            )
            self._repo.update_run_status(run_id, run.status, conn=conn, current_step_id=step_id)
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise

        updated = self._repo.get_step(step_id)
        assert updated is not None
        return updated

    def complete_step(self, run_id: str, step_id: str, output_summary: str = "") -> AgentStep:
        step = self._repo.get_step(step_id)
        if step is None:
            raise ValueError(f"Step {step_id} nicht gefunden")
        validate_step_transition(step.status, "completed")

        conn = self._repo.transaction()
        try:
            self._events.transition_step_with_event(
                conn,
                run_id=run_id,
                step_id=step_id,
                new_status="completed",
                event_type="step.completed",
                summary=f"Step abgeschlossen: {step.title}",
                finished_at=self._repo.now(),
                output_summary=output_summary or step.output_summary,
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise

        updated = self._repo.get_step(step_id)
        assert updated is not None
        return updated

    def fail_step(self, run_id: str, step_id: str, error_message: str) -> AgentStep:
        step = self._repo.get_step(step_id)
        if step is None:
            raise ValueError(f"Step {step_id} nicht gefunden")
        validate_step_transition(step.status, "failed")

        conn = self._repo.transaction()
        try:
            self._events.transition_step_with_event(
                conn,
                run_id=run_id,
                step_id=step_id,
                new_status="failed",
                event_type="step.failed",
                summary=f"Step fehlgeschlagen: {error_message}",
                severity="error",
                finished_at=self._repo.now(),
                error_message=error_message,
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise

        updated = self._repo.get_step(step_id)
        assert updated is not None
        return updated

    def complete_run(self, run_id: str) -> AgentRun:
        run = self.get_run(run_id)
        validate_run_transition(run.status, "completed")

        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="completed",
                event_type="run.completed",
                summary="Run abgeschlossen",
                finished_at=self._repo.now(),
                current_step_id=None,
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise
        return self.get_run(run_id)

    def fail_run(self, run_id: str, error_message: str) -> AgentRun:
        run = self.get_run(run_id)
        validate_run_transition(run.status, "failed")

        conn = self._repo.transaction()
        try:
            self._events.transition_run_with_event(
                conn,
                run_id=run_id,
                new_status="failed",
                event_type="run.failed",
                summary=f"Run fehlgeschlagen: {error_message}",
                severity="error",
                error_message=error_message,
                finished_at=self._repo.now(),
            )
            self._repo.commit(conn)
        except Exception:
            self._repo.rollback(conn)
            raise
        return self.get_run(run_id)

    def add_followup(self, run_id: str, request: FollowUpRequest) -> Any:
        self.get_run(run_id)
        followup = self._followups.create_followup(run_id, request)
        self._events.append_event_standalone(
            run_id=run_id,
            event_type="followup.received",
            summary="Follow-up empfangen",
            payload={"followup_id": followup.id, "text": request.text},
        )
        return followup

    def apply_followup_plan(self, run_id: str, followup_id: str) -> tuple[AgentRun, list[AgentStep]]:
        run = self.get_run(run_id)
        followup, steps = self._followups.apply_followup(followup_id, goal=run.goal)
        if steps:
            run, new_steps = self.set_plan(run_id, SetPlanRequest(steps=steps))
            self._events.append_event_standalone(
                run_id=run_id,
                event_type="plan.revised",
                summary="Plan nach Follow-up ueberarbeitet",
                payload={"followup_id": followup_id, "step_count": len(new_steps)},
            )
            return run, new_steps
        return run, []

    def propose_file_change(
        self,
        run_id: str,
        step_id: str,
        request: ProposeFileChangeRequest,
    ) -> Any:
        run = self.get_run(run_id)
        change = self._file_changes.propose_change(
            run_id=run_id,
            step_id=step_id,
            workspace_root=run.workspace_root,
            request=request,
            job_id=run.job_id,
        )
        self._events.append_event_standalone(
            run_id=run_id,
            step_id=step_id,
            event_type="file.change_proposed",
            summary=f"Aenderung vorgeschlagen: {request.file_path}",
            severity="warning",
            payload={
                "file_change_id": change.id,
                "file_path": change.file_path,
                "review_gate_id": change.review_gate_id,
            },
        )
        return change


_service: AgentWorkbenchService | None = None


def get_agent_workbench_service() -> AgentWorkbenchService:
    global _service
    if _service is None:
        _service = AgentWorkbenchService()
    return _service


def reset_agent_workbench_service(
    db_path: str | None = None,
    *,
    simulate_llm: bool = True,
    auto_start_worker: bool = False,
) -> AgentWorkbenchService:
    global _service
    if _service is not None and _service._worker is not None:
        _service._worker.stop()
    _service = AgentWorkbenchService(
        db_path=db_path,
        simulate_llm=simulate_llm,
        auto_start_worker=auto_start_worker,
    )
    return _service
