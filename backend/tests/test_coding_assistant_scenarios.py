"""Parametrisierte Coding-Assistant-Szenarien aus fixtures/coding-assistant-workspace/scenarios.json."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent_runner.service import AgentRunnerService
from app.api.agent_runner import get_runner
from app.api.runtime import get_runtime_service
from app.job_spooler.models import JobClaimRequest, JobEnqueueRequest
from app.job_spooler.service import JobSpoolerService
from app.main import app
from tests.coding_assistant_fixtures import fixture_workspace_root, read_fixture
from tests.test_coding_assistant_capabilities import ScriptedRuntimeService


REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_PATH = REPO_ROOT / "fixtures" / "coding-assistant-workspace" / "scenarios.json"


def load_scenarios() -> list[dict]:
    payload = json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))
    return payload["scenarios"]


def backend_scenarios() -> list[dict]:
    return [scenario for scenario in load_scenarios() if "backend" in scenario.get("layers", [])]


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


@pytest.mark.parametrize("scenario", backend_scenarios(), ids=lambda item: item["id"])
def test_catalog_backend_scenario(runner_client, fixture_workspace, scenario) -> None:
    scenario_id = scenario["id"]
    client, runner, jobs = runner_client
    workspace = fixture_workspace

    if scenario_id == "agent-runner-analysis":
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
        assert "context_pack.md" in body["artifacts"]
        assert jobs.get_job_detail(enqueue.id).job.status == "completed"
        return

    if scenario_id == "agent-runner-patch-job":
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
        runner_with_llm = AgentRunnerService(job_spooler=jobs, runtime_service=runtime)
        job = jobs.enqueue_job(
            JobEnqueueRequest(
                title="Fix subtract in test workspace",
                task_type="coder",
                assigned_agent_role="coder",
                input_payload={"workspace_root": str(workspace)},
            )
        )
        jobs.claim_next_job(JobClaimRequest(worker_id="agent-coder-1", supported_roles=["coder"]))
        result = runner_with_llm.process_job(job.id, "agent-coder-1", str(workspace))
        assert result.llm_skipped is False
        assert len(result.patch_proposals) == 1
        assert "return a - b" in result.patch_proposals[0].proposed_content
        return

    if scenario_id == "workspace-boundary":
        outside = workspace.parent.parent / "outside-secret.txt"
        outside.write_text("secret", encoding="utf-8")
        jobs.enqueue_job(
            JobEnqueueRequest(
                title="Read outside file",
                assigned_agent_role="coder",
                input_payload={
                    "workspace_root": str(workspace),
                    "target_file": str(outside),
                },
            )
        )
        result = client.post(
            "/agent-runner/run-once",
            json={"agent_id": "agent-coder-1", "supported_roles": ["coder"]},
        )
        assert result.status_code == 200
        outside.unlink(missing_ok=True)
        return

    pytest.skip(f"No backend handler for scenario {scenario_id}")


@pytest.mark.parametrize(
    "scenario",
    [item for item in load_scenarios() if "live" in item.get("layers", []) and item.get("prompt")],
    ids=lambda item: f"chat-{item['id']}",
)
def test_catalog_runtime_chat_mock(scenario) -> None:
    llm_content = scenario.get("mockResponse") or "Mock-Antwort fuer Backend-Test."
    runtime = ScriptedRuntimeService(llm_content=llm_content)
    app.dependency_overrides[get_runtime_service] = lambda: runtime
    client = TestClient(app)

    response = client.post(
        "/runtime/chat",
        json={"messages": [{"role": "user", "content": scenario["prompt"]}]},
    )
    app.dependency_overrides.clear()

    assert response.status_code == 200
    content = response.json()["message"]["content"].lower()
    for keyword in scenario.get("expectKeywords", []):
        assert keyword.lower() in content, f"Keyword '{keyword}' fehlt in Antwort fuer {scenario['id']}"


def test_scenario_catalog_covers_fixture_readme() -> None:
    scenarios = load_scenarios()
    ids = {scenario["id"] for scenario in scenarios}
    for required in (
        "explain-bug",
        "fix-subtract",
        "add-multiply",
        "refactor-greet",
        "list-files",
        "run-tests",
    ):
        assert required in ids

    assert fixture_workspace_root().joinpath("src/calculator.ts").exists()
