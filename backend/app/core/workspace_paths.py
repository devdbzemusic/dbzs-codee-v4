"""Kanonische Workspace-Pfadpruefung fuer Backend-Dateioperationen."""
from __future__ import annotations

import os
from pathlib import Path

from app.core.observability import emit_hardening_event


class WorkspacePathError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"[{code}] {message}")


def resolve_workspace_path(workspace_root: str, candidate: str | None, *, allow_missing: bool = False) -> Path:
    if candidate is None:
        candidate = "."
    if not isinstance(candidate, str):
        emit_hardening_event("workspace_path_rejected", reason="invalid_type", candidate_type=type(candidate).__name__)
        raise WorkspacePathError("INVALID_PATH", "Pfad muss ein String sein.")
    if "\x00" in candidate:
        emit_hardening_event("workspace_path_rejected", reason="nul_byte", candidate=candidate)
        raise WorkspacePathError("INVALID_PATH", "Pfad enthält Nullbytes.")

    root_input = Path(workspace_root).expanduser().absolute()
    try:
        root = root_input.resolve(strict=True)
    except OSError as exc:
        raise WorkspacePathError("INVALID_WORKSPACE_ROOT", "Workspace ist nicht erreichbar.") from exc
    if not root.is_dir():
        raise WorkspacePathError("INVALID_WORKSPACE_ROOT", "Workspace ist kein Verzeichnis.")

    requested = Path(candidate or ".")
    if requested.is_absolute():
        lexical = Path(os.path.abspath(requested))
    else:
        lexical = Path(os.path.abspath(root_input / requested))

    try:
        lexical.relative_to(root_input)
    except ValueError as exc:
        raise WorkspacePathError("PATH_OUTSIDE_WORKSPACE", "Ziel liegt ausserhalb des Workspace.") from exc

    if lexical.exists():
        resolved = lexical.resolve(strict=True)
    else:
        if not allow_missing:
            raise WorkspacePathError("PATH_REVALIDATION_FAILED", "Ziel existiert nicht.")
        parent = lexical.parent
        while not parent.exists() and parent != parent.parent:
            parent = parent.parent
        resolved_parent = parent.resolve(strict=True)
        try:
            resolved_parent.relative_to(root)
        except ValueError as exc:
            raise WorkspacePathError("SYMLINK_ESCAPE", "Elternpfad verlaesst den Workspace.") from exc
        return lexical

    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise WorkspacePathError("SYMLINK_ESCAPE", "Ziel verlaesst den Workspace ueber Symlink oder Junction.") from exc
    return resolved
