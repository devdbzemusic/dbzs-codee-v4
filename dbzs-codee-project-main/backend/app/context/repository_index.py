"""Versionierter, hashbasierter Repository-Index für Context Intelligence."""

from __future__ import annotations

import ast
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.context_pack.models import ContextPackBuildRequest
from app.context_pack.service import ContextPackService

SCHEMA_VERSION = 1


class RepositoryIndexService:
    def __init__(self, pack_service: ContextPackService | None = None) -> None:
        self._pack = pack_service or ContextPackService()

    def build(self, workspace_root: str) -> dict[str, Any]:
        root = Path(workspace_root).resolve()
        target = root / ".codee" / "repo-map.json"
        previous = self._read(target)
        previous_files = {item["path"]: item for item in previous.get("files", [])}
        repo = self._pack.build(ContextPackBuildRequest(
            workspace_root=str(root), user_request="repository structure symbols tests configuration",
            max_files=500, repo_map_token_budget=60000,
        )).repo_map
        files: list[dict[str, Any]] = []
        reused = 0
        for entry in repo.files:
            path = root / entry.path
            try:
                content = path.read_bytes()
            except OSError:
                continue
            digest = hashlib.sha256(content).hexdigest()
            cached = previous_files.get(entry.path)
            if cached and cached.get("hash") == digest:
                files.append(cached)
                reused += 1
                continue
            symbols = [symbol.model_dump() for symbol in entry.symbols]
            if entry.language == "python":
                symbols = _python_symbols(content.decode("utf-8", errors="replace"))
            files.append({
                "path": entry.path, "hash": digest, "language": entry.language,
                "sizeBytes": len(content), "imports": entry.imports, "exports": entry.exports,
                "symbols": symbols, "isTest": entry.is_test, "isConfig": entry.is_config,
            })
        files.sort(key=lambda item: item["path"])
        payload = {
            "schemaVersion": SCHEMA_VERSION, "workspaceHash": _workspace_hash(files),
            "generatedAt": datetime.now(UTC).isoformat(), "incrementalReusedFiles": reused,
            "files": files, "entryPoints": repo.entry_points, "gitStatus": repo.git_status,
            "graphCompleteness": "imports_and_test_proximity",
        }
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        temp.replace(target)
        return payload

    @staticmethod
    def _read(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if value.get("schemaVersion") == SCHEMA_VERSION else {}
        except (OSError, ValueError, TypeError):
            return {}


def _python_symbols(content: str) -> list[dict[str, Any]]:
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return []
    result = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            kind = "class" if isinstance(node, ast.ClassDef) else "function"
            result.append({"name": node.name, "kind": kind, "line": node.lineno,
                           "endLine": getattr(node, "end_lineno", node.lineno)})
    return sorted(result, key=lambda item: (item["line"], item["name"]))


def _workspace_hash(files: list[dict[str, Any]]) -> str:
    state = [(item["path"], item["hash"]) for item in files]
    return hashlib.sha256(json.dumps(state, separators=(",", ":")).encode()).hexdigest()
