"""In-process boot readiness store.

Single source of truth for the backend half of app-boot readiness: the
desktop-side BootOrchestrator polls GET /health/ready (see app/api/health.py)
which reads this store. Components are set by the startup tasks scheduled
from `lifespan()` in app/main.py — database init, model index warmup,
runtime manager confirmation, resident model autostart.

Not a duplicate of health_dashboard.py's live-aggregation endpoint, which
answers "is everything healthy right now" on every call; this store only
tracks the one-time boot sequence.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Literal

BootComponentState = Literal[
    "pending", "waiting", "running", "success", "warning", "failed", "retrying", "blocked", "skipped"
]

COMPONENT_NAMES = ("database", "modelRegistry", "runtimeManager", "residentModel")


@dataclass
class BootComponentSnapshot:
    state: BootComponentState = "pending"
    progress: float | None = None
    total: float | None = None
    message: str | None = None
    error: str | None = None
    updated_at: float = field(default_factory=time.time)


class BootStateStore:
    """Async-safe singleton tracking backend component readiness."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._components: dict[str, BootComponentSnapshot] = {
            name: BootComponentSnapshot() for name in COMPONENT_NAMES
        }
        self._logs: list[dict[str, object]] = []
        self._started_at = time.time()

    async def set_component(
        self,
        name: str,
        state: BootComponentState,
        *,
        progress: float | None = None,
        total: float | None = None,
        message: str | None = None,
        error: str | None = None,
    ) -> None:
        if name not in COMPONENT_NAMES:
            raise ValueError(f"Unknown boot component: {name}")
        async with self._lock:
            snapshot = self._components[name]
            snapshot.state = state
            if progress is not None:
                snapshot.progress = progress
            if total is not None:
                snapshot.total = total
            if message is not None:
                snapshot.message = message
            snapshot.error = error
            snapshot.updated_at = time.time()
            self._logs.append(
                {
                    "timestamp": int(snapshot.updated_at * 1000),
                    "level": "error" if state == "failed" else "info",
                    "source": name if name != "modelRegistry" else "model-index",
                    "phaseId": None,
                    "event": f"{name}:{state}",
                    "message": message or state,
                }
            )

    def snapshot(self) -> dict[str, object]:
        components = {
            name: {
                "state": snap.state,
                "progress": snap.progress,
                "total": snap.total,
                "message": snap.message,
                "error": snap.error,
            }
            for name, snap in self._components.items()
        }

        mandatory = ("database", "modelRegistry", "runtimeManager")
        mandatory_states = [self._components[name].state for name in mandatory]
        resident_state = self._components["residentModel"].state
        # "success" and "skipped" both mean the resident-model phase reached
        # a genuine terminal outcome (skipped = autostart intentionally
        # disabled) — only "failed" degrades. Anything else (pending,
        # running, starting, loading, warming, retrying, ...) means it
        # hasn't finished yet, so overall status must not claim "ready"
        # prematurely just because the mandatory components are done.
        resident_terminal = resident_state in ("success", "failed", "skipped")

        if any(s == "failed" for s in mandatory_states):
            status = "failed"
        elif all(s == "success" for s in mandatory_states) and resident_terminal:
            status = "degraded" if resident_state == "failed" else "ready"
        else:
            status = "starting"

        ready = status in ("ready", "degraded")

        total_components = len(COMPONENT_NAMES)
        success_weight = sum(1 for snap in self._components.values() if snap.state == "success")
        progress = round((success_weight / total_components) * 100)

        return {
            "status": status,
            "ready": ready,
            "progress": progress,
            "components": components,
        }

    def logs_since(self, index: int) -> tuple[list[dict[str, object]], int]:
        entries = self._logs[index:]
        return entries, len(self._logs)


_store: BootStateStore | None = None


def get_boot_state_store() -> BootStateStore:
    global _store
    if _store is None:
        _store = BootStateStore()
    return _store


def reset_boot_state_store() -> BootStateStore:
    """Used by tests to get a clean store per test."""
    global _store
    _store = BootStateStore()
    return _store
