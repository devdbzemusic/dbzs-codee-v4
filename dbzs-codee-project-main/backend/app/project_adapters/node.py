"""Node / pnpm / TypeScript project adapter."""

from __future__ import annotations

import json
from pathlib import Path

from app.project_adapters.base import ProjectAdapter, ProjectCommand, ProjectDetection


class NodeAdapter(ProjectAdapter):
    id = "node"
    display_name = "Node / pnpm / TypeScript"
    markers = ["package.json", "pnpm-lock.yaml", "tsconfig.json"]

    def detect(self, workspace: Path) -> ProjectDetection:
        found = self._markers_present(workspace)
        detected = "package.json" in found
        return ProjectDetection(
            adapter_id=self.id,
            display_name=self.display_name,
            detected=detected,
            markers=found,
            modules=[],
            commands=self.list_commands(workspace) if detected else [],
        )

    def list_commands(self, workspace: Path) -> list[ProjectCommand]:
        commands = [
            ProjectCommand("pnpm.typecheck", "pnpm typecheck", ["pnpm", "typecheck"]),
            ProjectCommand("pnpm.test", "pnpm test", ["pnpm", "test"]),
            ProjectCommand("pnpm.build", "pnpm build", ["pnpm", "build"]),
        ]
        pkg = workspace / "package.json"
        if pkg.exists():
            try:
                data = json.loads(pkg.read_text(encoding="utf-8"))
                scripts = data.get("scripts", {})
                allowlist = {"typecheck", "test", "build", "lint"}
                for name in scripts:
                    if name in allowlist:
                        cmd_id = f"npm.script.{name}"
                        if not any(c.command_id == cmd_id for c in commands):
                            commands.append(
                                ProjectCommand(
                                    cmd_id,
                                    f"pnpm {name}",
                                    ["pnpm", name],
                                )
                            )
            except (json.JSONDecodeError, OSError):
                pass
        return commands
