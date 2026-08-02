"""Runtime Residency Cache (Phase 2).

Formalizes the existing 3-slot registry in RuntimeService (self._slots /
self._statuses) rather than building a second process table. This module
adds: a launch fingerprint so "reuse if same model_id" becomes "reuse only if
identical launch parameters", per-slot eviction policy, and idle tracking.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from enum import Enum
from typing import Literal

from app.models.schemas import IndexedModel
from app.runtime.schemas import RuntimeResidencyEntry, RuntimeResourcePlan, RuntimeSlotId

RamPressureTier = Literal["none", "warn", "evict_idle", "evict_resident", "evict_all_but_floor"]


class ResidencyPolicy(str, Enum):
    KEEP_RESIDENT = "keep_resident"
    IDLE_EVICT = "idle_evict"
    MANUAL = "manual"


DEFAULT_SLOT_POLICY: dict[str, ResidencyPolicy] = {
    "quality_cpu": ResidencyPolicy.KEEP_RESIDENT,  # Chat CPU
    "fast_gpu": ResidencyPolicy.KEEP_RESIDENT,  # Coding GPU
    "utility": ResidencyPolicy.IDLE_EVICT,
    "orchestrator_cpu": ResidencyPolicy.KEEP_RESIDENT,  # Router CPU
    "vision_gpu": ResidencyPolicy.IDLE_EVICT,  # Vision GPU, only resident while analyzing an image
}


def compute_launch_fingerprint(
    model: IndexedModel,
    plan: RuntimeResourcePlan,
    *,
    runtime_version: str,
    runtime_backend: str,
    chat_template_hash: str = "",
) -> str:
    """SHA256 over every launch-defining parameter.

    `model_file_proxy_hash` uses path+size rather than hashing the GGUF file's
    bytes — hashing multi-GB model files on every launch would be far too
    slow; path+size still catches "a different file was swapped in under the
    same model id" without that cost. `chat_template_hash` defaults to "" —
    this codebase has no chat-template extraction today (a GGUF-metadata
    concern, out of scope for Phase 2); treat it as a known limitation.
    """
    payload = {
        "model_id": model.id,
        "model_file_proxy_hash": f"{model.path}:{model.size_bytes}",
        "runtime_version": runtime_version,
        "context_size": plan.context_size,
        "gpu_layers": plan.gpu_layers,
        "batch_size": plan.batch_size,
        "micro_batch_size": plan.micro_batch_size,
        "parallel": plan.parallel,
        "cache_type_k": plan.cache_type_k,
        "cache_type_v": plan.cache_type_v,
        "chat_template_hash": chat_template_hash,
        "runtime_backend": runtime_backend,
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def classify_ram_pressure(percent_used: float) -> RamPressureTier:
    """Klassifiziert die prozentuale RAM-Auslastung in diskrete Handlungsstufen.

    - < 80%: Keine Aktion.
    - 80-85%: Warnung, kein Evict.
    - 85-90%: Evict von `IDLE_EVICT`-Slots.
    - 90-95%: Zusaetzlich Evict des aeltesten `KEEP_RESIDENT`-Slots.
    - >= 95%: Evict aller idle Slots ausser dem Floor-Slot.
    """
    if percent_used >= 95.0:
        return "evict_all_but_floor"
    if percent_used >= 90.0:
        return "evict_resident"
    if percent_used >= 85.0:
        return "evict_idle"
    if percent_used >= 80.0:
        return "warn"
    return "none"


class RuntimeResidencyRegistry:
    """Tracks residency metadata per slot.

    Wraps RuntimeService's own `_slots`/`_statuses` dicts — does not replace
    them. RuntimeService is the only writer; API routes only read.
    """

    def __init__(self) -> None:
        self._entries: dict[str, RuntimeResidencyEntry] = {}

    def policy_for_slot(self, slot_id: str) -> ResidencyPolicy:
        return DEFAULT_SLOT_POLICY.get(slot_id, ResidencyPolicy.IDLE_EVICT)

    def entry_for_slot(self, slot_id: str) -> RuntimeResidencyEntry | None:
        return self._entries.get(slot_id)

    def can_reuse(self, slot_id: str, candidate_fingerprint: str) -> bool:
        entry = self._entries.get(slot_id)
        return (
            entry is not None
            and entry.state != "error"
            and entry.launch_fingerprint == candidate_fingerprint
        )

    def record_started(
        self,
        slot_id: RuntimeSlotId,
        *,
        model_id: str,
        process_id: int,
        endpoint: str,
        launch_fingerprint: str,
        plan: RuntimeResourcePlan,
    ) -> RuntimeResidencyEntry:
        now = datetime.now(UTC).isoformat()
        entry = RuntimeResidencyEntry(
            slot_id=slot_id,
            model_id=model_id,
            process_id=process_id,
            endpoint=endpoint,
            launch_fingerprint=launch_fingerprint,
            context_size=plan.context_size,
            gpu_layers=plan.gpu_layers,
            batch_size=plan.batch_size,
            micro_batch_size=plan.micro_batch_size,
            parallel=plan.parallel,
            cache_type_k=plan.cache_type_k,
            cache_type_v=plan.cache_type_v,
            state="ready",
            active_requests=0,
            started_at=now,
            last_used_at=now,
            idle_since=now,
        )
        self._entries[slot_id] = entry
        return entry

    def record_shared(
        self,
        slot_id: RuntimeSlotId,
        *,
        source_entry: RuntimeResidencyEntry,
        process_id: int,
        endpoint: str,
    ) -> RuntimeResidencyEntry:
        """Register a slot that aliases another slot's already-running process
        (runtime reuse-across-slots). Tracked as its own entry so idle/eviction
        policy still applies per-slot: evicting this alias only clears the
        binding (`RuntimeService.stop_model_for_slot`), it never stops the
        shared process itself.
        """
        now = datetime.now(UTC).isoformat()
        entry = RuntimeResidencyEntry(
            slot_id=slot_id,
            model_id=source_entry.model_id,
            process_id=process_id,
            endpoint=endpoint,
            launch_fingerprint=source_entry.launch_fingerprint,
            context_size=source_entry.context_size,
            gpu_layers=source_entry.gpu_layers,
            batch_size=source_entry.batch_size,
            micro_batch_size=source_entry.micro_batch_size,
            parallel=source_entry.parallel,
            cache_type_k=source_entry.cache_type_k,
            cache_type_v=source_entry.cache_type_v,
            state="idle",
            active_requests=0,
            started_at=now,
            last_used_at=now,
            idle_since=now,
        )
        self._entries[slot_id] = entry
        return entry

    def record_stopped(self, slot_id: str) -> None:
        self._entries.pop(slot_id, None)

    def begin_request(self, slot_id: str) -> None:
        entry = self._entries.get(slot_id)
        if entry is None:
            return
        entry.active_requests += 1
        entry.state = "busy"
        entry.idle_since = None
        entry.last_used_at = datetime.now(UTC).isoformat()

    def end_request(self, slot_id: str) -> None:
        entry = self._entries.get(slot_id)
        if entry is None:
            return
        entry.active_requests = max(0, entry.active_requests - 1)
        entry.last_used_at = datetime.now(UTC).isoformat()
        if entry.active_requests == 0:
            entry.state = "idle"
            entry.idle_since = entry.last_used_at

    def is_idle_expired(self, slot_id: str, idle_timeout_seconds: float) -> bool:
        """True if the slot has policy=idle_evict, is idle, and past the timeout.

        Does not itself evict — callers (RuntimeService) still own stopping
        the process; this only answers "should it be stopped".
        """
        entry = self._entries.get(slot_id)
        if entry is None or entry.idle_since is None or entry.state != "idle":
            return False
        if self.policy_for_slot(slot_id) != ResidencyPolicy.IDLE_EVICT:
            return False
        idle_since = datetime.fromisoformat(entry.idle_since)
        elapsed = (datetime.now(UTC) - idle_since).total_seconds()
        return elapsed >= idle_timeout_seconds

    def mark_evicting(self, slot_id: str) -> None:
        entry = self._entries.get(slot_id)
        if entry is not None:
            entry.state = "evicting"
