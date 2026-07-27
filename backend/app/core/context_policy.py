"""Gemeinsame Ausschlussregeln fuer Workspace-Kontext und Retrieval."""

from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def _context_excludes_document() -> dict:
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
    return data


@lru_cache(maxsize=1)
def default_context_excluded_directories() -> frozenset[str]:
    entries = _context_excludes_document()["excludedDirectories"]
    return frozenset(str(entry).lower() for entry in entries)


@lru_cache(maxsize=1)
def default_context_excluded_file_patterns() -> tuple[str, ...]:
    entries = _context_excludes_document().get("excludedFilePatterns", [])
    return tuple(str(entry).lower() for entry in entries)


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    escaped = re.escape(pattern).replace(r"\*", ".*")
    return re.compile(f"^{escaped}$")


@lru_cache(maxsize=1)
def _excluded_file_pattern_regexes() -> tuple[re.Pattern[str], ...]:
    return tuple(_glob_to_regex(pattern) for pattern in default_context_excluded_file_patterns())


def _is_excluded_file_name(basename: str) -> bool:
    lowered = basename.lower()
    return any(regex.match(lowered) for regex in _excluded_file_pattern_regexes())


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
    normalized = Path(str(path_value).replace("\\", "/"))
    parts = [part.lower() for part in normalized.parts]
    excluded = default_context_excluded_directories()
    if any(part in excluded for part in parts):
        return True
    basename = normalized.name
    return bool(basename) and _is_excluded_file_name(basename)


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
