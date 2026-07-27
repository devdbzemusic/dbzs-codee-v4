"""Rust / Cargo project adapter."""

from __future__ import annotations

from pathlib import Path

from app.project_adapters.base import ProjectAdapter, ProjectCommand, ProjectDetection


class RustAdapter(ProjectAdapter):
    id = "rust"
    display_name = "Rust / Cargo"
    markers = ["Cargo.toml", "Cargo.lock"]

    def detect(self, workspace: Path) -> ProjectDetection:
        found = self._markers_present(workspace)
        detected = "Cargo.toml" in found
        return ProjectDetection(
            adapter_id=self.id,
            display_name=self.display_name,
            detected=detected,
            markers=found,
            commands=self.list_commands(workspace) if detected else [],
        )

    def list_commands(self, workspace: Path) -> list[ProjectCommand]:
        return [
            ProjectCommand("cargo.check", "cargo check", ["cargo", "check"]),
            ProjectCommand("cargo.test", "cargo test", ["cargo", "test"]),
            ProjectCommand(
                "cargo.clippy",
                "cargo clippy",
                ["cargo", "clippy", "--all-targets", "--all-features"],
            ),
        ]
