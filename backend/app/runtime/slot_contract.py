"""Loader fuer den zentralen, versionierten Runtime-Slotvertrag."""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache(maxsize=1)
def load_slot_contract() -> dict[str, Any]:
    bundle_root = Path(getattr(sys, "_MEIPASS")) if hasattr(sys, "_MEIPASS") else Path(__file__).resolve().parents[3]
    contract_path = bundle_root / "packages" / "shared" / "runtime-slots.json"
    data = json.loads(contract_path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 1 or not isinstance(data.get("slots"), list):
        raise RuntimeError("[RUNTIME_SLOT_CONTRACT_INVALID] Ungueltiger Slotvertrag.")
    ids = {entry.get("id") for entry in data["slots"]}
    if ids != {"quality_cpu", "fast_gpu", "utility", "orchestrator_cpu"}:
        raise RuntimeError("[RUNTIME_SLOT_CONTRACT_INVALID] Pflichtslots fehlen.")
    return data


def slot_port(slot_id: str) -> int:
    for entry in load_slot_contract()["slots"]:
        if entry["id"] == slot_id:
            return int(entry["port"])
    raise ValueError(f"[RUNTIME_SLOT_UNKNOWN] {slot_id}")


def slot_id_for_port(port: int) -> str | None:
    return next((entry["id"] for entry in load_slot_contract()["slots"] if int(entry["port"]) == port), None)
