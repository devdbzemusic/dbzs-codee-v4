"""Agent runner service — claim jobs, prepare context, run read-only tools."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from app.agent_runner.models import AgentPatchProposal, AgentRunResult, AgentRunnerState, AgentRunnerStatus
from app.agent_runner.patch_parser import parse_patch_proposals
from app.agent_runner.prompts import CODER_SYSTEM_PROMPT, build_coder_user_prompt
from app.context_pack.models import ContextPackBuildRequest
from app.context_pack.service import ContextPackService
from app.job_spooler.models import (
    JobArtifactCreateRequest,
    JobClaimRequest,
    JobCompleteRequest,
    JobFailRequest,
    JobRecord,
    JobWaypointRequest,
)
from app.job_spooler.service import JobSpoolerService
from app.orchestration.models import ContextPrepareRequest, ToolExecutionRequest, WorkspaceContextSnapshot
from app.orchestration.service import OrchestrationService
from app.runtime.cloud_client import CloudRuntimeClient
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest
from app.runtime.service import RuntimeService


class AgentRunnerService:
    ALLOWED_TOOLS = frozenset({"filesystem.list_dir", "filesystem.read_text"})
    LLM_TASK_TYPES = frozenset({"coder", "implementation", "patch", "coding"})

    def __init__(
        self,
        job_spooler: JobSpoolerService | None = None,
        orchestration: OrchestrationService | None = None,
        context_pack: ContextPackService | None = None,
        runtime_service: RuntimeService | None = None,
        cloud_client: CloudRuntimeClient | None = None,
    ) -> None:
        self._jobs = job_spooler or JobSpoolerService()
        self._orchestration = orchestration or OrchestrationService()
        self._context_pack = context_pack or ContextPackService()
        self._runtime = runtime_service
        self._cloud = cloud_client or CloudRuntimeClient()
        self._status = AgentRunnerStatus(state="idle")

    @property
    def status(self) -> AgentRunnerStatus:
        return self._status

    def claim_next(self, agent_id: str, roles: list[str]):
        return self._jobs.claim_next_job(
            JobClaimRequest(worker_id=agent_id, supported_roles=roles, lease_seconds=300)
        )

    def process_job(self, job_id: str, agent_id: str, workspace_root: str | None = None) -> AgentRunResult:
        job = self._jobs.get_job(job_id)
        payload_root = str(job.input_payload.get("workspace_root") or "").strip()
        root = workspace_root or payload_root or None
        if not root:
            self._fail(job_id, agent_id, "workspace_root fehlt im Job payload.")
            return AgentRunResult(
                state="failed",
                agent_id=agent_id,
                job_id=job_id,
                message="workspace_root fehlt",
            )

        self._validate_workspace_root(root)

        try:
            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="started",
                    message="Agent run started",
                    progress=5,
                ),
            )

            user_request = job.title
            if job.input_payload.get("description"):
                user_request = f"{job.title}\n{job.input_payload['description']}"

            context = self._orchestration.prepare_context(
                ContextPrepareRequest(
                    user_request=user_request,
                    workspace=WorkspaceContextSnapshot(
                        root_path=root,
                        project_name=Path(root).name,
                        active_file_path=str(job.input_payload.get("active_file_path") or "") or None,
                    ),
                )
            )

            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="checkpoint",
                    message="context_prepared",
                    progress=25,
                    metadata={"intent": context.intent_summary},
                ),
            )

            list_result = self._orchestration.execute_tool(
                ToolExecutionRequest(
                    tool_id="filesystem.list_dir",
                    scope="read",
                    workspace_root=root,
                    params={"path": root},
                )
            )
            if list_result.status != "ok":
                raise RuntimeError(list_result.message)

            pack = self._context_pack.build(
                ContextPackBuildRequest(
                    workspace_root=root,
                    user_request=user_request,
                    active_file_path=str(job.input_payload.get("active_file_path") or "") or None,
                    max_files=40,
                    max_bytes_per_file=8000,
                )
            )

            readme_candidates = [Path(root) / name for name in ("README.md", "readme.md", "package.json")]
            read_outputs: list[str] = []
            for candidate in readme_candidates:
                if candidate.exists() and candidate.is_file():
                    read_result = self._orchestration.execute_tool(
                        ToolExecutionRequest(
                            tool_id="filesystem.read_text",
                            scope="read",
                            workspace_root=root,
                            params={"path": str(candidate)},
                        )
                    )
                    if read_result.status == "ok":
                        content = str(read_result.output.get("content") or "")
                        read_outputs.append(f"## {candidate.name}\n\n{content[:4000]}")

            context_pack = pack.markdown_context
            if read_outputs:
                context_pack = context_pack + "\n\n" + "\n\n".join(read_outputs)

            artifact_names: list[str] = []
            for name, content, kind in (
                ("context_pack.md", context_pack, "intermediate"),
            ):
                self._jobs.add_artifact(
                    job_id,
                    JobArtifactCreateRequest(
                        worker_id=agent_id,
                        kind=kind,
                        name=name,
                        content=content,
                        metadata={"agent_id": agent_id},
                    ),
                )
                artifact_names.append(name)

            patch_proposals: list[AgentPatchProposal] = []
            llm_skipped = False
            if self._should_run_llm(job):
                patch_proposals, llm_skipped, llm_artifacts = self._run_llm_patch_step(
                    job_id=job_id,
                    agent_id=agent_id,
                    job=job,
                    root=root,
                    user_request=user_request,
                    context_pack=context_pack,
                )
                artifact_names.extend(llm_artifacts)

            run_summary = "\n".join(
                [
                    f"Job: {job.title}",
                    f"Agent: {agent_id}",
                    f"Workspace: {root}",
                    f"Intent: {context.intent_summary}",
                    f"Tools: {', '.join(sorted(self.ALLOWED_TOOLS))}",
                    f"LLM skipped: {llm_skipped}",
                    f"Patch proposals: {len(patch_proposals)}",
                ]
            )

            self._jobs.add_artifact(
                job_id,
                JobArtifactCreateRequest(
                    worker_id=agent_id,
                    kind="output",
                    name="run_summary.md",
                    content=run_summary,
                    metadata={"agent_id": agent_id},
                ),
            )
            artifact_names.append("run_summary.md")

            needs_review = bool(job.input_payload.get("needs_review")) or bool(patch_proposals)
            if needs_review:
                self._jobs.add_waypoint(
                    job_id,
                    JobWaypointRequest(
                        worker_id=agent_id,
                        waypoint="waiting_verification",
                        message="needs_review",
                        progress=90,
                    ),
                )
                self._set_status("idle", agent_id, job_id, "Run abgeschlossen — needs_review")
                return AgentRunResult(
                    state="idle",
                    agent_id=agent_id,
                    job_id=job_id,
                    message="needs_review",
                    artifacts=artifact_names,
                    patch_proposals=patch_proposals,
                    llm_skipped=llm_skipped,
                )

            self._jobs.complete_job(
                job_id,
                JobCompleteRequest(
                    worker_id=agent_id,
                    output_payload={
                        "agent_id": agent_id,
                        "workspace_root": root,
                        "artifacts": artifact_names,
                        "patch_count": len(patch_proposals),
                        "llm_skipped": llm_skipped,
                    },
                    summary=run_summary[:500],
                ),
            )
            self._set_status("idle", agent_id, job_id, "Run abgeschlossen")
            return AgentRunResult(
                state="idle",
                agent_id=agent_id,
                job_id=job_id,
                message="completed",
                artifacts=artifact_names,
                patch_proposals=patch_proposals,
                llm_skipped=llm_skipped,
            )
        except Exception as exc:
            self._fail(job_id, agent_id, str(exc))
            return AgentRunResult(
                state="failed",
                agent_id=agent_id,
                job_id=job_id,
                message=str(exc),
            )

    def run_once(self, agent_id: str, workspace_root: str | None = None, roles: list[str] | None = None) -> AgentRunResult:
        supported = roles or ["coder", "planner", "reviewer", "tester"]
        self._set_status("running", agent_id, None, "Claiming next job")
        job = self.claim_next(agent_id, supported)
        if job is None:
            self._set_status("idle", agent_id, None, "Kein Job in Queue")
            return AgentRunResult(state="idle", agent_id=agent_id, message="Kein Job verfuegbar")

        return self.process_job(job.id, agent_id, workspace_root)

    def _should_run_llm(self, job: JobRecord) -> bool:
        payload = job.input_payload or {}
        if payload.get("enable_llm") is False:
            return False
        if payload.get("enable_llm") is True or payload.get("enable_patches"):
            return True
        return job.task_type in self.LLM_TASK_TYPES

    def _run_llm_patch_step(
        self,
        *,
        job_id: str,
        agent_id: str,
        job: JobRecord,
        root: str,
        user_request: str,
        context_pack: str,
    ) -> tuple[list[AgentPatchProposal], bool, list[str]]:
        artifact_names: list[str] = []
        if self._runtime is None:
            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="checkpoint",
                    message="llm_skipped: runtime service unavailable",
                    progress=55,
                ),
            )
            return [], True, artifact_names

        runtime_status = self._runtime.status()
        if runtime_status.state != "running":
            from app.settings.service import SettingsService
            settings = SettingsService().load()
            if (
                settings.cloudModelsEnabled
                and not settings.localOnlyModels
                and not getattr(settings, "safeMode", False)
                and self._cloud.is_available(settings)
            ):
                return self._run_cloud_patch_step(
                    job_id=job_id,
                    agent_id=agent_id,
                    job=job,
                    root=root,
                    user_request=user_request,
                    context_pack=context_pack,
                    settings=settings,
                )
            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="checkpoint",
                    message="llm_skipped: runtime not running, kein Cloud-Fallback konfiguriert",
                    progress=55,
                ),
            )
            return [], True, artifact_names

        self._jobs.add_waypoint(
            job_id,
            JobWaypointRequest(
                worker_id=agent_id,
                waypoint="checkpoint",
                message="llm_inference",
                progress=60,
            ),
        )

        chat_response = self._runtime.chat(
            RuntimeChatRequest(
                messages=[
                    RuntimeChatMessage(role="system", content=CODER_SYSTEM_PROMPT),
                    RuntimeChatMessage(
                        role="user",
                        content=build_coder_user_prompt(job.title, user_request, context_pack),
                    ),
                ],
                temperature=0.1,
                max_tokens=2048,
            )
        )
        llm_content = chat_response.message.content
        self._jobs.add_artifact(
            job_id,
            JobArtifactCreateRequest(
                worker_id=agent_id,
                kind="intermediate",
                name="llm_response.md",
                content=llm_content,
                metadata={"agent_id": agent_id, "model_id": chat_response.model_id},
            ),
        )
        artifact_names.append("llm_response.md")

        patch_proposals = parse_patch_proposals(llm_content, root)
        if patch_proposals:
            proposals_json = json.dumps(
                {"patches": [proposal.model_dump() for proposal in patch_proposals]},
                ensure_ascii=False,
                indent=2,
            )
            self._jobs.add_artifact(
                job_id,
                JobArtifactCreateRequest(
                    worker_id=agent_id,
                    kind="output",
                    name="patch_proposals.json",
                    content=proposals_json,
                    metadata={"agent_id": agent_id, "patch_count": len(patch_proposals)},
                ),
            )
            artifact_names.append("patch_proposals.json")
            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="checkpoint",
                    message="patch_proposals_ready",
                    progress=85,
                    metadata={"patch_count": len(patch_proposals)},
                ),
            )

        return patch_proposals, False, artifact_names

    def _run_cloud_patch_step(
        self,
        *,
        job_id: str,
        agent_id: str,
        job: "JobRecord",
        root: str,
        user_request: str,
        context_pack: str,
        settings: object,
    ) -> "tuple[list[AgentPatchProposal], bool, list[str]]":
        artifact_names: list[str] = []
        self._jobs.add_waypoint(
            job_id,
            JobWaypointRequest(
                worker_id=agent_id,
                waypoint="checkpoint",
                message="llm_inference_cloud_fallback",
                progress=60,
            ),
        )
        messages = [
            {"role": "system", "content": CODER_SYSTEM_PROMPT},
            {"role": "user", "content": build_coder_user_prompt(job.title, user_request, context_pack)},
        ]
        try:
            llm_content = self._cloud.chat(messages, settings=settings)  # type: ignore[arg-type]
        except RuntimeError as exc:
            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="checkpoint",
                    message=f"llm_skipped: cloud fallback fehlgeschlagen: {exc}",
                    progress=55,
                ),
            )
            return [], True, artifact_names

        self._jobs.add_artifact(
            job_id,
            JobArtifactCreateRequest(
                worker_id=agent_id,
                kind="intermediate",
                name="llm_response.md",
                content=llm_content,
                metadata={"agent_id": agent_id, "source": "cloud_fallback"},
            ),
        )
        artifact_names.append("llm_response.md")

        patch_proposals = parse_patch_proposals(llm_content, root)
        if patch_proposals:
            proposals_json = json.dumps(
                {"patches": [proposal.model_dump() for proposal in patch_proposals]},
                ensure_ascii=False,
                indent=2,
            )
            self._jobs.add_artifact(
                job_id,
                JobArtifactCreateRequest(
                    worker_id=agent_id,
                    kind="output",
                    name="patch_proposals.json",
                    content=proposals_json,
                    metadata={"agent_id": agent_id, "patch_count": len(patch_proposals)},
                ),
            )
            artifact_names.append("patch_proposals.json")
            self._jobs.add_waypoint(
                job_id,
                JobWaypointRequest(
                    worker_id=agent_id,
                    waypoint="checkpoint",
                    message="patch_proposals_ready",
                    progress=85,
                    metadata={"patch_count": len(patch_proposals)},
                ),
            )

        return patch_proposals, False, artifact_names

    def _validate_workspace_root(self, workspace_root: str) -> None:
        root = Path(workspace_root).resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("workspace_root existiert nicht oder ist kein Verzeichnis.")

    def _fail(self, job_id: str, agent_id: str, message: str) -> None:
        try:
            self._jobs.fail_job(
                job_id,
                JobFailRequest(worker_id=agent_id, error_message=message[:4000]),
            )
        except Exception:
            pass
        self._set_status("failed", agent_id, job_id, message)

    def _set_status(
        self,
        state: AgentRunnerState,
        agent_id: str,
        job_id: str | None,
        message: str,
    ) -> None:
        self._status = AgentRunnerStatus(
            state=state,
            agent_id=agent_id,
            last_job_id=job_id,
            last_message=message,
            last_run_at=datetime.now(UTC).isoformat(),
        )
