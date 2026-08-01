from __future__ import annotations

import os

from app.model_lab.models import HuggingFaceRepoFile, HuggingFaceRepoInfo, HuggingFaceSearchResult

try:
    from huggingface_hub import HfApi  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised when optional dependency is absent
    HfApi = None  # type: ignore[assignment]


class HuggingFaceModelService:
    def __init__(self, token: str | None = None) -> None:
        self.token = token or os.environ.get("HF_TOKEN")
        self._api = HfApi(token=self.token) if HfApi is not None else None

    def is_available(self) -> bool:
        return self._api is not None

    def search_models(self, query: str, *, category: str = "", limit: int = 25) -> list[HuggingFaceSearchResult]:
        if self._api is None:
            return []
        query = query.strip()
        if not query:
            return []
        raw_models = list(self._api.list_models(search=query, limit=limit, full=True))
        results: list[HuggingFaceSearchResult] = []
        for item in raw_models:
            tags = list(getattr(item, "tags", []) or [])
            pipeline = getattr(item, "pipeline_tag", "") or ""
            if not _matches_category(category, tags, pipeline):
                continue
            results.append(
                HuggingFaceSearchResult(
                    id=getattr(item, "id", ""),
                    pipeline=pipeline,
                    downloads=getattr(item, "downloads", 0) or 0,
                    likes=getattr(item, "likes", 0) or 0,
                    size_mb=_siblings_size_mb(list(getattr(item, "siblings", []) or [])),
                    last_modified=_iso(getattr(item, "last_modified", None)),
                    tags=tags[:8],
                )
            )
        return sorted(results, key=lambda model: (model.downloads, model.likes), reverse=True)

    def get_repo_info(self, repo_id: str, *, revision: str | None = None) -> HuggingFaceRepoInfo | None:
        if self._api is None:
            return None
        info = self._api.model_info(repo_id=repo_id, revision=revision, files_metadata=True)
        siblings = list(getattr(info, "siblings", []) or [])
        return HuggingFaceRepoInfo(
            id=getattr(info, "id", repo_id),
            pipeline=getattr(info, "pipeline_tag", "") or "",
            tags=list(getattr(info, "tags", []) or []),
            files=[
                HuggingFaceRepoFile(name=getattr(sibling, "rfilename", ""), size_bytes=_sibling_size(sibling))
                for sibling in siblings
                if getattr(sibling, "rfilename", None)
            ],
        )


def _matches_category(category: str, tags: list[str], pipeline: str) -> bool:
    normalized = category.lower().strip()
    if not normalized or normalized == "alle":
        return True
    haystack = " ".join([*tags, pipeline]).lower()
    needles = {
        "embeddings": ["sentence-transformers", "feature-extraction", "embedding"],
        "llm": ["text-generation", "causal-lm", "llm", "instruct"],
        "vision": ["image", "vision", "clip", "object-detection"],
        "audio": ["audio", "speech", "asr", "tts"],
        "reranker": ["rerank", "cross-encoder", "text-ranking"],
    }.get(normalized, [normalized])
    return any(needle in haystack for needle in needles)


def _siblings_size_mb(siblings: list[object]) -> int:
    total = sum(_sibling_size(sibling) for sibling in siblings)
    return int(total / (1024 * 1024)) if total > 0 else 0


def _sibling_size(sibling: object) -> int:
    lfs = getattr(sibling, "lfs", None)
    lfs_size = getattr(lfs, "size", 0) or 0
    raw_size = getattr(sibling, "size", 0) or 0
    return int(lfs_size if lfs_size > raw_size else raw_size)


def _iso(value: object) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat(timespec="seconds")  # type: ignore[call-arg]
    return ""

