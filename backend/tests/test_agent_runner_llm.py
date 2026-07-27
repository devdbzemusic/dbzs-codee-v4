import json
from pathlib import Path

from app.agent_runner.service import AgentRunnerService
from app.job_spooler.models import JobClaimRequest, JobEnqueueRequest
from app.job_spooler.service import JobSpoolerService
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest, RuntimeChatResponse, RuntimeStatus


class FakeRuntimeService:
    def __init__(self, *, running: bool = True, llm_content: str | None = None) -> None:
        self.running = running
        self.llm_content = llm_content or json.dumps(
            {
                "patches": [
                    {
                        "file_path": "README.md",
                        "proposed_content": "# Patched\n",
                        "summary": "Improve readme",
                    }
                ]
            }
        )
        self.chat_calls: list[RuntimeChatRequest] = []

    def status(self) -> RuntimeStatus:
        if self.running:
            return RuntimeStatus(
                state="running",
                provider="llama.cpp",
                model_id="coder",
                model_name="coder",
                endpoint="http://127.0.0.1:8091",
            )
        return RuntimeStatus(state="stopped", message="Runtime stopped.")

    def chat(self, request: RuntimeChatRequest) -> RuntimeChatResponse:
        self.chat_calls.append(request)
        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content=self.llm_content),
            model_id="coder",
            model_name="coder",
        )


def test_agent_runner_llm_happy_path_with_patches(tmp_path: Path) -> None:
    jobs = JobSpoolerService(db_path=tmp_path / "jobs.sqlite3")
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    (workspace / "README.md").write_text("# Demo\n", encoding="utf-8")

    job = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Improve readme",
            task_type="coder",
            assigned_agent_role="coder",
            input_payload={"workspace_root": str(workspace)},
        )
    )
    jobs.claim_next_job(JobClaimRequest(worker_id="agent-1", supported_roles=["coder"]))

    runtime = FakeRuntimeService()
    runner = AgentRunnerService(job_spooler=jobs, runtime_service=runtime)
    result = runner.process_job(job.id, "agent-1", str(workspace))

    assert result.state == "idle"
    assert result.message == "needs_review"
    assert len(result.patch_proposals) == 1
    assert result.patch_proposals[0].file_path == "README.md"
    assert result.llm_skipped is False
    assert runtime.chat_calls

    detail = jobs.get_job_detail(job.id)
    assert detail.job.status == "waiting_verification"
    assert any(artifact.name == "patch_proposals.json" for artifact in detail.artifacts)
    assert any(artifact.name == "llm_response.md" for artifact in detail.artifacts)


def test_agent_runner_skips_llm_when_runtime_stopped(tmp_path: Path) -> None:
    jobs = JobSpoolerService(db_path=tmp_path / "jobs.sqlite3")
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)

    job = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Patch readme",
            task_type="coder",
            assigned_agent_role="coder",
            input_payload={"workspace_root": str(workspace)},
        )
    )
    jobs.claim_next_job(JobClaimRequest(worker_id="agent-1", supported_roles=["coder"]))

    runtime = FakeRuntimeService(running=False)
    runner = AgentRunnerService(job_spooler=jobs, runtime_service=runtime)
    result = runner.process_job(job.id, "agent-1", str(workspace))

    assert result.llm_skipped is True
    assert result.patch_proposals == []
    assert runtime.chat_calls == []
    assert jobs.get_job(job.id).status == "completed"

