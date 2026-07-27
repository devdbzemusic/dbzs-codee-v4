"""Portable, redacted task manifests alongside the transactional Workbench database."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from app.agent_workbench.models import AgentRun, AgentStep

SCHEMA_VERSION = 1
_IGNORED_ANYWHERE = {".git", ".codee", "node_modules", ".venv",
            "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "playwright-report", "test-results"}
_IGNORED_ROOT_GENERATED = {"dist", "build", "out", "target"}


class TaskManifestStore:
    def task_dir(self, run: AgentRun) -> Path:
        return Path(run.workspace_root) / ".codee" / "tasks" / run.id

    def backup(self, run: AgentRun) -> Path | None:
        source = self.task_dir(run)
        if not source.exists():
            return None
        backup = source.with_name(source.name + ".rollback")
        shutil.rmtree(backup, ignore_errors=True)
        shutil.copytree(source, backup)
        return backup

    def restore_backup(self, run: AgentRun, backup: Path | None) -> None:
        if backup is None:
            shutil.rmtree(self.task_dir(run), ignore_errors=True)
            return
        shutil.rmtree(self.task_dir(run), ignore_errors=True)
        backup.replace(self.task_dir(run))

    @staticmethod
    def discard_backup(backup: Path | None) -> None:
        if backup is not None:
            shutil.rmtree(backup, ignore_errors=True)

    def materialize(self, run: AgentRun, steps: list[AgentStep], events: list[Any] | None = None) -> None:
        target = self.task_dir(run)
        for name in ("patches", "test-results", "artifacts"):
            (target / name).mkdir(parents=True, exist_ok=True)
        snapshot = workspace_snapshot(Path(run.workspace_root))
        self._write(target / "task.json", {
            "schemaVersion": SCHEMA_VERSION, "taskId": run.id, "originalRequest": run.goal,
            "status": run.status, "modelId": run.model_id, "workspaceHash": snapshot["hash"],
            "fileHashes": snapshot["files"], "updatedAt": run.updated_at,
        })
        self._write(target / "plan.json", {
            "schemaVersion": SCHEMA_VERSION, "taskId": run.id,
            "steps": [{"id": step.id, "title": step.title, "description": step.description,
                       "status": step.status, "dependencies": json.loads(step.depends_on_json)} for step in steps],
        })
        if events is not None:
            lines = [json.dumps({"sequence": event.sequence, "type": event.event_type,
                                 "summary": event.summary, "createdAt": event.created_at}, ensure_ascii=False)
                     for event in events]
            (target / "events.jsonl").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    def validate(self, run: AgentRun) -> list[str]:
        manifest_path = self.task_dir(run) / "task.json"
        if not manifest_path.exists():
            return ["task_manifest_missing"]
        stored = json.loads(manifest_path.read_text(encoding="utf-8"))
        current = workspace_snapshot(Path(run.workspace_root))
        before = stored.get("fileHashes", {})
        return sorted(path for path in set(before) | set(current["files"])
                      if before.get(path) != current["files"].get(path))

    @staticmethod
    def _write(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
        temp.replace(path)


def workspace_snapshot(root: Path) -> dict[str, Any]:
    files: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        parts = path.relative_to(root).parts
        if (not path.is_file() or any(part in _IGNORED_ANYWHERE for part in parts)
                or (parts and parts[0] in _IGNORED_ROOT_GENERATED)):
            continue
        relative = path.relative_to(root).as_posix()
        try:
            files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
    digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {"hash": digest, "files": files}
