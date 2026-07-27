"""Android / Gradle project adapter."""

from __future__ import annotations

import re
from pathlib import Path

from app.project_adapters.base import ProjectAdapter, ProjectCommand, ProjectDetection, ProjectModule


class GradleAdapter(ProjectAdapter):
    id = "gradle"
    display_name = "Android / Gradle"
    markers = [
        "settings.gradle.kts",
        "build.gradle.kts",
        "gradlew.bat",
        "gradle/libs.versions.toml",
    ]

    def detect(self, workspace: Path) -> ProjectDetection:
        found = self._markers_present(workspace)
        detected = any(
            m in found
            for m in ("settings.gradle.kts", "build.gradle.kts", "gradlew.bat")
        )
        modules = self.discover_modules(workspace) if detected else []
        return ProjectDetection(
            adapter_id=self.id,
            display_name=self.display_name,
            detected=detected,
            markers=found,
            modules=modules,
            commands=self.list_commands(workspace) if detected else [],
        )

    def discover_modules(self, workspace: Path) -> list[ProjectModule]:
        modules: list[ProjectModule] = []
        for name in ("settings.gradle.kts", "settings.gradle"):
            settings = workspace / name
            if not settings.exists():
                continue
            try:
                text = settings.read_text(encoding="utf-8", errors="replace")
                for match in re.finditer(r'include\s*\(\s*"([^"]+)"\s*\)', text):
                    mod = match.group(1).replace(":", "/")
                    modules.append(ProjectModule(name=match.group(1), path=mod))
            except OSError:
                pass
        return modules

    def list_commands(self, workspace: Path) -> list[ProjectCommand]:
        gradlew = "gradlew.bat" if (workspace / "gradlew.bat").exists() else "gradlew"
        return [
            ProjectCommand("gradle.projects", f"{gradlew} projects", [gradlew, "projects"]),
            ProjectCommand("gradle.assembleDebug", f"{gradlew} assembleDebug", [gradlew, "assembleDebug"]),
            ProjectCommand("gradle.test", f"{gradlew} test", [gradlew, "test"]),
            ProjectCommand("gradle.lint", f"{gradlew} lint", [gradlew, "lint"]),
        ]
