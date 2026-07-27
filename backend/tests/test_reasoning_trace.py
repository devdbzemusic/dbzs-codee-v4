from pathlib import Path
import uuid

from app.rag.models import TraceEventBody
from app.rag.service import RagService
from app.rag.trace_service import TraceService


def test_trace_is_ordered_redacted_and_summarized(tmp_path: Path):
    trace = TraceService(RagService(tmp_path / f"rag-{uuid.uuid4()}.sqlite3"))
    events = trace.append("run-1", [
        TraceEventBody(id="e1", kind="retrieval_started", title="Suche", summary="token=YOUR_TOKEN_HERE", status="running"),
        TraceEventBody(id="e2", kind="retrieval_completed", title="Suche fertig", summary="4 Quellen", status="completed", source_refs=["src-1"]),
    ])
    assert [event["sequence"] for event in events] == [1, 2]
    assert "YOUR_TOKEN_HERE" not in events[0]["summary"]
    summary = trace.summary("run-1")
    assert summary["completed_steps"] == ["Suche fertig"]
    assert summary["current_step"] == "Suche"
    assert summary["source_refs"] == ["src-1"]


def test_trace_upsert_keeps_stable_sequence(tmp_path: Path):
    trace = TraceService(RagService(tmp_path / f"rag-{uuid.uuid4()}.sqlite3"))
    trace.append("run-1", [TraceEventBody(id="e1", kind="tool_started", title="Tool", summary="läuft", status="running")])
    events = trace.append("run-1", [TraceEventBody(id="e1", kind="tool_completed", title="Tool", summary="fertig", status="completed")])
    assert len(events) == 1
    assert events[0]["sequence"] == 1
    assert events[0]["kind"] == "tool_completed"
