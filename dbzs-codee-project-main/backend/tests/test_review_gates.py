"""Tests for ReviewGateService."""

import pytest
import tempfile
import os
from datetime import UTC, datetime
from app.review_gates.service import ReviewGateService
from app.review_gates.service import ReviewGateScopeError
from app.review_gates.models import (
    ReviewGateCreateRequest,
    ReviewGateApproveRequest,
    ReviewGateRejectRequest,
)
from app.trajectories.service import TrajectoryService


class TestReviewGateService:
    """Test suite for ReviewGateService."""

    def _create_temp_db(self):
        """Creates temporary database file."""
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        return path

    def _create_temp_trajectory_db(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        return path

    def test_create_gate(self):
        """Create review gate successfully."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job-123",
                step_number=1,
                proposed_changes=[
                    {
                        "file_path": "src/test.py",
                        "old_content": "def old(): pass",
                        "new_content": "def new(): pass",
                        "diff": "- def old(): pass\n+ def new(): pass",
                        "risk_level": "low",
                    }
                ],
                auto_apply_timeout_seconds=300,
            )

            gate = service.create_gate(request)

            assert gate.job_id == "test-job-123"
            assert gate.step_number == 1
            assert gate.status == "pending"
            assert len(gate.proposed_changes) == 1
            assert gate.proposed_changes[0].file_path == "src/test.py"
        finally:
            os.unlink(db_path)
    def test_get_gate(self):
        """Retrieve review gate by ID."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[
                    {
                        "file_path": "test.py",
                        "diff": "diff content",
                    }
                ],
            )

            created = service.create_gate(request)
            retrieved = service.get_gate(created.id)

            assert retrieved.id == created.id
            assert retrieved.job_id == "test-job"
            assert retrieved.status == "pending"
        finally:
            os.unlink(db_path)

    def test_approve_gate(self):
        """Approve review gate."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            )

            created = service.create_gate(request)
            approve_request = ReviewGateApproveRequest(
                reviewed_by="test-user",
                review_comment="Looks good!",
            )

            approved = service.approve_gate(created.id, approve_request)

            assert approved.status == "approved"
            assert approved.reviewed_by == "test-user"
            assert approved.review_comment == "Looks good!"
            assert approved.reviewed_at is not None
        finally:
            os.unlink(db_path)

    def test_reject_gate(self):
        """Reject review gate."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            )

            created = service.create_gate(request)
            reject_request = ReviewGateRejectRequest(
                reviewed_by="test-user",
                rejection_reason="Needs improvement",
            )

            rejected = service.reject_gate(created.id, reject_request)

            assert rejected.status == "rejected"
            assert rejected.reviewed_by == "test-user"
            assert rejected.review_comment == "Needs improvement"
        finally:
            os.unlink(db_path)

    def test_list_pending_gates(self):
        """List all pending gates."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)

            # Create two pending gates
            for i in range(2):
                service.create_gate(ReviewGateCreateRequest(
                    job_id=f"job-{i}",
                    step_number=1,
                    proposed_changes=[{"file_path": f"test{i}.py", "diff": "diff"}],
                ))

            pending = service.list_pending_gates()

            assert len(pending) == 2
            assert all(g.status == "pending" for g in pending)
        finally:
            os.unlink(db_path)

    def test_list_pending_gates_filtered(self):
        """List pending gates filtered by job_id."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)

            service.create_gate(ReviewGateCreateRequest(
                job_id="job-1",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            ))
            service.create_gate(ReviewGateCreateRequest(
                job_id="job-2",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            ))

            pending = service.list_pending_gates(job_id="job-1")

            assert len(pending) == 1
            assert pending[0].job_id == "job-1"
        finally:
            os.unlink(db_path)

    def test_delete_gate(self):
        """Delete review gate."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            )

            created = service.create_gate(request)
            result = service.delete_gate(created.id)

            assert result is True

            # Should raise error now
            try:
                service.get_gate(created.id)
                assert False, "Should have raised ValueError"
            except ValueError:
                pass
        finally:
            os.unlink(db_path)

    def test_check_auto_apply_not_expired(self):
        """Auto-apply returns False when not expired."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
                auto_apply_timeout_seconds=3600,  # 1 hour
            )

            created = service.create_gate(request)
            should_apply = service.check_auto_apply(created.id)

            assert should_apply is False
        finally:
            os.unlink(db_path)

    def test_check_auto_apply_expired(self):
        """Auto-apply returns True when expired."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
                auto_apply_timeout_seconds=1,  # 1 second
            )

            created = service.create_gate(request)
            
            # Wait for timeout
            import time
            time.sleep(1.5)
            
            should_apply = service.check_auto_apply(created.id)

            assert should_apply is True
        finally:
            os.unlink(db_path)

    def test_get_gate_not_found(self):
        """Get gate raises error when not found."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)

            try:
                service.get_gate("nonexistent")
                assert False, "Should have raised ValueError"
            except ValueError as e:
                assert "nicht gefunden" in str(e)
        finally:
            os.unlink(db_path)

    def test_multiple_proposed_changes(self):
        """Create gate with multiple proposed changes."""
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            request = ReviewGateCreateRequest(
                job_id="test-job",
                step_number=1,
                proposed_changes=[
                    {"file_path": "file1.py", "diff": "diff1"},
                    {"file_path": "file2.py", "diff": "diff2"},
                    {"file_path": "file3.py", "diff": "diff3"},
                ],
            )

            gate = service.create_gate(request)

            assert len(gate.proposed_changes) == 3
            assert gate.proposed_changes[0].file_path == "file1.py"
            assert gate.proposed_changes[2].file_path == "file3.py"
        finally:
            os.unlink(db_path)

    def test_create_gate_records_trajectory_event(self):
        db_path = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            service = ReviewGateService(db_path=db_path, trajectory_service=trajectory_service)
            request = ReviewGateCreateRequest(
                job_id="traj-job",
                step_number=2,
                proposed_changes=[
                    {
                        "file_path": "backend/app/runtime/service.py",
                        "diff": "diff",
                        "risk_level": "medium",
                        "risk_factors": ["core module"],
                    },
                    {
                        "file_path": "backend/app/main.py",
                        "diff": "diff2",
                        "risk_level": "high",
                    },
                ],
            )

            service.create_gate(request)
            events = trajectory_service.list_events_for_job("traj-job")

            assert len(events) == 1
            assert events[0].event_type == "review_gate_created"
            assert events[0].risk_level == "high"
            assert "backend/app/main.py" in events[0].files
            assert events[0].metadata["proposed_changes_count"] == 2
        finally:
            os.unlink(db_path)
            os.unlink(trajectory_db)

    def test_approve_gate_records_trajectory_event(self):
        db_path = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            service = ReviewGateService(db_path=db_path, trajectory_service=trajectory_service)
            created = service.create_gate(ReviewGateCreateRequest(
                job_id="approve-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            ))
            trajectory_service.delete_events_for_job("approve-job")

            service.approve_gate(
                created.id,
                ReviewGateApproveRequest(reviewed_by="test-user", review_comment="OK"),
            )
            events = trajectory_service.list_events_for_job("approve-job")

            assert len(events) == 1
            assert events[0].event_type == "review_approved"
            assert events[0].metadata["reviewed_by"] == "test-user"
        finally:
            os.unlink(db_path)
            os.unlink(trajectory_db)

    def test_reject_gate_records_trajectory_event(self):
        db_path = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            service = ReviewGateService(db_path=db_path, trajectory_service=trajectory_service)
            created = service.create_gate(ReviewGateCreateRequest(
                job_id="reject-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
            ))
            trajectory_service.delete_events_for_job("reject-job")

            service.reject_gate(
                created.id,
                ReviewGateRejectRequest(reviewed_by="test-user", rejection_reason="No"),
            )
            events = trajectory_service.list_events_for_job("reject-job")

            assert len(events) == 1
            assert events[0].event_type == "review_rejected"
            assert events[0].metadata["rejection_reason"] == "No"
        finally:
            os.unlink(db_path)
            os.unlink(trajectory_db)

    def test_check_auto_apply_records_event_once(self):
        db_path = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            service = ReviewGateService(db_path=db_path, trajectory_service=trajectory_service)
            created = service.create_gate(ReviewGateCreateRequest(
                job_id="auto-job",
                step_number=1,
                proposed_changes=[{"file_path": "test.py", "diff": "diff"}],
                auto_apply_timeout_seconds=1,
            ))
            trajectory_service.delete_events_for_job("auto-job")

            import time
            time.sleep(1.5)

            assert service.check_auto_apply(created.id) is True
            assert service.check_auto_apply(created.id) is True

            events = trajectory_service.list_events_for_job("auto-job")
            assert len(events) == 1
            assert events[0].event_type == "auto_apply_checked"
        finally:
            os.unlink(db_path)
            os.unlink(trajectory_db)

    def test_workspace_scoped_pending_gates_and_legacy_records(self):
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            scoped = service.create_gate(ReviewGateCreateRequest(
                job_id="workspace-a-job",
                step_number=1,
                run_id="run-a",
                workspace_root="C:/work/a",
                workspace_id="c:/work/a",
                proposed_changes=[{"file_path": "src/a.py", "diff": "diff"}],
            ))
            legacy = service.create_gate(ReviewGateCreateRequest(
                job_id="legacy-job",
                step_number=1,
                proposed_changes=[{"file_path": "src/legacy.py", "diff": "diff"}],
            ))

            assert scoped.scope_status == "scoped"
            assert legacy.scope_status == "legacy_unscoped"
            assert [gate.id for gate in service.list_pending_gates(workspace_id="c:/work/a")] == [scoped.id]
            assert service.list_pending_gates(workspace_id="c:/work/b") == []
            assert {gate.id for gate in service.list_pending_gates()} == {scoped.id, legacy.id}
        finally:
            os.unlink(db_path)

    def test_workspace_mismatch_rejects_approval(self):
        db_path = self._create_temp_db()
        try:
            service = ReviewGateService(db_path=db_path)
            gate = service.create_gate(ReviewGateCreateRequest(
                job_id="workspace-a-job",
                step_number=1,
                run_id="run-a",
                workspace_root="C:/work/a",
                workspace_id="c:/work/a",
                proposed_changes=[{"file_path": "src/a.py", "diff": "diff"}],
            ))

            with pytest.raises(ReviewGateScopeError):
                service.approve_gate(
                    gate.id,
                    ReviewGateApproveRequest(
                        reviewed_by="runtime-chat",
                        workspace_id="c:/work/b",
                    ),
                )
            with pytest.raises(ReviewGateScopeError):
                service.reject_gate(
                    gate.id,
                    ReviewGateRejectRequest(
                        reviewed_by="runtime-chat",
                        rejection_reason="no",
                        workspace_id=None,
                    ),
                )
            assert service.get_gate(gate.id).status == "pending"
        finally:
            os.unlink(db_path)
