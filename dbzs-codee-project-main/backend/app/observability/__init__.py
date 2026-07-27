"""
DBZS Observability Module

Zweck:
  Zentrale Observability-Schicht für Runtime-Chat, Agenten und Kontext-Workflows.
  Ermöglicht End-to-End-Tracing von Workflow-Schritten mit Korrelations-IDs.

Warum:
  - Bisher keine Verbindung zwischen Chat-Sitzungen, Agenten-Aktionen und Kontext
  - Workflows können nicht nachvollzogen werden
  - Debugging erfordert manuelle Log-Analyse

Wozu:
  - Audit-Trails für Agenten-Entscheidungen
  - Kontext-Flow-Nachverfolgung (welcher Kontext wurde wann verwendet?)
  - Session-Tracking für Runtime-Chat
  - Workflow-Replay für Debugging
"""

from .models import (
    WorkflowEvent,
    WorkflowEventType,
    WorkflowSession,
    WorkflowTrace,
    ContextBinding,
)
from .service import ObservabilityService
from .middleware import ObservabilityMiddleware

__all__ = [
    "WorkflowEvent",
    "WorkflowEventType",
    "WorkflowSession",
    "WorkflowTrace",
    "ContextBinding",
    "ObservabilityService",
    "ObservabilityMiddleware",
]
