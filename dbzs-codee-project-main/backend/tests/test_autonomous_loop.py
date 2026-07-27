"""Tests for AutonomousLoopController."""

import pytest
import tempfile
import os
from datetime import UTC, datetime
from app.agent_loop.autonomous_controller import AutonomousLoopController, LoopState
from app.trajectories.service import TrajectoryService


class TestAutonomousLoopController:
    """Test suite for AutonomousLoopController."""

    def _create_temp_db(self):
        """Creates temporary database file."""
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        return path

    def _create_temp_trajectory_db(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        return path

    def test_init_creates_state(self):
        """Initial state is created correctly."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job-123",
                db_path=db_path,
                max_steps=5,
                max_runtime_seconds=300,
            )
            state = controller.get_state()
            assert state["job_id"] == "test-job-123"
            assert state["step_count"] == 0
            assert state["max_steps"] == 5
            assert state["terminated_at"] is None
            assert state["termination_reason"] is None
        finally:
            os.unlink(db_path)

    def test_can_continue_initially(self):
        """Loop can continue when fresh."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            assert controller.can_continue() is True
            assert controller.is_active is True
        finally:
            os.unlink(db_path)

    def test_next_step_increments_counter(self):
        """next_step() increments step_count."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            step1 = controller.next_step()
            assert step1["step"] == 1
            assert controller.step_count == 1

            step2 = controller.next_step()
            assert step2["step"] == 2
            assert controller.step_count == 2
        finally:
            os.unlink(db_path)

    def test_cannot_continue_after_max_steps(self):
        """Loop stops after max_steps reached."""
        db_path = self._create_temp_db()
        try:
            ctrl = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
                max_steps=2,
            )

            ctrl.next_step()  # Step 1
            ctrl.next_step()  # Step 2

            assert ctrl.can_continue() is False
        finally:
            os.unlink(db_path)

    def test_next_step_raises_when_exhausted(self):
        """next_step() raises when max_steps reached."""
        db_path = self._create_temp_db()
        try:
            ctrl = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
                max_steps=1,
            )

            ctrl.next_step()

            try:
                ctrl.next_step()
                assert False, "Expected RuntimeError"
            except RuntimeError as e:
                assert "max_steps_reached" in str(e)
        finally:
            os.unlink(db_path)

    def test_mark_complete_terminates(self):
        """mark_complete() terminates loop."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            controller.mark_complete(success=True, reason="goal_achieved")

            assert controller.is_active is False
            state = controller.get_state()
            assert state["termination_reason"] == "goal_achieved"
            assert state["termination_code"] == 0
            assert state["terminated_at"] is not None
        finally:
            os.unlink(db_path)

    def test_mark_user_stopped(self):
        """mark_user_stopped() sets correct reason."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            controller.mark_user_stopped()

            state = controller.get_state()
            assert state["termination_reason"] == "user_stopped"
            assert state["termination_code"] == 3
        finally:
            os.unlink(db_path)

    def test_mark_review_rejected(self):
        """mark_review_rejected() sets correct reason."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            controller.mark_review_rejected()

            state = controller.get_state()
            assert state["termination_reason"] == "review_rejected"
            assert state["termination_code"] == 4
        finally:
            os.unlink(db_path)

    def test_state_persistence(self):
        """State persists across controller instances."""
        db_path = self._create_temp_db()
        try:
            ctrl1 = AutonomousLoopController(
                job_id="persist-test",
                db_path=db_path,
                max_steps=10,
            )
            ctrl1.next_step()
            ctrl1.next_step()

            # New instance loads existing state
            ctrl2 = AutonomousLoopController(
                job_id="persist-test",
                db_path=db_path,
                max_steps=10,
            )

            assert ctrl2.step_count == 2
            assert ctrl2.can_continue() is True
        finally:
            os.unlink(db_path)

    def test_get_state_returns_copy(self):
        """get_state() returns a copy, not reference."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            state1 = controller.get_state()
            state1["step_count"] = 999

            state2 = controller.get_state()
            assert state2["step_count"] == 0  # Unchanged
        finally:
            os.unlink(db_path)

    def test_termination_codes(self):
        """All termination codes are defined."""
        db_path = self._create_temp_db()
        try:
            controller = AutonomousLoopController(
                job_id="test-job",
                db_path=db_path,
            )
            codes = controller.TERMINATION_CODES
            assert codes["goal_achieved"] == 0
            assert codes["max_steps_reached"] == 1
            assert codes["timeout"] == 2
            assert codes["user_stopped"] == 3
            assert codes["review_rejected"] == 4
            assert codes["error"] == 99
        finally:
            os.unlink(db_path)

    def test_next_step_records_trajectory_event(self):
        loop_db = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            controller = AutonomousLoopController(
                job_id="traj-job",
                db_path=loop_db,
                trajectory_service=trajectory_service,
            )

            controller.next_step()
            events = trajectory_service.list_events_for_job("traj-job")

            assert len(events) == 1
            assert events[0].event_type == "step_started"
            assert events[0].step_number == 1
            assert events[0].metadata["max_steps"] == 10
        finally:
            os.unlink(loop_db)
            os.unlink(trajectory_db)

    def test_mark_complete_records_trajectory_event(self):
        loop_db = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            controller = AutonomousLoopController(
                job_id="traj-complete",
                db_path=loop_db,
                trajectory_service=trajectory_service,
            )

            controller.mark_complete(success=True, reason="goal_achieved")
            events = trajectory_service.list_events_for_job("traj-complete")

            assert len(events) == 1
            assert events[0].event_type == "completed"
            assert events[0].metadata["termination_reason"] == "goal_achieved"
            assert events[0].metadata["success"] is True
        finally:
            os.unlink(loop_db)
            os.unlink(trajectory_db)

    def test_mark_user_stopped_records_cancelled_event(self):
        loop_db = self._create_temp_db()
        trajectory_db = self._create_temp_trajectory_db()
        try:
            trajectory_service = TrajectoryService(db_path=trajectory_db)
            controller = AutonomousLoopController(
                job_id="traj-cancel",
                db_path=loop_db,
                trajectory_service=trajectory_service,
            )

            controller.mark_user_stopped()
            events = trajectory_service.list_events_for_job("traj-cancel")

            assert len(events) == 1
            assert events[0].event_type == "cancelled"
        finally:
            os.unlink(loop_db)
            os.unlink(trajectory_db)
