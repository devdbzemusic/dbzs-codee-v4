"""Runtime Binding Adapter for Agent Workbench utilizing local model execution."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from app.runtime.service import RuntimeService, RuntimeChatRequest, RuntimeChatMessage
from app.agent_workbench.models import AgentRun

if TYPE_CHECKING:
    from app.agent_workbench.repository import AgentWorkbenchRepository

logger = logging.getLogger(__name__)


class AgentRuntimeAdapter(Protocol):
    """Protocol defining the interface for workbench runtime operations."""

    def verify_runtime(self, run: AgentRun) -> RuntimeVerificationResult:
        """Verify the health and readiness of the execution backend."""
        ...

    def complete_turn(self, run: AgentRun, messages: list[Any], tools: list[Any] | None = None) -> RuntimeTurnResponse:
        """Complete a single LLM assistant turn using the active runtime."""
        ...


class RuntimeVerificationResult:
    """Represents the outcome of a runtime verification step."""

    def __init__(
        self,
        verified: bool,
        provider: str | None = None,
        model_id: str | None = None,
        model_name: str | None = None,
        endpoint: str | None = None,
        pid: int | None = None,
        health_state: str = "unknown",
        error_message: str | None = None,
    ) -> None:
        self.verified = verified
        self.provider = provider
        self.model_id = model_id
        self.model_name = model_name
        self.endpoint = endpoint
        self.pid = pid
        self.health_state = health_state
        self.error_message = error_message


class RuntimeTurnResponse:
    """Represents the raw response from an LLM execution turn."""

    def __init__(self, content: str, model_id: str | None = None, model_name: str | None = None) -> None:
        self.content = content
        self.model_id = model_id
        self.model_name = model_name


class DefaultAgentRuntimeAdapter:
    """Production implementation of AgentRuntimeAdapter communicating with RuntimeService."""

    def __init__(self, runtime_service: RuntimeService, repo: AgentWorkbenchRepository) -> None:
        self._runtime_service = runtime_service
        self._repo = repo

    def verify_runtime(self, run: AgentRun) -> RuntimeVerificationResult:
        """
        Verifies that RuntimeService is active and hosts the requested model.
        Updates model binding states in database.
        """
        try:
            status = self._runtime_service.status()
            now_iso = datetime.now(UTC).isoformat()

            # If not running, attempt starting the model defined on the run
            if status.state != "running":
                model_id = run.model_id or "default"
                logger.info(f"Runtime is not running. Attempting to start model: {model_id}")
                status = self._runtime_service.start_model(model_id)

            if status.state == "running":
                # Save status in Database via updating AgentRun columns
                run.execution_backend = "local_runtime"
                run.runtime_provider = status.provider
                run.runtime_model_id = status.model_id
                run.runtime_model_name = status.model_name
                run.runtime_endpoint = status.endpoint
                run.runtime_pid = status.pid
                run.runtime_health_state = "healthy"
                run.runtime_verified_at = now_iso

                self._repo.update_run(run)

                return RuntimeVerificationResult(
                    verified=True,
                    provider=status.provider,
                    model_id=status.model_id,
                    model_name=status.model_name,
                    endpoint=status.endpoint,
                    pid=status.pid,
                    health_state="healthy",
                )
            else:
                err_msg = status.message or "Local runtime failed to boot or is in error state."
                run.execution_backend = "simulation"
                run.runtime_health_state = "error"
                run.runtime_verified_at = now_iso
                self._repo.update_run(run)

                return RuntimeVerificationResult(
                    verified=False,
                    health_state="error",
                    error_message=err_msg,
                )

        except Exception as exc:
            logger.exception("Failed to verify workbench runtime connection.")
            return RuntimeVerificationResult(
                verified=False,
                health_state="error",
                error_message=str(exc),
            )

    def complete_turn(self, run: AgentRun, messages: list[Any], tools: list[Any] | None = None) -> RuntimeTurnResponse:
        """Executes a single chat completion turn using the active runtime service."""
        # Convert raw tool and messages dictionary list to RuntimeChatMessage and request objects
        chat_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            chat_messages.append(RuntimeChatMessage(role=role, content=content))

        # Build request
        req = RuntimeChatRequest(
            messages=chat_messages,
            temperature=0.2,
            max_tokens=2048,
            tools=tools,
        )

        resp = self._runtime_service.chat(req)
        return RuntimeTurnResponse(
            content=resp.message.content,
            model_id=resp.model_id,
            model_name=resp.model_name,
        )
