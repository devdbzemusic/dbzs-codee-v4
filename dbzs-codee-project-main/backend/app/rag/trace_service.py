"""DBZS – Deterministischer und redigierter Execution-Trace-Service.

Speichert ausschließlich reale Systemereignisse und erzeugt daraus eine sichere
Zusammenfassung. Private Modellgedanken, Systemprompts und Secrets sind kein Input.
"""

from __future__ import annotations

import json
import uuid

from app.rag.models import TraceEventBody
from app.rag.service import RagService, now_iso
from app.core.secret_redaction import redact_text, redact_value

ALLOWED_KINDS = {
    "intent_detected", "model_selected", "context_cache_hit", "context_cache_miss",
    "retrieval_started", "retrieval_completed", "sources_selected", "plan_created",
    "approval_requested", "approval_granted", "approval_rejected", "tool_started", "tool_completed",
    "patch_proposed", "patch_applied", "command_started", "command_completed", "web_search_started",
    "web_search_completed", "validation_started", "validation_completed", "retry_started",
    "run_completed", "run_failed",
}
def redact(value: str, limit: int = 500) -> str:
    return redact_text(value, limit)


def safe_metadata(value: dict) -> dict:
    redacted = redact_value(value)
    return {key: item for key, item in redacted.items() if isinstance(item, (str, int, float, bool)) or item is None}


class TraceService:
    def __init__(self, rag: RagService) -> None:
        self.rag = rag

    def append(self, run_id: str, events: list[TraceEventBody]) -> list[dict]:
        with self.rag._connect() as conn:
            next_seq = conn.execute("SELECT COALESCE(MAX(sequence),0)+1 n FROM agent_trace_events WHERE run_id=?", (run_id,)).fetchone()["n"]
            for event in events:
                if event.kind not in ALLOWED_KINDS:
                    raise ValueError(f"Unbekannter Trace-Event-Typ: {event.kind}")
                existing = conn.execute("SELECT sequence FROM agent_trace_events WHERE id=?", (event.id,)).fetchone()
                sequence = existing["sequence"] if existing else next_seq
                if not existing: next_seq += 1
                conn.execute("""INSERT OR REPLACE INTO agent_trace_events
                    (id,run_id,sequence,message_id,kind,title,summary,status,source_refs_json,metadata_json,started_at,completed_at,duration_ms,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                    event.id, run_id, sequence, event.message_id, event.kind, redact(event.title, 120),
                    redact(event.summary), event.status, json.dumps(event.source_refs), json.dumps(safe_metadata(event.metadata)),
                    event.started_at, event.completed_at, event.duration_ms, now_iso(),
                ))
        return self.list(run_id)

    def list(self, run_id: str) -> list[dict]:
        with self.rag._connect() as conn:
            rows = conn.execute("SELECT * FROM agent_trace_events WHERE run_id=? ORDER BY sequence,id", (run_id,)).fetchall()
        return [{"id": r["id"], "run_id": r["run_id"], "message_id": r["message_id"], "kind": r["kind"], "title": r["title"], "summary": r["summary"], "status": r["status"], "source_refs": json.loads(r["source_refs_json"]), "metadata": json.loads(r["metadata_json"]), "started_at": r["started_at"], "completed_at": r["completed_at"], "duration_ms": r["duration_ms"], "sequence": r["sequence"]} for r in rows]

    def summary(self, run_id: str) -> dict:
        events = self.list(run_id)
        completed = [e["title"] for e in events if e["status"] == "completed"]
        current = next((e["title"] for e in reversed(events) if e["status"] in {"running", "pending"}), None)
        failed = [e["summary"] for e in events if e["status"] == "failed"]
        source_refs = list(dict.fromkeys(ref for event in events for ref in event["source_refs"]))
        if failed:
            text = f"{len(completed)} Schritte abgeschlossen; letzter Fehler: {failed[-1]}"
        elif current:
            text = f"{len(completed)} Schritte abgeschlossen; aktuell: {current}"
        else:
            text = f"{len(completed)} Schritte abgeschlossen."
        return {"id": f"summary-{uuid.uuid5(uuid.NAMESPACE_URL, run_id)}", "run_id": run_id, "title": "CODEE Ablauf", "summary": text, "completed_steps": completed, "current_step": current, "risks": failed, "next_action": current, "source_refs": source_refs, "created_at": now_iso()}
