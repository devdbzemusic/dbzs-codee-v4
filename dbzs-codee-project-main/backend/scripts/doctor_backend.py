"""Backend API doctor — TestClient checks without a live server."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app

CHECKS: list[tuple[str, str, str]] = [
    ("health", "GET", "/health"),
    ("models_index", "GET", "/models/index"),
    ("runtime_status", "GET", "/runtime/status"),
    ("runtime_doctor", "GET", "/runtime/doctor"),
    ("job_spooler", "GET", "/job-spooler"),
    ("model_profiles_list", "GET", "/model-profiles/list"),
    ("orchestration_tools", "GET", "/orchestration/tools"),
]


def main() -> int:
    client = TestClient(app)
    rows: list[dict[str, str]] = []
    errors = 0

    for name, method, path in CHECKS:
        response = client.request(method, path)
        ok = response.status_code == 200
        detail = response.text[:200] if not ok else "200 OK"
        if not ok:
            errors += 1
        rows.append(
            {
                "check": name,
                "status": "OK" if ok else "ERROR",
                "path": path,
                "http": str(response.status_code),
                "detail": detail,
            }
        )

    print("doctor-backend:")
    print(json.dumps(rows, indent=2, ensure_ascii=False))
    print(f"summary: {len(rows) - errors}/{len(rows)} passed")

    if errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
