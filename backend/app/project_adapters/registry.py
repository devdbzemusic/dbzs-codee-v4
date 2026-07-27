"""Registry for project type adapters."""

from __future__ import annotations

from pathlib import Path

from app.project_adapters.base import ProjectAdapter, ProjectDetection
from app.project_adapters.cmake import CmakeAdapter
from app.project_adapters.gradle import GradleAdapter
from app.project_adapters.node import NodeAdapter
from app.project_adapters.python import PythonAdapter
from app.project_adapters.rust import RustAdapter

_ADAPTERS: list[ProjectAdapter] = [
    NodeAdapter(),
    PythonAdapter(),
    RustAdapter(),
    GradleAdapter(),
    CmakeAdapter(),
]


def list_adapters() -> list[ProjectAdapter]:
    return list(_ADAPTERS)


def detect_project(workspace_root: str | Path) -> list[ProjectDetection]:
    workspace = Path(workspace_root).resolve()
    results: list[ProjectDetection] = []
    for adapter in _ADAPTERS:
        detection = adapter.detect(workspace)
        if detection.detected:
            detection.modules = adapter.discover_modules(workspace)
            detection.commands = adapter.list_commands(workspace)
            results.append(detection)
    return results


def get_adapter(adapter_id: str) -> ProjectAdapter | None:
    for adapter in _ADAPTERS:
        if adapter.id == adapter_id:
            return adapter
    return None
