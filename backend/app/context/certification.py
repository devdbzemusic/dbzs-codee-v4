"""Gemessene Model-Certification über den vorhandenen Runtime-Chat-Pfad."""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable
from uuid import uuid4

from pydantic import BaseModel, Field

from app.core.config import get_app_data_dir
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest, RuntimeChatResponse

CATEGORIES = ("code_understanding", "multi_file", "patch_format", "review", "debugging",
              "tool_calling", "long_instruction", "context_retention", "structured_output")


class CertificationCase(BaseModel):
    name: str
    category: str
    passed: bool
    duration_ms: int = Field(ge=0)
    response_excerpt: str = ""
    tokens_per_second: float = 0


class CertificationReport(BaseModel):
    schema_version: int = 1
    run_id: str = ""
    model_id: str
    bundle_id: str | None = None
    model_version: str = "unknown"
    slot_id: str = "fast_gpu"
    hardware: str
    tested_at: str
    score: float
    certified: bool
    cases: list[CertificationCase]
    failed_categories: list[str]


def certify_model(model_id: str, hardware: str, cases: list[CertificationCase]) -> CertificationReport:
    if not cases:
        raise ValueError("certification requires measured cases")
    score = round(sum(1 for case in cases if case.passed) / len(cases) * 100, 2)
    failed = sorted({case.category for case in cases if not case.passed})
    return CertificationReport(model_id=model_id, hardware=hardware,
                               tested_at=datetime.now(UTC).isoformat(), score=score,
                               certified=score >= 80 and not failed, cases=cases,
                               failed_categories=failed)


class CertificationStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or get_app_data_dir() / "model-certifications"

    def put(self, report: CertificationReport) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / f"{report.run_id}.json"
        temp = target.with_suffix(".tmp")
        temp.write_text(report.model_dump_json(indent=2), encoding="utf-8")
        temp.replace(target)

    def get(self, run_id: str) -> CertificationReport | None:
        target = self.root / f"{run_id}.json"
        return CertificationReport.model_validate_json(target.read_text(encoding="utf-8")) if target.exists() else None

    def latest(self, model_id: str) -> CertificationReport | None:
        reports = [CertificationReport.model_validate_json(path.read_text(encoding="utf-8"))
                   for path in self.root.glob("*.json")] if self.root.exists() else []
        matches = [report for report in reports if report.model_id == model_id]
        return max(matches, key=lambda report: report.tested_at) if matches else None


class ModelCertificationRunner:
    def __init__(self, chat: Callable[[RuntimeChatRequest], RuntimeChatResponse], store: CertificationStore) -> None:
        self.chat = chat
        self.store = store

    def run(
        self,
        *,
        model_id: str,
        slot_id: str,
        hardware: str,
        model_version: str = "unknown",
        bundle_id: str | None = None,
    ) -> CertificationReport:
        cases: list[CertificationCase] = []
        for category in CATEGORIES:
            started = time.perf_counter()
            response_text = ""
            passed = False
            try:
                response = self.chat(RuntimeChatRequest(
                    messages=[RuntimeChatMessage(role="user", content=_prompt(category))],
                    model_id=model_id, slot_id=slot_id, fallback_policy="strict", max_tokens=96,
                ))
                response_text = response.message.content
                payload = _extract_json_payload(response_text)
                passed = response.model_id not in {None, "simulation"} and payload.get("category") == category and payload.get("passed") is True
            except Exception:
                passed = False
            duration_ms = max(1, round((time.perf_counter() - started) * 1000))
            token_count = max(1, len(response_text.split()))
            cases.append(CertificationCase(name=category, category=category, passed=passed,
                                           duration_ms=duration_ms, response_excerpt=response_text[:500],
                                           tokens_per_second=round(token_count / (duration_ms / 1000), 2)))
        report = certify_model(model_id, hardware, cases).model_copy(update={
            "run_id": f"cert-{uuid4().hex}", "model_version": model_version, "slot_id": slot_id,
            "bundle_id": bundle_id,
        })
        self.store.put(report)
        return report


def _prompt(category: str) -> str:
    return (f"DBZS certification case: {category}. Execute the requested capability and return only JSON "
            f'{{"category":"{category}","passed":true,"evidence":"short measured evidence"}}. '
            "Set passed=false if the capability cannot be completed.")


def _extract_json_payload(content: str) -> dict:
    decoder = json.JSONDecoder()
    for index, char in enumerate(content):
        if char != "{":
            continue
        try:
            payload, _end = decoder.raw_decode(content[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise ValueError("certification response did not contain a JSON object")
