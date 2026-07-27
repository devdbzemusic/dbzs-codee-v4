import pytest
import sqlite3
import tempfile
import os
from pathlib import Path
from app.runtime.service import RuntimeService, RuntimeStatus, RuntimeChatResponse, RuntimeChatMessage
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.agent_workbench.service import AgentWorkbenchService
from app.agent_workbench.runtime_adapter import DefaultAgentRuntimeAdapter
from app.agent_workbench.models import AgentRun


class FakeRuntimeService:
    def __init__(self, mode="running"):
        self.state = mode
        self.provider = "llama.cpp"
        self.model_id = "Llama-3.2-3B-CodeReactor.Q8-0"
        self.model_name = "Llama Reactor"
        self.endpoint = "http://127.0.0.1:8091"
        self.pid = 9812

    def status(self) -> RuntimeStatus:
        return RuntimeStatus(
            state=self.state,
            provider=self.provider,
            model_id=self.model_id,
            model_name=self.model_name,
            endpoint=self.endpoint,
            pid=self.pid,
            message="Active and ready."
        )

    def start_model(self, model_id: str) -> RuntimeStatus:
        self.state = "running"
        return self.status()

    def chat(self, req) -> RuntimeChatResponse:
        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content='{"explanation": "Everything looks fine, no action needed.", "tool_call": null}'),
            model_id=self.model_id,
            model_name=self.model_name
        )


def test_verify_runtime_and_database_sync():
    fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        repo = AgentWorkbenchRepository(db_path=db_path)
        fake_runtime = FakeRuntimeService(mode="stopped")
        adapter = DefaultAgentRuntimeAdapter(fake_runtime, repo)

        run = AgentRun(
            id="test-run-1",
            workspace_root=os.getcwd(),
            workspace_name="demo-ws",
            goal="Test verifying agent runtime connection",
            status="created",
            execution_mode="supervised",
            provider="local",
            model_id="qwen-coder-3b",
            max_steps=20,
            created_at="2026-06-21T12:00:00Z",
            updated_at="2026-06-21T12:00:00Z"
        )
        repo.insert_run(run)

        # First verification should try to start it and succeed
        res = adapter.verify_runtime(run)
        assert res.verified is True
        assert res.health_state == "healthy"
        assert res.model_id == "Llama-3.2-3B-CodeReactor.Q8-0"

        # Read back from repo to verify columns updated
        updated = repo.get_run("test-run-1")
        assert updated is not None
        assert updated.execution_backend == "local_runtime"
        assert updated.runtime_provider == "llama.cpp"
        assert updated.runtime_model_id == "Llama-3.2-3B-CodeReactor.Q8-0"
        assert updated.runtime_endpoint == "http://127.0.0.1:8091"
        assert updated.runtime_pid == 9812
        assert updated.runtime_health_state == "healthy"
        assert updated.runtime_verified_at is not None

        # Turn completion with messages
        resp = adapter.complete_turn(run, [{"role": "user", "content": "How's the weather?"}])
        assert "explanation" in resp.content
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)
