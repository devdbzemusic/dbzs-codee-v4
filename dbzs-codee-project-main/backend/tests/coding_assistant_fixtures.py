"""Shared fixture paths for coding assistant capability tests."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_WORKSPACE = REPO_ROOT / "fixtures" / "coding-assistant-workspace"


def fixture_workspace_root() -> Path:
    if not FIXTURE_WORKSPACE.joinpath("package.json").exists():
        raise FileNotFoundError(f"Fixture workspace missing: {FIXTURE_WORKSPACE}")
    return FIXTURE_WORKSPACE


def read_fixture(relative_path: str) -> str:
    path = fixture_workspace_root() / relative_path
    return path.read_text(encoding="utf-8")
