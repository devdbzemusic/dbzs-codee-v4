"""
DBZS – Division By Zeros
Datei: gpu_exclusivity.py
Bereich: Backend Runtime

Zweck:
    Erzwingt, dass `fast_gpu` und `vision_gpu` nie gleichzeitig ein Modell auf
    derselben GPU resident halten.

Warum:
    Consumer-GPUs haben in der Regel nicht genug VRAM, um ein Coding- und ein
    Vision-Modell gleichzeitig geladen zu halten — der Start des einen Slots
    muss den anderen zuerst sauber stoppen (in-flight Requests abwarten statt
    hart zu killen), statt in einen OOM-Crash zu laufen.
"""

from __future__ import annotations

import time
from typing import Callable

EXCLUSIVE_GPU_SLOTS = ("fast_gpu", "vision_gpu")


def other_exclusive_gpu_slot(slot_id: str) -> str | None:
    """The GPU slot that must be stopped before `slot_id` can start, if any."""
    if slot_id not in EXCLUSIVE_GPU_SLOTS:
        return None
    return "vision_gpu" if slot_id == "fast_gpu" else "fast_gpu"


def wait_for_slot_drain(
    get_active_requests: Callable[[str], int],
    slot_id: str,
    timeout_seconds: float = 10.0,
    poll_interval_seconds: float = 0.2,
) -> bool:
    """Best-effort wait for in-flight requests on `slot_id` to finish.

    Returns True once drained, False if the timeout was hit. Callers must
    still proceed with stopping the slot either way — the exclusivity this
    protects matters more than one already-slow straggler request.
    """
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if get_active_requests(slot_id) <= 0:
            return True
        time.sleep(poll_interval_seconds)
    return get_active_requests(slot_id) <= 0
