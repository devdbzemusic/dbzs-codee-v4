import os
from pathlib import Path

import pytest

from app.core.workspace_paths import WorkspacePathError, resolve_workspace_path


def test_workspace_path_accepts_existing_child(tmp_path: Path):
    child = tmp_path / "src" / "file.py"
    child.parent.mkdir()
    child.write_text("pass", encoding="utf-8")
    assert resolve_workspace_path(str(tmp_path), "src/file.py") == child.resolve()


def test_workspace_path_rejects_lexical_escape(tmp_path: Path):
    with pytest.raises(WorkspacePathError, match="PATH_OUTSIDE_WORKSPACE"):
        resolve_workspace_path(str(tmp_path), "../outside.txt", allow_missing=True)


def test_workspace_path_accepts_missing_child_of_real_parent(tmp_path: Path):
    target = resolve_workspace_path(str(tmp_path), "new/file.txt", allow_missing=True)
    assert target == (tmp_path / "new" / "file.txt").absolute()


def test_workspace_path_resolves_relative_targets_against_workspace_root(tmp_path: Path):
    child = tmp_path / "src" / "file.py"
    child.parent.mkdir()
    child.write_text("pass", encoding="utf-8")

    original_cwd = Path.cwd()
    try:
        os.chdir(tmp_path)
        assert resolve_workspace_path(str(tmp_path), "src/file.py") == child.resolve()
    finally:
        os.chdir(original_cwd)


def test_workspace_path_rejects_symlink_escape(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    external = tmp_path / "external"
    external.mkdir()
    (external / "secret.txt").write_text("secret", encoding="utf-8")
    linked = workspace / "linked"

    if os.name == "nt":
        with pytest.raises(WorkspacePathError, match="PATH_OUTSIDE_WORKSPACE"):
            resolve_workspace_path(str(workspace), str(tmp_path / "secret.txt"), allow_missing=True)
        return

    linked.symlink_to(external, target_is_directory=True)

    with pytest.raises(WorkspacePathError, match="SYMLINK_ESCAPE"):
        resolve_workspace_path(str(workspace), "linked/secret.txt", allow_missing=True)


def test_workspace_path_rejects_nul_bytes(tmp_path: Path):
    with pytest.raises(WorkspacePathError, match="INVALID_PATH"):
        resolve_workspace_path(str(tmp_path), "bad\x00name.txt")
