from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from typing import Literal

from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest
from app.runtime.service import RuntimeService

StepStatus = Literal["pass", "fail", "skip"]


@dataclass
class RuntimeModelTestStep:
    id: str
    label: str
    status: StepStatus
    detail: str
    duration_ms: float | None = None


@dataclass
class RuntimeModelTestReport:
    overall: Literal["pass", "fail"]
    model_id: str | None
    model_name: str | None
    provider: str | None
    steps: list[RuntimeModelTestStep]

    def to_dict(self) -> dict:
        return {
            "overall": self.overall,
            "model_id": self.model_id,
            "model_name": self.model_name,
            "provider": self.provider,
            "steps": [asdict(step) for step in self.steps],
        }


def run_model_test(service: RuntimeService) -> RuntimeModelTestReport:
    steps: list[RuntimeModelTestStep] = []
    status = service.status()

    if status.state != "running" or not status.endpoint:
        steps.append(
            RuntimeModelTestStep(
                id="runtime-status",
                label="Runtime-Status",
                status="fail",
                detail=status.message or "Runtime ist nicht aktiv.",
            )
        )
        return RuntimeModelTestReport(
            overall="fail",
            model_id=status.model_id,
            model_name=status.model_name,
            provider=status.provider,
            steps=steps,
        )

    steps.append(
        RuntimeModelTestStep(
            id="runtime-status",
            label="Runtime-Status",
            status="pass",
            detail=f"{status.provider or 'runtime'} laeuft auf Port {status.port} ({status.endpoint})",
        )
    )

    chat_request = RuntimeChatRequest(
        messages=[RuntimeChatMessage(role="user", content="Antworte nur mit dem Wort OK.")],
        temperature=0.0,
        max_tokens=8,
    )

    started = time.monotonic()
    try:
        chat_response = service.chat(chat_request)
        elapsed_ms = round((time.monotonic() - started) * 1000, 1)
        content = chat_response.message.content.strip()
        if not content:
            steps.append(
                RuntimeModelTestStep(
                    id="chat-complete",
                    label="Chat (non-stream)",
                    status="fail",
                    detail="Leere Antwort vom Modell.",
                    duration_ms=elapsed_ms,
                )
            )
        else:
            steps.append(
                RuntimeModelTestStep(
                    id="chat-complete",
                    label="Chat (non-stream)",
                    status="pass",
                    detail=f"Antwort: {content[:120]}",
                    duration_ms=elapsed_ms,
                )
            )
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - started) * 1000, 1)
        steps.append(
            RuntimeModelTestStep(
                id="chat-complete",
                label="Chat (non-stream)",
                status="fail",
                detail=str(exc),
                duration_ms=elapsed_ms,
            )
        )

    started = time.monotonic()
    try:
        chunks: list[str] = []
        for chunk in service.chat_stream(chat_request):
            chunks.append(chunk)
            if sum(len(entry) for entry in chunks) >= 1:
                break

        elapsed_ms = round((time.monotonic() - started) * 1000, 1)
        preview = "".join(chunks).strip()
        if not preview:
            steps.append(
                RuntimeModelTestStep(
                    id="chat-stream",
                    label="Chat (stream)",
                    status="fail",
                    detail="Kein Stream-Token empfangen.",
                    duration_ms=elapsed_ms,
                )
            )
        else:
            steps.append(
                RuntimeModelTestStep(
                    id="chat-stream",
                    label="Chat (stream)",
                    status="pass",
                    detail=f"Erster Stream-Output: {preview[:120]}",
                    duration_ms=elapsed_ms,
                )
            )
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - started) * 1000, 1)
        steps.append(
            RuntimeModelTestStep(
                id="chat-stream",
                label="Chat (stream)",
                status="fail",
                detail=str(exc),
                duration_ms=elapsed_ms,
            )
        )

    overall: Literal["pass", "fail"] = "pass" if all(step.status == "pass" for step in steps) else "fail"
    return RuntimeModelTestReport(
        overall=overall,
        model_id=status.model_id,
        model_name=status.model_name,
        provider=status.provider,
        steps=steps,
    )
