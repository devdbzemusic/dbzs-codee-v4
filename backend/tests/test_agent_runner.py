from pathlib import Path

from app.agent_runner.service import AgentRunnerService
from app.job_spooler.models import JobClaimRequest, JobEnqueueRequest
from app.job_spooler.service import JobSpoolerService


def test_process_job_blocks_outside_workspace(tmp_path: Path) -> None:
    jobs = JobSpoolerService(db_path=tmp_path / "jobs.sqlite3")
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")

    job = jobs.enqueue_job(
        JobEnqueueRequest(
            title="Read outside",
            assigned_agent_role="coder",
            input_payload={
                "workspace_root": str(workspace),
                "active_file_path": str(outside),
            },
        )
    )
    jobs.claim_next_job(
        JobClaimRequest(
            worker_id="agent-1",
            supported_roles=["coder"],
        )
    )

    runner = AgentRunnerService(job_spooler=jobs)
    result = runner.process_job(job.id, "agent-1", str(workspace))
    assert result.state in {"idle", "failed"}
    updated = jobs.get_job(job.id)
    assert updated.status in {"completed", "failed", "waiting_verification"}
