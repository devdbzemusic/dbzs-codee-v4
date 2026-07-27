import pytest
import sqlite3
import tempfile
import os
import json
from pathlib import Path
from app.runtime.service import RuntimeService, RuntimeStatus, RuntimeChatResponse, RuntimeChatMessage
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.service import AgentWorkbenchService
from app.agent_workbench.runtime_adapter import DefaultAgentRuntimeAdapter
from app.agent_workbench.models import AgentRun, CreateRunRequest


class MockRuntimeService:
    def __init__(self, action_type="tool_call", tool_id="project.detect", payload=None):
        self.action_type = action_type
        self.tool_id = tool_id
        self.payload = payload or {}

    def status(self) -> RuntimeStatus:
        return RuntimeStatus(
            state="running",
            provider="llama.cpp",
            model_id="mock-model",
            model_name="Mock Model",
            endpoint="http://127.0.0.1:8091",
            pid=4242,
            message="Active and ready."
        )

    def start_model(self, model_id: str) -> RuntimeStatus:
        return self.status()

    def chat(self, req) -> RuntimeChatResponse:
        response_dict = {
            "explanation": "This is a test of model response turn.",
            "tool_call": None,
            "proposed_change": None,
            "host_action": None,
            "follow_up": None
        }

        if self.action_type == "tool_call":
            response_dict["tool_call"] = {
                "tool_id": self.tool_id,
                "arguments": self.payload
            }
        elif self.action_type == "proposed_change":
            response_dict["proposed_change"] = {
                "file_path": "src/test_file.py",
                "operation": "create",
                "explanation": "Create file via proposed change turn",
                "content": "# Hello test\n"
            }
        elif self.action_type == "host_action":
            response_dict["host_action"] = {
                "action_type": "run_tests",
                "payload": {"suite": "acceptance"}
            }
        elif self.action_type == "follow_up":
            response_dict["follow_up"] = {
                "text": "What test do you want to run next?"
            }

        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content=json.dumps(response_dict)),
            model_id="mock-model",
            model_name="Mock Model"
        )


def test_agent_worker_real_turn_and_tool_routing():
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        mock_runtime = MockRuntimeService(action_type="tool_call", tool_id="git.status")
        svc = AgentWorkbenchService(
            db_path=db_path,
            simulate_llm=False,
            auto_start_worker=False,
            runtime_service=mock_runtime
        )

        with tempfile.TemporaryDirectory() as tmp_ws:
            run = svc.create_run(
                CreateRunRequest(
                    workspace_root=tmp_ws,
                    goal="Execute Git Status",
                    execution_mode="supervised"
                )
            )

            # Auto-plan to generate steps
            run, steps = svc.auto_plan(run.id, auto_start=False)
            assert len(steps) > 0

            # Execute first step directly using worker execution logic
            from app.agent_workbench.worker import AgentWorkbenchWorker
            worker = AgentWorkbenchWorker(svc)

            step = steps[0]
            svc.activate_step(run.id, step.id)

            # Execute run step (checks connection, performs turn, executes mock tool call)
            worker._run_tool_step(run.id, step.id, step, tmp_ws)

            # Collect events to verify git.status tool execution was recorded
            events = svc.list_events(run.id)
            tool_requested_events = [e for e in events if e.event_type == "tool.requested"]
            assert len(tool_requested_events) > 0
            assert "git.status" in tool_requested_events[0].summary

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


def test_agent_worker_proposed_change_yields_review_gate():
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        mock_runtime = MockRuntimeService(action_type="proposed_change")
        svc = AgentWorkbenchService(
            db_path=db_path,
            simulate_llm=False,
            auto_start_worker=False,
            runtime_service=mock_runtime
        )

        with tempfile.TemporaryDirectory() as tmp_ws:
            run = svc.create_run(
                CreateRunRequest(
                    workspace_root=tmp_ws,
                    goal="Modify file and submit review gate",
                    execution_mode="supervised"
                )
            )

            # Create a simple step
            run, steps = svc.auto_plan(run.id, auto_start=False)
            from app.agent_workbench.worker import AgentWorkbenchWorker
            worker = AgentWorkbenchWorker(svc)

            step = steps[0]
            svc.activate_step(run.id, step.id)

            # Execute step, should trigger propose_change path
            worker._run_tool_step(run.id, step.id, step, tmp_ws)

            # Ensure file change was recorded and review gate generated
            changes = svc.repo.list_file_changes_for_run(run.id)
            assert len(changes) == 1
            assert changes[0].file_path == "src/test_file.py"
            assert changes[0].status == "waiting_review"
            assert changes[0].review_gate_id is not None

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)
