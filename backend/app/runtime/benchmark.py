"""Simple benchmark: sends short prompts to the running llama-server and measures throughput."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from urllib import error as urlerror
from urllib import request as urlrequest


@dataclass
class BenchmarkResult:
    model_name: str
    avg_latency_ms: float
    tokens_per_second: float
    rounds: int
    error: str | None = None


_PROMPTS = [
    "Antworte mit einem einzigen Wort: Hallo",
    "Was ist 2+2? Nur die Zahl.",
    "Nenne eine Farbe.",
    "Antworte mit Ja oder Nein: Ist Python eine Sprache?",
    "Nenne den ersten Buchstaben des Alphabets.",
]


def run_benchmark(backend_url: str) -> BenchmarkResult:
    try:
        status = _get_json(f"{backend_url}/runtime/status")
        model_name = status.get("model_name") or status.get("model_id") or "unknown"
        if status.get("state") != "running":
            return BenchmarkResult(model_name=model_name, avg_latency_ms=0, tokens_per_second=0, rounds=0, error="Runtime nicht aktiv.")
    except Exception as exc:
        return BenchmarkResult(model_name="unknown", avg_latency_ms=0, tokens_per_second=0, rounds=0, error=str(exc))

    latencies: list[float] = []
    total_tokens = 0

    for prompt in _PROMPTS:
        t0 = time.monotonic()
        try:
            resp = _post_json(f"{backend_url}/runtime/chat", {
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 16,
            })
            elapsed_ms = (time.monotonic() - t0) * 1000
            latencies.append(elapsed_ms)
            content = resp.get("message", {}).get("content", "")
            total_tokens += max(1, len(str(content).split()))
        except Exception:
            pass

    if not latencies:
        return BenchmarkResult(model_name=model_name, avg_latency_ms=0, tokens_per_second=0, rounds=0, error="Alle Anfragen fehlgeschlagen.")

    avg_latency = sum(latencies) / len(latencies)
    total_elapsed_s = sum(latencies) / 1000
    tps = total_tokens / total_elapsed_s if total_elapsed_s > 0 else 0

    return BenchmarkResult(
        model_name=model_name,
        avg_latency_ms=round(avg_latency, 1),
        tokens_per_second=round(tps, 2),
        rounds=len(latencies),
    )


def _get_json(url: str) -> dict:
    req = urlrequest.Request(url, method="GET")
    with urlrequest.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlrequest.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))
