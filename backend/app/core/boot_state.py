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
import uuid
from dataclasses import dataclass, field
from typing import Literal

BootComponentState = Literal[
    "pending", "waiting", "running", "success", "warning", "failed", "retrying", "blocked", "skipped"
]

COMPONENT_NAMES = ("database", "modelRegistry", "runtimeManager", "residentModel")


@dataclass
class BootComponentError:
    """Mirrors the shared BootComponentError TS type (packages/shared/src/boot.ts)."""

    code: str
    technical_detail: str | None = None
    exit_code: int | None = None
    stderr_tail: str | None = None


@dataclass
class BootComponentSnapshot:
    state: BootComponentState = "pending"
    progress: float | None = None
    total: float | None = None
    message: str | None = None
    error: BootComponentError | None = None
    # Structured payload beyond a free-text message (model-index counts,
    # resident-model identity, ...) -- mirrors BootReadinessComponent.data.
    data: dict[str, object] | None = None
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
        # Identifies this backend process instance -- desktop uses it (plus a
        # boot nonce, see backendStartupService.ts) to tell "this is the
        # instance I spawned" apart from "a different, pre-existing backend
        # happens to be listening on this port".
        self.instance_id = str(uuid.uuid4())

    async def set_component(
        self,
        name: str,
        state: BootComponentState,
        *,
        progress: float | None = None,
        total: float | None = None,
        message: str | None = None,
        error: BootComponentError | None = None,
        data: dict[str, object] | None = None,
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
            if data is not None:
                snapshot.data = data
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
                "error": (
                    {
                        "code": snap.error.code,
                        "technicalDetail": snap.error.technical_detail,
                        "exitCode": snap.error.exit_code,
                        "stderrTail": snap.error.stderr_tail,
                    }
                    if snap.error is not None
                    else None
                ),
                "data": snap.data,
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

        mandatory_failed = any(s == "failed" for s in mandatory_states)
        mandatory_terminal = all(s in ("success", "warning") for s in mandatory_states)
        mandatory_warned = any(s == "warning" for s in mandatory_states)

        if mandatory_failed:
            status = "failed"
        elif mandatory_terminal and resident_terminal:
            status = "degraded" if resident_state == "failed" or mandatory_warned else "ready"
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
            "instanceId": self.instance_id,
            "components": components,
        }

    def readiness_summary(self) -> dict[str, object]:
        """The reduced, terminal-only view GET /health/ready serves --
        distinct from snapshot() (GET /health/startup's per-component detail)
        so the two endpoints can't be confused with one another again."""
        full = self.snapshot()
        components = full["components"]
        mandatory = ("database", "modelRegistry", "runtimeManager")
        optional = ("residentModel",)
        return {
            "status": full["status"],
            "ready": full["ready"],
            "instanceId": full["instanceId"],
            "requiredComponents": {name: components[name]["state"] for name in mandatory},
            "optionalComponents": {name: components[name]["state"] for name in optional},
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
