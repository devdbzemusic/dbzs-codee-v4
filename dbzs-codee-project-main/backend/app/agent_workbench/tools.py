"""Sandboxed read-only tools for Agent Workbench."""

from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.agent_workbench.context_budget import ContextBudget
from app.agent_workbench.models import AgentToolCall
from app.agent_workbench.repository import AgentWorkbenchRepository
from app.project_adapters.registry import detect_project
from app.core.workspace_paths import resolve_workspace_path
from app.core.context_policy import is_context_path_allowed

IGNORE_DIRS = {"__pycache__", ".venv"}
MAX_LIST_ENTRIES = 200
MAX_SEARCH_FILES = 100
MAX_READ_BYTES = 16_384
MAX_STDOUT_TAIL = 4096

KNOWN_TOOLS = frozenset({
    "filesystem.list",
    "filesystem.search",
    "filesystem.read",
    "project.detect",
    "git.status",
    "git.diff",
})


@dataclass
class ToolResult:
    status: str
    output: dict[str, Any]
    message: str = ""
    stdout_tail: str | None = None
    stderr_tail: str | None = None
    exit_code: int | None = None


def resolve_safe_path(workspace_root: str, candidate: str | None) -> Path:
    if not workspace_root:
        raise ValueError("workspace_root ist erforderlich.")
    return resolve_workspace_path(workspace_root, candidate or ".", allow_missing=True)


def _is_binary(path: Path) -> bool:
    try:
        chunk = path.read_bytes()[:8192]
        return b"\0" in chunk
    except OSError:
        return True


class AgentToolRuntime:
    """Execute sandboxed tools and persist tool calls."""

    def __init__(
        self,
        repo: AgentWorkbenchRepository,
        *,
        simulate_llm: bool = False,
    ) -> None:
        self._repo = repo
        self._simulate_llm = simulate_llm
        self._budgets: dict[str, ContextBudget] = {}

    def get_budget(self, step_id: str) -> ContextBudget:
        if step_id not in self._budgets:
            self._budgets[step_id] = ContextBudget()
        return self._budgets[step_id]

    def execute_tool(
        self,
        *,
        run_id: str,
        step_id: str,
        tool_id: str,
        arguments: dict[str, Any],
        workspace_root: str,
        on_event: Any | None = None,
    ) -> AgentToolCall:
        now = self._repo.now()
        tool_call = AgentToolCall(
            id=self._repo.make_tool_call_id(),
            run_id=run_id,
            step_id=step_id,
            tool_id=tool_id,
            status="pending",
            arguments_json=self._repo.dumps(arguments),
            created_at=now,
        )
        self._repo.insert_tool_call(tool_call)

        if tool_id not in KNOWN_TOOLS:
            self._repo.update_tool_call(
                tool_call.id,
                status="failed",
                finished_at=self._repo.now(),
                error_message=f"Unbekanntes Tool: {tool_id}",
            )
            tool_call.status = "failed"
            tool_call.error_message = f"Unbekanntes Tool: {tool_id}"
            return tool_call

        self._repo.update_tool_call(tool_call.id, status="running", started_at=self._repo.now())

        try:
            result = self._dispatch(tool_id, arguments, workspace_root, step_id)
            self._repo.update_tool_call(
                tool_call.id,
                status="completed" if result.status == "ok" else "failed",
                result_json=self._repo.dumps(result.output),
                stdout_tail=result.stdout_tail,
                stderr_tail=result.stderr_tail,
                exit_code=result.exit_code,
                finished_at=self._repo.now(),
                error_message=result.message if result.status != "ok" else None,
            )
            tool_call.status = "completed" if result.status == "ok" else "failed"
            tool_call.result_json = self._repo.dumps(result.output)
        except Exception as exc:
            self._repo.update_tool_call(
                tool_call.id,
                status="failed",
                finished_at=self._repo.now(),
                error_message=str(exc),
            )
            tool_call.status = "failed"
            tool_call.error_message = str(exc)

        return tool_call

    def _dispatch(
        self,
        tool_id: str,
        arguments: dict[str, Any],
        workspace_root: str,
        step_id: str,
    ) -> ToolResult:
        if tool_id == "filesystem.list":
            return self._filesystem_list(arguments, workspace_root)
        if tool_id == "filesystem.search":
            return self._filesystem_search(arguments, workspace_root, step_id)
        if tool_id == "filesystem.read":
            return self._filesystem_read(arguments, workspace_root, step_id)
        if tool_id == "project.detect":
            return self._project_detect(workspace_root)
        if tool_id == "git.status":
            return self._git_status(workspace_root)
        if tool_id == "git.diff":
            return self._git_diff(arguments, workspace_root)
        return ToolResult(status="error", output={}, message=f"Tool nicht implementiert: {tool_id}")

    def _filesystem_list(self, arguments: dict[str, Any], workspace_root: str) -> ToolResult:
        target = resolve_safe_path(workspace_root, str(arguments.get("path") or "."))
        if not target.exists():
            return ToolResult(status="error", output={}, message="Pfad nicht gefunden.")
        if not target.is_dir():
            return ToolResult(status="error", output={}, message="Kein Verzeichnis.")

        entries: list[dict[str, str]] = []
        for item in sorted(target.iterdir()):
            rel = str(item.relative_to(Path(workspace_root).resolve()))
            if item.name in IGNORE_DIRS or not is_context_path_allowed(rel):
                continue
            entries.append({
                "name": item.name,
                "path": rel.replace("\\", "/"),
                "type": "dir" if item.is_dir() else "file",
            })
            if len(entries) >= MAX_LIST_ENTRIES:
                break

        return ToolResult(
            status="ok",
            output={"path": str(target), "entries": entries, "count": len(entries)},
            message="Verzeichnis gelistet.",
        )

    def _filesystem_search(
        self,
        arguments: dict[str, Any],
        workspace_root: str,
        step_id: str,
    ) -> ToolResult:
        budget = self.get_budget(step_id)
        query = str(arguments.get("query") or "").strip()
        glob_pattern = str(arguments.get("glob") or "**/*")
        search_path = resolve_safe_path(workspace_root, str(arguments.get("path") or "."))
        root = Path(workspace_root).resolve()

        matches: list[dict[str, Any]] = []
        files_scanned = 0

        for path in search_path.glob(glob_pattern):
            if files_scanned >= MAX_SEARCH_FILES:
                break
            if not path.is_file():
                continue
            if any(part in IGNORE_DIRS for part in path.parts) or not is_context_path_allowed(path.relative_to(root)):
                continue
            files_scanned += 1
            rel = str(path.relative_to(root)).replace("\\", "/")
            if query:
                if query.lower() not in path.name.lower():
                    try:
                        if _is_binary(path):
                            continue
                        text = path.read_text(encoding="utf-8", errors="replace")
                        if query.lower() not in text.lower():
                            continue
                    except OSError:
                        continue
            matches.append({"path": rel, "name": path.name})
            if len(matches) >= budget.max_search_matches:
                break

        ok, msg = budget.can_search(len(matches))
        if not ok:
            return ToolResult(status="error", output={}, message=msg)
        budget.record_search(len(matches))

        return ToolResult(
            status="ok",
            output={"matches": matches, "count": len(matches), "query": query},
            message="Suche abgeschlossen.",
        )

    def _filesystem_read(
        self,
        arguments: dict[str, Any],
        workspace_root: str,
        step_id: str,
    ) -> ToolResult:
        budget = self.get_budget(step_id)
        target = resolve_safe_path(workspace_root, str(arguments.get("path") or ""))
        if not target.exists() or not target.is_file():
            return ToolResult(status="error", output={}, message="Datei nicht gefunden.")
        if _is_binary(target):
            return ToolResult(status="error", output={}, message="Binaerdatei nicht unterstuetzt.")

        rel = str(target.relative_to(Path(workspace_root).resolve())).replace("\\", "/")
        if not is_context_path_allowed(rel):
            return ToolResult(status="error", output={}, message="Pfad ist durch die Context-Policy ausgeschlossen.")
        raw = target.read_text(encoding="utf-8", errors="replace")
        start_line = int(arguments.get("start_line") or 1)
        end_line = int(arguments.get("end_line") or 0)
        max_bytes = int(arguments.get("max_bytes") or MAX_READ_BYTES)
        max_bytes = max(256, min(max_bytes, budget.max_file_bytes))

        lines = raw.splitlines()
        if end_line <= 0:
            end_line = len(lines)
        start_line, end_line = budget.clamp_read_range(start_line, end_line)
        selected = "\n".join(lines[start_line - 1 : end_line])
        content = selected[:max_bytes]
        byte_size = len(content.encode("utf-8"))

        ok, msg = budget.can_read_file(rel, byte_size)
        if not ok:
            return ToolResult(status="error", output={}, message=msg)
        budget.record_file_read(rel, byte_size)

        return ToolResult(
            status="ok",
            output={
                "path": rel,
                "content": content,
                "start_line": start_line,
                "end_line": end_line,
                "truncated": len(content) < len(selected) or end_line < len(lines),
                "line_count": len(lines),
            },
            message="Datei gelesen.",
        )

    def _project_detect(self, workspace_root: str) -> ToolResult:
        detections = detect_project(workspace_root)
        return ToolResult(
            status="ok",
            output={
                "adapters": [
                    {
                        "adapter_id": d.adapter_id,
                        "display_name": d.display_name,
                        "markers": d.markers,
                        "modules": [{"name": m.name, "path": m.path} for m in d.modules],
                        "commands": [
                            {"command_id": c.command_id, "display_name": c.display_name}
                            for c in d.commands
                        ],
                    }
                    for d in detections
                ],
                "count": len(detections),
            },
            message="Projekt erkannt." if detections else "Kein bekannter Projekttyp.",
        )

    def _git_status(self, workspace_root: str) -> ToolResult:
        root = Path(workspace_root).resolve()
        if not (root / ".git").exists():
            return ToolResult(status="ok", output={"is_repo": False, "lines": []}, message="Kein Git-Repo.")

        proc = subprocess.run(
            ["git", "status", "--porcelain", "-b"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        lines = proc.stdout.strip().splitlines() if proc.stdout else []
        return ToolResult(
            status="ok" if proc.returncode == 0 else "error",
            output={"is_repo": True, "lines": lines, "branch_line": lines[0] if lines else ""},
            message="Git-Status gelesen.",
            stdout_tail=(proc.stdout or "")[-MAX_STDOUT_TAIL:],
            stderr_tail=(proc.stderr or "")[-MAX_STDOUT_TAIL:],
            exit_code=proc.returncode,
        )

    def _git_diff(self, arguments: dict[str, Any], workspace_root: str) -> ToolResult:
        root = Path(workspace_root).resolve()
        if not (root / ".git").exists():
            return ToolResult(status="error", output={}, message="Kein Git-Repo.")

        path_arg = arguments.get("path")
        cmd = ["git", "diff", "--"]
        if path_arg:
            safe = resolve_safe_path(workspace_root, str(path_arg))
            rel = str(safe.relative_to(root)).replace("\\", "/")
            cmd.append(rel)

        proc = subprocess.run(
            cmd,
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        diff_text = proc.stdout or ""
        if len(diff_text) > MAX_READ_BYTES:
            diff_text = diff_text[:MAX_READ_BYTES]

        return ToolResult(
            status="ok" if proc.returncode == 0 else "error",
            output={"diff": diff_text, "truncated": len(proc.stdout or "") > MAX_READ_BYTES},
            message="Git-Diff gelesen.",
            stdout_tail=diff_text[-MAX_STDOUT_TAIL:],
            stderr_tail=(proc.stderr or "")[-MAX_STDOUT_TAIL:],
            exit_code=proc.returncode,
        )


def sha256_content(content: str) -> str:
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def compute_diff_stats(old: str, new: str) -> tuple[str, int, int]:
    old_lines = old.splitlines()
    new_lines = new.splitlines()
    added = sum(1 for line in new_lines if line not in old_lines)
    removed = sum(1 for line in old_lines if line not in new_lines)
    diff_lines: list[str] = []
    for line in old_lines:
        if line not in new_lines:
            diff_lines.append(f"- {line}")
    for line in new_lines:
        if line not in old_lines:
            diff_lines.append(f"+ {line}")
    return "\n".join(diff_lines[:500]), added, removed
