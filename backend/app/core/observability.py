"""Lightweight observability helpers for hardening events."""
from __future__ import annotations

import json
import logging
from collections import deque
from typing import Any

logger = logging.getLogger("dbzs.hardening")

MAX_BUFFERED_EVENTS = 200
_event_buffer: deque[dict[str, Any]] = deque(maxlen=MAX_BUFFERED_EVENTS)


def emit_hardening_event(event_type: str, **payload: Any) -> None:
    """Emit a structured event for security and routing hardening decisions."""
    event = {"event_type": event_type, **payload}
    _event_buffer.append(event)
    logger.info("hardening_event %s", json.dumps(event, ensure_ascii=False, sort_keys=True))


def get_recent_hardening_events(limit: int = 20) -> list[dict[str, Any]]:
    """Return the most recent buffered hardening events for debugging or UI inspection."""
    return list(_event_buffer)[-limit:]
