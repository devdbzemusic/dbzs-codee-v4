"""Tests for ATIF-light trajectory service and API."""

import os
import tempfile

from fastapi.testclient import TestClient

from app.main import app
from app.trajectories.models import TrajectoryEventCreate
from app.trajectories.service import TrajectoryService


class TestTrajectoryService:
    def _create_temp_db(self) -> str:
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        return path

    def test_record_event(self):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            event = service.record_event(
                TrajectoryEventCreate(
                    job_id="job-123",
                    event_type="step_started",
                    summary="Autonomous loop step started",
                    step_number=1,
                    metadata={"max_steps": 10},
                    files=["src/main.py"],
                )
            )

            assert event.id.startswith("traj_")
            assert event.job_id == "job-123"
            assert event.event_type == "step_started"
            assert event.summary == "Autonomous loop step started"
            assert event.step_number == 1
            assert event.files == ["src/main.py"]
            assert event.metadata == {"max_steps": 10}
            assert event.created_at
        finally:
            os.unlink(db_path)

    def test_list_events_for_job_sorted_asc(self):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            service.record_event(
                TrajectoryEventCreate(
                    job_id="job-abc",
                    event_type="step_started",
                    summary="First step",
                    step_number=1,
                )
            )
            service.record_event(
                TrajectoryEventCreate(
                    job_id="job-abc",
                    event_type="completed",
                    summary="Done",
                    step_number=2,
                )
            )
            service.record_event(
                TrajectoryEventCreate(
                    job_id="job-other",
                    event_type="step_started",
                    summary="Other job",
                    step_number=1,
                )
            )

            events = service.list_events_for_job("job-abc")
            assert len(events) == 2
            assert events[0].summary == "First step"
            assert events[1].summary == "Done"
        finally:
            os.unlink(db_path)

    def test_list_recent_events_sorted_desc_with_limit(self):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            for index in range(5):
                service.record_event(
                    TrajectoryEventCreate(
                        job_id=f"job-{index}",
                        event_type="step_started",
                        summary=f"Step {index}",
                        step_number=index,
                    )
                )

            recent = service.list_recent_events(limit=3)
            assert len(recent) == 3
            assert recent[0].summary == "Step 4"
            assert recent[2].summary == "Step 2"
        finally:
            os.unlink(db_path)

    def test_metadata_files_json_roundtrip(self):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            metadata = {
                "review_gate_id": "rg-job-1",
                "risk_factors": ["large diff", "core file"],
            }
            service.record_event(
                TrajectoryEventCreate(
                    job_id="job-1",
                    event_type="review_gate_created",
                    summary="Review gate created",
                    files=["backend/app/main.py", "backend/app/service.py"],
                    risk_level="high",
                    metadata=metadata,
                )
            )

            events = service.list_events_for_job("job-1")
            assert len(events) == 1
            assert events[0].files == ["backend/app/main.py", "backend/app/service.py"]
            assert events[0].risk_level == "high"
            assert events[0].metadata == metadata
        finally:
            os.unlink(db_path)

    def test_delete_events_for_job(self):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            service.record_event(
                TrajectoryEventCreate(
                    job_id="job-delete",
                    event_type="step_started",
                    summary="Step",
                )
            )
            assert service.delete_events_for_job("job-delete") is True
            assert service.list_events_for_job("job-delete") == []
        finally:
            os.unlink(db_path)


class TestTrajectoryApi:
    def _create_temp_db(self) -> str:
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        return path

    def test_post_and_get_job_events(self, monkeypatch):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            monkeypatch.setattr(
                "app.trajectories.router._service",
                service,
            )
            client = TestClient(app)

            response = client.post(
                "/trajectories/events",
                json={
                    "job_id": "job-api",
                    "event_type": "step_started",
                    "summary": "API step started",
                    "step_number": 1,
                    "metadata": {"max_steps": 5},
                },
            )
            assert response.status_code == 200
            body = response.json()
            assert body["event"]["schema_version"] == "atif-light-v1"
            assert body["event"]["job_id"] == "job-api"

            list_response = client.get("/trajectories/jobs/job-api")
            assert list_response.status_code == 200
            list_body = list_response.json()
            assert list_body["schema_version"] == "atif-light-v1"
            assert len(list_body["events"]) == 1
            assert list_body["events"][0]["summary"] == "API step started"
        finally:
            os.unlink(db_path)

    def test_get_recent_events(self, monkeypatch):
        db_path = self._create_temp_db()
        try:
            service = TrajectoryService(db_path=db_path)
            monkeypatch.setattr(
                "app.trajectories.router._service",
                service,
            )
            client = TestClient(app)

            for index in range(3):
                service.record_event(
                    TrajectoryEventCreate(
                        job_id=f"job-{index}",
                        event_type="step_started",
                        summary=f"Event {index}",
                    )
                )

            response = client.get("/trajectories/recent?limit=2")
            assert response.status_code == 200
            body = response.json()
            assert body["schema_version"] == "atif-light-v1"
            assert len(body["events"]) == 2
        finally:
            os.unlink(db_path)
