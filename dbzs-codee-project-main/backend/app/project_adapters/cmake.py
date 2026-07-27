"""CMake / C++ / JUCE project adapter."""

from __future__ import annotations

import json
from pathlib import Path

from app.project_adapters.base import ProjectAdapter, ProjectCommand, ProjectDetection


class CmakeAdapter(ProjectAdapter):
    id = "cmake"
    display_name = "CMake / C++"
    markers = ["CMakeLists.txt", "CMakePresets.json"]

    def detect(self, workspace: Path) -> ProjectDetection:
        found = self._markers_present(workspace)
        detected = "CMakeLists.txt" in found
        return ProjectDetection(
            adapter_id=self.id,
            display_name=self.display_name,
            detected=detected,
            markers=found,
            commands=self.list_commands(workspace) if detected else [],
        )

    def list_commands(self, workspace: Path) -> list[ProjectCommand]:
        commands: list[ProjectCommand] = []
        presets_file = workspace / "CMakePresets.json"
        if presets_file.exists():
            try:
                data = json.loads(presets_file.read_text(encoding="utf-8"))
                configure_presets = data.get("configurePresets", [])
                for preset in configure_presets:
                    name = preset.get("name")
                    if not name:
                        continue
                    commands.append(
                        ProjectCommand(
                            f"cmake.configure.{name}",
                            f"cmake --preset {name}",
                            ["cmake", "--preset", name],
                        )
                    )
                build_presets = data.get("buildPresets", [])
                for preset in build_presets:
                    name = preset.get("name")
                    if not name:
                        continue
                    commands.append(
                        ProjectCommand(
                            f"cmake.build.{name}",
                            f"cmake --build --preset {name}",
                            ["cmake", "--build", "--preset", name],
                        )
                    )
                test_presets = data.get("testPresets", [])
                for preset in test_presets:
                    name = preset.get("name")
                    if not name:
                        continue
                    commands.append(
                        ProjectCommand(
                            f"ctest.{name}",
                            f"ctest --preset {name}",
                            ["ctest", "--preset", name],
                        )
                    )
            except (json.JSONDecodeError, OSError):
                pass
        if not commands and (workspace / "CMakeLists.txt").exists():
            commands.append(
                ProjectCommand("cmake.configure", "cmake -B build", ["cmake", "-B", "build"]),
            )
        return commands
