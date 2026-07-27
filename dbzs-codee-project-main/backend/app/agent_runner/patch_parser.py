"""Parse LLM patch proposal JSON from agent runner responses."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.agent_runner.models import AgentPatchProposal
from app.core.workspace_paths import resolve_workspace_path

JSON_FENCE_PATTERN = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
MAX_PATCHES = 5
MAX_PATCH_BYTES = 64 * 1024


def extract_json_payload(content: str) -> Any:
    stripped = content.strip()
    fence_match = JSON_FENCE_PATTERN.search(stripped)
    candidate = fence_match.group(1).strip() if fence_match else stripped

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end > start:
            return json.loads(candidate[start : end + 1])
        raise


def normalize_patch_entries(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [entry for entry in payload if isinstance(entry, dict)]
    if isinstance(payload, dict):
        patches = payload.get("patches")
        if isinstance(patches, list):
            return [entry for entry in patches if isinstance(entry, dict)]
    raise ValueError("LLM-Antwort enthält kein gültiges patches-Array.")


def validate_patch_path(workspace_root: str, file_path: str) -> str:
    normalized = file_path.strip().replace("\\", "/")
    if not normalized or normalized.startswith("/") or ".." in Path(normalized).parts:
        raise ValueError(f"Ungültiger Patch-Pfad: {file_path}")

    resolve_workspace_path(workspace_root, normalized, allow_missing=True)
    return normalized


def parse_patch_proposals(llm_content: str, workspace_root: str) -> list[AgentPatchProposal]:
    payload = extract_json_payload(llm_content)
    entries = normalize_patch_entries(payload)
    proposals: list[AgentPatchProposal] = []

    for entry in entries[:MAX_PATCHES]:
        raw_path = str(entry.get("file_path") or entry.get("path") or "").strip()
        proposed_content = str(entry.get("proposed_content") or entry.get("content") or "")
        summary = str(entry.get("summary") or entry.get("reason") or "").strip()

        if not raw_path or not proposed_content:
            continue

        if len(proposed_content.encode("utf-8")) > MAX_PATCH_BYTES:
            raise ValueError(f"Patch-Inhalt zu gross für {raw_path}.")

        file_path = validate_patch_path(workspace_root, raw_path)
        proposals.append(
            AgentPatchProposal(
                file_path=file_path,
                proposed_content=proposed_content,
                summary=summary,
            )
        )

    return proposals
