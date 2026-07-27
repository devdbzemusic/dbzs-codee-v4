"""
DBZS Agent Loop — polls the job spooler and executes tasks via the backend HTTP API.

Each agent process runs this loop:
  1. Claim a job from the spooler (matching its role)
  2. Call the runtime LLM (or produce a fallback if runtime is offline)
  3. Post waypoints, save the output artifact, complete or fail the job
  4. Sleep, repeat

Run via:  python -m app.agents.agent_loop --agent-id coder --role coder
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

_DEFAULT_PORT = int(os.getenv("DBZS_BACKEND_PORT", "8876"))
_DEFAULT_BACKEND_URL = f"http://127.0.0.1:{_DEFAULT_PORT}"

_POLL_INTERVAL_SECONDS = 10.0
_HEARTBEAT_INTERVAL_SECONDS = 60.0
_LEASE_SECONDS = 180
_CLAIM_TIMEOUT = 5
_API_TIMEOUT = 30


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _request(method: str, url: str, payload: dict | None = None, timeout: int = _API_TIMEOUT) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urlrequest.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method=method,
    )
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(base: str, path: str, timeout: int = _API_TIMEOUT) -> dict:
    return _request("GET", f"{base}{path}", timeout=timeout)


def _post(base: str, path: str, payload: dict, timeout: int = _API_TIMEOUT) -> dict:
    return _request("POST", f"{base}{path}", payload, timeout=timeout)


# ---------------------------------------------------------------------------
# Job spooler helpers
# ---------------------------------------------------------------------------

def _claim_job(base: str, worker_id: str, role: str, max_attempts: int = 3) -> dict | None:
    try:
        resp = _post(base, "/job-spooler/claim", {
            "worker_id": worker_id,
            "supported_roles": [role],
            "lease_seconds": _LEASE_SECONDS,
            "max_attempts": max_attempts,
        }, timeout=_CLAIM_TIMEOUT)
        return resp.get("job")
    except Exception:
        return None


def _enqueue_subjob(base: str, parent_job_id: str, worker_id: str, role: str, title: str, prompt: str) -> str | None:
    try:
        resp = _post(base, "/job-spooler/enqueue", {
            "title": title[:180],
            "task_type": "generic",
            "priority": 5,
            "assigned_agent_role": role,
            "input_payload": {
                "prompt": prompt,
                "parent_job_id": parent_job_id,
                "delegated_by": worker_id,
            },
        })
        return str(resp.get("id", ""))
    except Exception as exc:
        _log("agent", f"[warn] could not enqueue sub-job: {exc}")
        return None


def _waypoint(base: str, job_id: str, worker_id: str, waypoint: str, message: str, progress: int | None = None) -> None:
    try:
        payload: dict[str, Any] = {"worker_id": worker_id, "waypoint": waypoint, "message": message}
        if progress is not None:
            payload["progress"] = progress
        _post(base, f"/job-spooler/{job_id}/waypoints", payload)
    except Exception:
        pass


def _heartbeat(base: str, job_id: str, worker_id: str) -> None:
    try:
        _post(base, f"/job-spooler/{job_id}/heartbeat", {
            "worker_id": worker_id,
            "lease_seconds": _LEASE_SECONDS,
        })
    except Exception:
        pass


def _add_artifact(base: str, job_id: str, worker_id: str, name: str, content: str, task_type: str, agent_id: str) -> None:
    try:
        _post(base, f"/job-spooler/{job_id}/artifacts", {
            "worker_id": worker_id,
            "kind": "output",
            "name": name,
            "content": content,
            "metadata": {"task_type": task_type, "agent_id": agent_id},
        })
    except Exception:
        pass


def _complete(base: str, job_id: str, worker_id: str, output: dict, summary: str) -> None:
    try:
        _post(base, f"/job-spooler/{job_id}/complete", {
            "worker_id": worker_id,
            "output_payload": output,
            "summary": summary,
        })
    except Exception as exc:
        _log("agent", f"[warn] complete failed for {job_id}: {exc}")


def _fail(base: str, job_id: str, worker_id: str, error_msg: str) -> None:
    try:
        _post(base, f"/job-spooler/{job_id}/fail", {
            "worker_id": worker_id,
            "error_message": error_msg,
        })
    except Exception as exc:
        _log("agent", f"[warn] fail failed for {job_id}: {exc}")


# ---------------------------------------------------------------------------
# Runtime helpers
# ---------------------------------------------------------------------------

def _runtime_state(base: str) -> str:
    try:
        resp = _get(base, "/runtime/status", timeout=4)
        return str(resp.get("state", "stopped"))
    except Exception:
        return "stopped"


def _runtime_chat(base: str, prompt: str) -> str:
    try:
        resp = _post(base, "/runtime/chat", {
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1024,
        })
        return str(resp.get("message", {}).get("content", ""))
    except urlerror.HTTPError as exc:
        return f"[Runtime-Fehler {exc.code}]"
    except Exception as exc:
        return f"[Runtime nicht erreichbar: {exc}]"


def _cloud_chat(prompt: str) -> str | None:
    """Cloud-Fallback über Anthropic oder OpenAI. Gibt None zurück wenn kein Key konfiguriert."""
    try:
        from app.runtime.cloud_client import CloudRuntimeClient
        client = CloudRuntimeClient()
        if not client.is_available():
            return None
        return client.chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        return f"[Cloud-Fallback-Fehler: {exc}]"


# ---------------------------------------------------------------------------
# Job dispatch
# ---------------------------------------------------------------------------

def _build_prompt(role: str, job: dict) -> str:
    payload = job.get("input_payload", {})
    title = job.get("title", "")
    task_type = job.get("task_type", "generic")

    instruction = str(payload.get("prompt") or payload.get("instruction") or title)
    context = str(payload.get("context") or "")

    role_prefix = {
        "planner": "Du bist ein Planungs-Agent. Zerlege die folgende Aufgabe in umsetzbare Schritte.",
        "coder": "Du bist ein Code-Agent. Implementiere die folgende Aufgabe sorgfaeltig.",
        "tester": "Du bist ein Test-Agent. Schreibe oder pruefe Tests fuer die folgende Aufgabe.",
        "reviewer": "Du bist ein Review-Agent. Pruefe die folgende Aenderung auf Risiken und Qualitaet.",
        "debugger": "Du bist ein Debug-Agent. Analysiere den folgenden Fehler und finde die Root Cause.",
        "docs": "Du bist ein Docs-Agent. Erstelle oder aktualisiere die Dokumentation fuer die folgende Aufgabe.",
    }.get(role, f"Du bist ein {role}-Agent.")

    parts = [f"[{task_type}] {role_prefix}", "", f"Aufgabe: {instruction}"]
    if context:
        parts += ["", f"Kontext:\n{context}"]
    return "\n".join(parts)


def _extract_patch_blocks(text: str) -> list[str]:
    """Extract ```diff or ```patch code blocks from LLM output."""
    return re.findall(r"```(?:diff|patch)\n(.*?)```", text, re.DOTALL)


def _dispatch_planner_subtasks(base: str, job_id: str, worker_id: str, response: str, agent_id: str) -> int:
    """Parse planner output for sub-task markers and enqueue them. Returns count dispatched."""
    count = 0
    for match in re.finditer(r"\[(\w+)\]\s+(.+)", response):
        role_tag = match.group(1).strip().lower()
        task_title = match.group(2).strip()
        valid_roles = {"planner", "coder", "tester", "reviewer", "debugger", "docs"}
        if role_tag not in valid_roles:
            continue
        sub_id = _enqueue_subjob(base, job_id, worker_id, role_tag, task_title, task_title)
        if sub_id:
            _log(agent_id, f"  → Sub-Job enqueued for [{role_tag}]: {task_title!r} (id={sub_id})")
            count += 1
    return count


def _process_job(base: str, job: dict, worker_id: str, role: str, agent_id: str) -> None:
    job_id = str(job["id"])
    title = str(job.get("title", ""))
    task_type = str(job.get("task_type", "generic"))

    _log(agent_id, f"Job {job_id} [{task_type}]: {title!r}")
    _waypoint(base, job_id, worker_id, "started", f"{agent_id} hat Job uebernommen.")

    try:
        prompt = _build_prompt(role, job)
        _waypoint(base, job_id, worker_id, "progress", "Anfrage an Runtime...", progress=20)

        state = _runtime_state(base)
        if state == "running":
            response = _runtime_chat(base, prompt)
        else:
            cloud_response = _cloud_chat(prompt)
            if cloud_response is not None:
                _waypoint(base, job_id, worker_id, "progress", "Cloud-Fallback verwendet.", progress=30)
                response = cloud_response
            else:
                response = (
                    f"[{agent_id} / {role}] Runtime nicht aktiv (state={state!r}) "
                    f"und kein Cloud-Fallback konfiguriert.\n\nAufgabe: {title}"
                )

        _waypoint(base, job_id, worker_id, "progress", "Antwort erhalten, verarbeite...", progress=80)

        # Save main output artifact
        _add_artifact(base, job_id, worker_id, f"{role}_output.md", response, task_type, agent_id)

        # Coder: extract and save patch/diff blocks as evidence artifacts
        if role == "coder":
            patches = _extract_patch_blocks(response)
            for i, patch in enumerate(patches, 1):
                _add_artifact(base, job_id, worker_id, f"patch_{i:02d}.diff", patch, task_type, agent_id)
                _log(agent_id, f"  → Patch-Block {i} als Artefakt gespeichert.")

        # Planner: dispatch sub-tasks to other agents
        if role == "planner":
            count = _dispatch_planner_subtasks(base, job_id, worker_id, response, agent_id)
            if count > 0:
                _waypoint(base, job_id, worker_id, "progress", f"Planer hat {count} Sub-Job(s) delegiert.", progress=90)

        _complete(base, job_id, worker_id, {"response": response}, f"{role} abgeschlossen.")
        _log(agent_id, f"Job {job_id} abgeschlossen.")

    except Exception as exc:
        msg = f"{agent_id} unerwarteter Fehler: {exc}"
        _log(agent_id, f"Job {job_id} fehlgeschlagen: {exc}")
        _fail(base, job_id, worker_id, msg)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def _log(agent_id: str, message: str) -> None:
    print(f"[{agent_id}] {message}", flush=True)


def run(agent_id: str, role: str, backend_url: str, max_attempts: int = 3) -> None:
    import uuid as _uuid
    worker_id = f"{agent_id}-{_uuid.uuid4().hex[:8]}"

    _log(agent_id, f"Gestartet (role={role}, worker={worker_id}, backend={backend_url}, max_attempts={max_attempts})")

    last_heartbeat_ts: dict[str, float] = {}
    last_global_heartbeat = time.monotonic()

    try:
        while True:
            now = time.monotonic()

            # Periodic global heartbeat log
            if now - last_global_heartbeat >= _HEARTBEAT_INTERVAL_SECONDS:
                _log(agent_id, "Heartbeat — warte auf Jobs.")
                last_global_heartbeat = now

            job = _claim_job(backend_url, worker_id, role, max_attempts=max_attempts)
            if job:
                job_id = str(job["id"])
                last_heartbeat_ts[job_id] = time.monotonic()

                _process_job(backend_url, job, worker_id, role, agent_id)
                last_heartbeat_ts.pop(job_id, None)
            else:
                time.sleep(_POLL_INTERVAL_SECONDS)

    except KeyboardInterrupt:
        _log(agent_id, "Stoppe (Interrupt).")
        sys.exit(0)


def main() -> None:
    parser = argparse.ArgumentParser(description="DBZS Agent Loop")
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--role", default="coder")
    parser.add_argument("--backend-url", default=_DEFAULT_BACKEND_URL)
    parser.add_argument("--max-attempts", type=int, default=3)
    args = parser.parse_args()
    run(args.agent_id, args.role, args.backend_url, max_attempts=args.max_attempts)


if __name__ == "__main__":
    main()
