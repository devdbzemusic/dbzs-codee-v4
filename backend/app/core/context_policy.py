"""Gemeinsame Ausschlussregeln fuer Workspace-Kontext und Retrieval."""

from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def default_context_excluded_directories() -> frozenset[str]:
    bundle_root = (
        Path(getattr(sys, "_MEIPASS"))
        if hasattr(sys, "_MEIPASS")
        else Path(__file__).resolve().parents[3]
    )
    contract_path = bundle_root / "packages" / "shared" / "context-excludes.json"
    if not contract_path.exists():
        contract_path = bundle_root / "packages" / "shared" / "src" / "context-excludes.json"
    data = json.loads(contract_path.read_text(encoding="utf-8"))
    entries = data.get("excludedDirectories")
    if data.get("schemaVersion") != 1 or not isinstance(entries, list):
        raise RuntimeError("[CONTEXT_POLICY_INVALID] Ungueltiger Context-Exclude-Vertrag.")
    return frozenset(str(entry).lower() for entry in entries)


def normalize_workspace_path(path_value: str) -> str:
    return re.sub(r"/+", "/", path_value.replace("\\", "/").strip()).rstrip("/")


def workspace_scope_id(workspace_root: str) -> str:
    return normalize_workspace_path(workspace_root).lower()


def is_default_context_excluded(
    path_value: str | Path,
    *,
    explicit_mention: bool = False,
    access_confirmed: bool = False,
) -> bool:
    if explicit_mention and access_confirmed:
        return False
    parts = (part.lower() for part in Path(str(path_value).replace("\\", "/")).parts)
    excluded = default_context_excluded_directories()
    return any(part in excluded for part in parts)


def is_context_path_allowed(
    path_value: str | Path,
    *,
    explicit_mention: bool = False,
    access_confirmed: bool = False,
) -> bool:
    return not is_default_context_excluded(
        path_value,
        explicit_mention=explicit_mention,
        access_confirmed=access_confirmed,
    )
