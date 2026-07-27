"""Python / uv / pytest project adapter."""

from __future__ import annotations

from pathlib import Path

from app.project_adapters.base import ProjectAdapter, ProjectCommand, ProjectDetection


class PythonAdapter(ProjectAdapter):
    id = "python"
    display_name = "Python / uv / pytest"
    markers = ["pyproject.toml", "uv.lock", "requirements.txt"]

    def detect(self, workspace: Path) -> ProjectDetection:
        found = self._markers_present(workspace)
        detected = bool(found)
        return ProjectDetection(
            adapter_id=self.id,
            display_name=self.display_name,
            detected=detected,
            markers=found,
            commands=self.list_commands(workspace) if detected else [],
        )

    def list_commands(self, workspace: Path) -> list[ProjectCommand]:
        commands = [
            ProjectCommand("uv.pytest", "uv run pytest", ["uv", "run", "pytest"]),
        ]
        if (workspace / "pyproject.toml").exists():
            commands.append(
                ProjectCommand("uv.ruff", "uv run ruff check", ["uv", "run", "ruff", "check"]),
            )
        return commands
