"""Project type adapters for build/test command discovery."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ProjectCommand:
    command_id: str
    display_name: str
    argv: list[str]
    cwd_relative: str = "."


@dataclass
class ProjectModule:
    name: str
    path: str


@dataclass
class ProjectDetection:
    adapter_id: str
    display_name: str
    detected: bool
    markers: list[str] = field(default_factory=list)
    modules: list[ProjectModule] = field(default_factory=list)
    commands: list[ProjectCommand] = field(default_factory=list)


@dataclass
class Diagnostic:
    severity: str
    message: str
    file_path: str | None = None
    line: int | None = None
    column: int | None = None
    code: str | None = None
    source: str | None = None
    command_run_id: str | None = None


class ProjectAdapter(ABC):
    id: str
    display_name: str
    markers: list[str]

    @abstractmethod
    def detect(self, workspace: Path) -> ProjectDetection:
        ...

    def discover_modules(self, workspace: Path) -> list[ProjectModule]:
        return []

    def list_commands(self, workspace: Path) -> list[ProjectCommand]:
        return []

    def recommended_checks(self, workspace: Path, changed_files: list[str]) -> list[ProjectCommand]:
        return self.list_commands(workspace)[:1]

    def parse_diagnostics(self, command_result: dict[str, Any]) -> list[Diagnostic]:
        return []

    def _markers_present(self, workspace: Path) -> list[str]:
        found: list[str] = []
        for marker in self.markers:
            if (workspace / marker).exists():
                found.append(marker)
        return found
