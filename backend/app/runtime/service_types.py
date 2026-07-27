from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Protocol

from app.runtime.schemas import RuntimeSlotId


@dataclass(slots=True)
class RuntimeStreamContext:
    slot_id: RuntimeSlotId
    model_id: str | None = None
    model_name: str | None = None
    endpoint: str | None = None
    fallback_reason: str | None = None


class ManagedProcess(Protocol):
    pid: int

    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...


class ProcessRunner(Protocol):
    def start(self, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> ManagedProcess: ...


class ChatClient(Protocol):
    def complete(self, endpoint: str, payload: dict) -> str: ...

    def stream(self, endpoint: str, payload: dict) -> Iterator[str]: ...
