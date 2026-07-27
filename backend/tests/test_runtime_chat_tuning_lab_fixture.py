"""Fixture validation for the advanced runtime-chat tuning project."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "test-fixtures" / "runtime-chat-tuning-lab"


def test_runtime_chat_tuning_lab_has_expected_layout() -> None:
    expected_paths = [
        FIXTURE_ROOT / "README.md",
        FIXTURE_ROOT / "scenarios.json",
        FIXTURE_ROOT / "config" / "runtime.json",
        FIXTURE_ROOT / "src" / "core" / "priceEngine.ts",
        FIXTURE_ROOT / "src" / "core" / "reportFormatter.ts",
        FIXTURE_ROOT / "src" / "services" / "cacheRegistry.ts",
        FIXTURE_ROOT / "src" / "api" / "reviewController.ts",
        FIXTURE_ROOT / "src" / "workflows" / "syncUsers.ts",
        FIXTURE_ROOT / "src" / "runtime" / "runtimeProbe.ts",
        FIXTURE_ROOT / "src" / "legacy" / "normalizeOwner.ts",
    ]

    for item in expected_paths:
        assert item.exists(), f"Missing fixture path: {item}"


def test_runtime_chat_tuning_lab_scenarios_cover_key_workflows() -> None:
    catalog = json.loads((FIXTURE_ROOT / "scenarios.json").read_text(encoding="utf-8"))
    use_cases = catalog["useCases"]
    scenario_ids = {entry["id"] for entry in use_cases}
    intents = {entry["intent"] for entry in use_cases}
    pipelines = {entry["pipeline"] for entry in use_cases}

    assert len(use_cases) >= 14
    assert {"workspace_query", "review", "refactor", "debug", "implement", "approval", "plan"} <= intents
    assert {"direct_intent", "review_pipeline", "implementation_pipeline", "debug_pipeline"} <= pipelines
    assert {"workspace-count-gguf", "full-review", "debug-vip-pricing", "approval-legacy-boundary"} <= scenario_ids


def test_runtime_chat_tuning_lab_contains_three_gguf_models() -> None:
    models = list(FIXTURE_ROOT.rglob("*.gguf"))
    relative_paths = sorted(path.relative_to(FIXTURE_ROOT).as_posix() for path in models)

    assert len(models) == 3
    assert relative_paths == [
        "models/qwen/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf",
        "models/qwen/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
        "models/utility/embedding-small.gguf",
    ]
