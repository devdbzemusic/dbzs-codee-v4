from __future__ import annotations

import json
from pathlib import Path

from app.models.schemas import IndexedModel


def read_json_file(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)


def utc_now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def provider_for_model(model: IndexedModel) -> str:
    if model.runtime_launcher == "ollama":
        return "ollama"
    return "llama.cpp"
