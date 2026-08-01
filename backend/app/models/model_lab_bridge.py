"""
Bridges the legacy runtime model index (`app/models/index_service.py`) with
Model Lab (`app/model_lab/`) (Plan 14, Phase 0.2).

The two systems are otherwise completely disconnected: Model Lab already has a
multi-source registry, SHA-256 dedup, bundle grouping and health
classification, but none of it feeds into what the runtime launcher actually
scans or shows. A full data-model merge would be a large, risky rewrite of
`index_service.py` (the most heavily-tested core module); this is a small,
additive bridge instead - Model Lab sources become extra scan roots, and
Model Lab's health/tags are overlaid onto matching runtime models by path.

Both functions fail soft (return the input unchanged / an empty list) if
Model Lab's database isn't reachable, so the runtime index keeps working
exactly as before for anyone who has never opened the Model Lab tab.
"""
from __future__ import annotations

from pathlib import Path

from app.model_lab.repository import ModelLabRepository
from app.models.schemas import ModelIndex


def additional_scan_roots(*, exclude: Path, repository: ModelLabRepository | None = None) -> list[Path]:
    """Enabled Model Lab source directories that aren't already the runtime
    index's primary `models_dir` - so a folder registered once in Model Lab
    is also scanned for runnable models, without a second source-management
    UI for the same concept."""
    try:
        sources = (repository or ModelLabRepository()).list_sources()
    except Exception:
        return []

    seen = {exclude.resolve()}
    roots: list[Path] = []
    for source in sources:
        if not source.enabled:
            continue
        try:
            resolved = Path(source.path).resolve()
        except OSError:
            continue
        if resolved in seen or not resolved.is_dir():
            continue
        seen.add(resolved)
        roots.append(resolved)
    return roots


def enrich_with_model_lab_health(index: ModelIndex, *, repository: ModelLabRepository | None = None) -> ModelIndex:
    """Overlays Model Lab's health status/tags onto matching `IndexedModel`
    entries (matched by resolved absolute file path). Purely additive - never
    touches identity/runtime fields the launcher relies on."""
    try:
        model_lab_models = (repository or ModelLabRepository()).list_models()
    except Exception:
        return index

    if not model_lab_models:
        return index

    health_by_path: dict[str, tuple[str, list[str]]] = {}
    for entry in model_lab_models:
        for artifact in entry.artifacts:
            try:
                resolved = str(Path(artifact.path).resolve())
            except OSError:
                continue
            health_by_path[resolved] = (entry.bundle.health.status, entry.bundle.tags)

    if not health_by_path:
        return index

    updated_models = []
    changed = False
    for model in index.models:
        try:
            match = health_by_path.get(str(Path(model.path).resolve()))
        except OSError:
            match = None
        if match is None:
            updated_models.append(model)
            continue
        status, tags = match
        updated_models.append(model.model_copy(update={"model_lab_health_status": status, "model_lab_tags": tags}))
        changed = True

    if not changed:
        return index
    return index.model_copy(update={"models": updated_models})
