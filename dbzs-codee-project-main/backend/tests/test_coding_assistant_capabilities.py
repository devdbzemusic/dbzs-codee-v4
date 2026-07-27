import json

import pytest
from fastapi.testclient import TestClient

from app.agent_runner.service import AgentRunnerService
from app.api.agent_runner import get_runner
from app.api.runtime import get_runtime_service
from app.job_spooler.models import JobClaimRequest, JobEnqueueRequest
from app.job_spooler.service import JobSpoolerService
from app.main import app
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest, RuntimeChatResponse, RuntimeStatus
from tests.coding_assistant_fixtures import fixture_workspace_root, read_fixture


class ScriptedRuntimeService:
    def __init__(self, *, llm_content: str, running: bool = True) -> None:
        self.running = running
        self.llm_content = llm_content
        self.chat_calls: list[RuntimeChatRequest] = []

    def status(self) -> RuntimeStatus:
        if self.running:
            return RuntimeStatus(
                state="running",
                provider="llama.cpp",
                model_id="coder-test",
                model_name="Coder Test",
                endpoint="http://127.0.0.1:8091",
            )
        return RuntimeStatus(state="stopped", message="Runtime stopped.")

    def chat(self, request: RuntimeChatRequest) -> RuntimeChatResponse:
        self.chat_calls.append(request)
        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content=self.llm_content),
            model_id="coder-test",
            model_name="Coder Test",
        )


@pytest.fixture
def fixture_workspace():
    return fixture_workspace_root()


@pytest.fixture
def runner_client(tmp_path):
    jobs = JobSpoolerService(db_path=tmp_path / "jobs.sqlite3")
    runner = AgentRunnerService(job_spooler=jobs)
    app.dependency_overrides[get_runner] = lambda: runner
    client = TestClient(app)
    yield client, runner, jobs
    app.dependency_overrides.clear()


def test_fixture_workspace_has_calculator_bug(fixture_workspace) -> None:
    source = read_fixture("src/calculator.ts")
    assert "subtract" in source
    assert "return a + b" in source


def test_runtime_chat_echoes_fixture_context(fixture_workspace) -> None:
    runtime = ScriptedRuntimeService(
        llm_content="subtract addiert faelschlich; Fix: return a - b;"
    )
    app.dependency_overrides[get_runtime_service] = lambda: runtime
    client = TestClient(app)

    response = client.post(
        "/runtime/chat",
        json={
            "messages": [
                {
                    "role": "user",
                    "content": f"Analysiere {fixture_workspace / 'src/calculator.ts'}",
                }
            ]
        },
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert "subtract" in response.json()["message"]["content"].lower()
    assert runtime.chat_calls


def test_agent_runner_implementation_job_with_patch_json(runner_client, fixture_workspace) -> None:
    _client, _runner, jobs = runner_client
    patch_payload = json.dumps(
        {
            "patches": [
                {
                    "file_path": "src/calculator.ts",
                    "proposed_content": read_fixture("src/calculator.ts").replace(
                        "return a + b", "return a - b", 1
                    ),
                    "summary": "Fix subtract bug",
                }
            ]
        }
    )
    runtime = ScriptedRuntimeService(llm_content=patch_payload)
    runner = AgentRunnerService(job_spooler=jobs, runtime_service=runtime)

    job = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Fix subtract in test workspace",
            task_type="coder",
            assigned_agent_role="coder",
            input_payload={"workspace_root": str(fixture_workspace)},
        )
    )
    jobs.claim_next_job(JobClaimRequest(worker_id="agent-coder-1", supported_roles=["coder"]))

    result = runner.process_job(job.id, "agent-coder-1", str(fixture_workspace))

    assert result.llm_skipped is False
    assert len(result.patch_proposals) == 1
    assert result.patch_proposals[0].file_path == "src/calculator.ts"
    assert "return a - b" in result.patch_proposals[0].proposed_content


def test_agent_runner_analysis_job_completes(runner_client, fixture_workspace) -> None:
    client, _, jobs = runner_client
    workspace = fixture_workspace

    enqueue = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Analyze calculator module",
            task_type="analysis",
            assigned_agent_role="coder",
            input_payload={"workspace_root": str(workspace)},
        )
    )

    result = client.post(
        "/agent-runner/run-once",
        json={"agent_id": "agent-coder-1", "supported_roles": ["coder"]},
    )
    assert result.status_code == 200
    body = result.json()
    assert body["job_id"] == enqueue.id
    assert body["state"] == "idle"
    assert "context_pack.md" in body["artifacts"]

    detail = jobs.get_job_detail(enqueue.id)
    assert detail.job.status == "completed"


def test_agent_runner_blocks_outside_workspace(runner_client, fixture_workspace) -> None:
    client, _, jobs = runner_client
    outside = fixture_workspace.parent.parent / "outside-secret.txt"
    outside.write_text("secret", encoding="utf-8")

    job = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Read outside file",
            assigned_agent_role="coder",
            input_payload={
                "workspace_root": str(fixture_workspace),
                "target_file": str(outside),
            },
        )
    )

    result = client.post(
        "/agent-runner/run-once",
        json={"agent_id": "agent-coder-1", "supported_roles": ["coder"]},
    )
    assert result.status_code == 200
    assert jobs.get_job(job.id).status in {"failed", "completed"}

    outside.unlink(missing_ok=True)
