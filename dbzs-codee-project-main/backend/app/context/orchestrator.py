"""Deterministischer Context-Orchestrator auf Basis des vorhandenen Repo-Map-Builders."""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.context.models import ContextItem, ContextPack, ContextRequest, OmittedItem, RetrievalTrace
from app.core.context_policy import is_context_path_allowed
from app.context_pack.models import ContextPackBuildRequest
from app.context_pack.service import ContextPackService

_CODING_TASKS = {"planning", "architecture", "small_code_change", "large_code_change", "debugging",
                 "review", "test_analysis", "refactoring"}


class ContextOrchestrator:
    def __init__(self, context_pack_service: ContextPackService | None = None) -> None:
        self._context_pack = context_pack_service or ContextPackService()

    def build(self, request: ContextRequest) -> ContextPack:
        self._validate_slot(request)
        root = Path(request.workspace_root).resolve()
        request.active_file = _workspace_relative(root, request.active_file) if request.active_file else None
        request.selected_files = [_workspace_relative(root, value) for value in request.selected_files]
        started = _now()
        trace_id = f"ctx-{uuid4().hex}"
        legacy = self._context_pack.build(ContextPackBuildRequest(
            workspace_root=request.workspace_root,
            user_request=request.user_query,
            active_file_path=request.active_file,
            repo_map_token_budget=min(60000, max(1000, request.max_tokens)),
        ))
        query_tokens = _tokens(request.user_query)
        selected_paths = {_normal(path) for path in request.selected_files}
        active_path = _normal(request.active_file or "")
        candidates: list[ContextItem] = []
        gaps: list[str] = []

        for file in legacy.repo_map.files:
            path = _normal(file.path)
            if not is_context_path_allowed(path):
                continue
            searchable = " ".join([path, *file.imports, *file.exports, *(s.name for s in file.symbols)]).lower()
            matches = sum(1 for token in query_tokens if token in searchable)
            reasons: list[str] = []
            score = min(0.45, matches * 0.09)
            if matches:
                reasons.append("lexical_or_symbol_match")
            if path == active_path:
                score += 0.30
                reasons.append("active_file")
            if path in selected_paths:
                score += 0.40
                reasons.append("user_selected")
            if file.is_test and request.task_type in {"debugging", "test_analysis", "review"}:
                score += 0.18
                reasons.append("test_relevance")
            if file.is_config and request.task_type in {"architecture", "planning"}:
                score += 0.12
                reasons.append("configuration_relevance")
            if not reasons:
                continue
            content = _read_excerpt(Path(request.workspace_root), path)
            if not content:
                continue
            candidates.append(ContextItem(
                id=hashlib.sha256(f"{path}:{content}".encode()).hexdigest()[:20],
                kind="test" if file.is_test else "config" if file.is_config else "file",
                source_path=path,
                content=content,
                relevance_score=min(1.0, 0.15 + score), freshness_score=1.0,
                trust_score=0.95 if file.is_test else 0.85,
                token_estimate=_estimate_tokens(content), reasons=reasons,
            ))

        included_paths = {item.source_path for item in candidates}
        explicit_paths = selected_paths | ({active_path} if active_path else set())
        for path in sorted(explicit_paths - included_paths):
            if not is_context_path_allowed(path):
                gaps.append(f"policy_excluded:{path}")
                continue
            content = _read_excerpt(Path(request.workspace_root), path)
            if not content:
                gaps.append(f"explicit_file_unavailable:{path}")
                continue
            reasons = ["user_selected"] if path in selected_paths else []
            if path == active_path:
                reasons.append("active_file")
            candidates.append(ContextItem(
                id=hashlib.sha256(f"{path}:{content}".encode()).hexdigest()[:20],
                kind="file", source_path=path, content=content,
                relevance_score=0.95, freshness_score=1.0, trust_score=0.85,
                token_estimate=_estimate_tokens(content), reasons=reasons,
            ))

        deduplicated: dict[str, ContextItem] = {}
        duplicate_count = 0
        for item in sorted(candidates, key=lambda value: (-value.relevance_score, -value.trust_score, value.id)):
            fingerprint = hashlib.sha256(item.content.encode()).hexdigest()
            if fingerprint in deduplicated:
                duplicate_count += 1
                continue
            deduplicated[fingerprint] = item

        items: list[ContextItem] = []
        omitted: list[OmittedItem] = []
        used = 0
        for item in deduplicated.values():
            if used + item.token_estimate > request.max_tokens:
                omitted.append(OmittedItem(id=item.id, reason="token_budget"))
                continue
            items.append(item)
            used += item.token_estimate
        if not items:
            gaps.append("no_relevant_repository_evidence")
        trace = RetrievalTrace(
            id=trace_id, strategy=["path", "keyword", "symbol", "active_file", "user_selection", "test_proximity"],
            candidate_count=len(candidates), selected_count=len(items), duplicate_count=duplicate_count,
            started_at=started, completed_at=_now(), gaps=gaps,
        )
        return ContextPack(task_id=request.task_id, items=items, total_tokens=used, omitted_items=omitted,
                           summary=f"{len(items)} relevante Elemente, {len(omitted)} ausgelassen.",
                           retrieval_trace_id=trace_id, trace=trace)

    @staticmethod
    def _validate_slot(request: ContextRequest) -> None:
        expected = "fast_gpu" if request.task_type in _CODING_TASKS else "utility" if request.task_type in {
            "embedding", "reranking", "indexing"} else "quality_cpu"
        if request.slot_id != expected:
            raise ValueError(f"slot_unavailable: task type {request.task_type} requires {expected}")


def _read_excerpt(root: Path, relative: str, max_chars: int = 12000) -> str:
    if not is_context_path_allowed(relative):
        return ""
    root = root.resolve()
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("workspace_changed: context path escaped workspace") from exc
    try:
        return target.read_text(encoding="utf-8", errors="replace")[:max_chars]
    except OSError:
        return ""


def _workspace_relative(root: Path, candidate: str) -> str:
    root = root.resolve()
    value = Path(candidate)
    target = value.resolve() if value.is_absolute() else (root / value).resolve()
    try:
        return target.relative_to(root).as_posix()
    except ValueError as exc:
        raise ValueError("workspace_changed: context path escaped workspace") from exc


def _tokens(value: str) -> set[str]:
    return {token.lower() for token in re.findall(r"[A-Za-z0-9_./-]{2,}", value)}


def _normal(value: str) -> str:
    normalized = value.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized.lstrip("/")


def _estimate_tokens(value: str) -> int:
    return max(1, (len(value) + 3) // 4)


def _now() -> str:
    return datetime.now(UTC).isoformat()
