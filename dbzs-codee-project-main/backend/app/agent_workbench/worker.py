"""Single-worker asyncio loop for agent run execution."""

from __future__ import annotations

import threading
import time
import os
import json
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.agent_workbench.planner import demo_readonly_steps
from app.agent_workbench.state_machine import is_run_terminal

if TYPE_CHECKING:
    from app.agent_workbench.service import AgentWorkbenchService

DEFAULT_STEP_TIMEOUT_SECONDS = 30.0
POLL_INTERVAL = 0.25


class AgentWorkbenchWorker:
    """Background worker executing one run at a time."""

    def __init__(self, service: AgentWorkbenchService) -> None:
        self._service = service
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._active_run_id: str | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="agent-workbench-worker")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

    def wake(self) -> None:
        self._wake_event.set()

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            self._wake_event.wait(timeout=POLL_INTERVAL)
            self._wake_event.clear()
            try:
                self._process_runs()
            except Exception:
                pass

    def _process_runs(self) -> None:
        with self._lock:
            if self._active_run_id is not None:
                return

        runs = self._service.list_runs(limit=20)
        for run in runs:
            if run.status != "running":
                continue
            with self._lock:
                self._active_run_id = run.id
            try:
                self._execute_run(run.id)
            finally:
                with self._lock:
                    self._active_run_id = None
            break

    def _execute_run(self, run_id: str) -> None:
        run = self._service.get_run(run_id)
        steps = self._service.list_steps(run_id)
        completed_count = sum(1 for s in steps if s.status == "completed")

        if completed_count >= run.max_steps:
            self._service.complete_run(run_id)
            return

        for step in steps:
            current = self._service.get_run(run_id)
            if current.status in {"paused", "cancelled", "failed", "completed"}:
                return
            if current.status == "paused_recovery":
                return

            if step.status != "pending":
                continue

            if self._service.repo.count_active_steps(run_id) >= 1:
                return

            try:
                self._service.activate_step(run_id, step.id)
            except Exception:
                return

            deadline = time.monotonic() + DEFAULT_STEP_TIMEOUT_SECONDS
            try:
                self._run_step(run_id, step.id, run.execution_mode, run.workspace_root)
            except Exception as exc:
                self._service.fail_step(run_id, step.id, str(exc))
                self._service.fail_run(run_id, str(exc))
                return

            if time.monotonic() > deadline:
                self._service.fail_step(run_id, step.id, "Step timeout")
                self._service.pause_run(run_id)
                return

            self._service.complete_step(run_id, step.id, output_summary="Step completed")
            completed_count += 1

            current = self._service.get_run(run_id)
            if current.status == "paused":
                return

            if completed_count >= run.max_steps:
                break

        current = self._service.get_run(run_id)
        if current.status == "running":
            pending = [s for s in self._service.list_steps(run_id) if s.status == "pending"]
            if not pending:
                self._service.complete_run(run_id)

    def _run_step(
        self,
        run_id: str,
        step_id: str,
        execution_mode: str,
        workspace_root: str,
    ) -> None:
        step = self._service.repo.get_step(step_id)
        if step is None:
            return

        current = self._service.get_run(run_id)
        if current.status == "cancelled":
            raise RuntimeError("Run cancelled")

        # Verify the runtime connection or ensure active local server via AgentRuntimeAdapter
        adapter = self._service.runtime_adapter
        if adapter is not None:
            # Let the adapter check health or boot the LLM model configured for the run
            verify_res = adapter.verify_runtime(current)
            if not verify_res.verified:
                self._service._events.append_event_standalone(
                    run_id=run_id,
                    step_id=step_id,
                    event_type="run.failed",
                    summary=f"Runtime-Verbindung fehlgeschlagen: {verify_res.error_message}",
                    payload={"health_state": verify_res.health_state},
                )
                raise RuntimeError(f"Runtime unavailable: {verify_res.error_message}")

        demo_titles = {s.title for s in demo_readonly_steps()}
        use_tools = execution_mode != "read_only" or step.title in demo_titles or "Demo:" in step.title

        if use_tools:
            self._run_tool_step(run_id, step_id, step, workspace_root)
        else:
            self._service._events.append_event_standalone(
                run_id=run_id,
                step_id=step_id,
                event_type="step.progress",
                summary=f"Read-only demo progress: {step.title}",
                payload={"mode": "demo"},
            )
            time.sleep(0.05)

    def _run_tool_step(
        self,
        run_id: str,
        step_id: str,
        step: Any,
        workspace_root: str,
    ) -> None:
        from app.agent_workbench.models import AgentStep
        from app.agent_workbench.prompts import AGENT_WORKBENCH_SYSTEM_PROMPT

        assert isinstance(step, AgentStep)
        run = self._service.get_run(run_id)

        # Build context history from events
        events_list = self._service.list_events(run_id)
        messages_to_send = [
            {"role": "system", "content": AGENT_WORKBENCH_SYSTEM_PROMPT},
            {"role": "user", "content": f"We are on Step {step.ordinal}: '{step.title}' (Description: {step.description}). Goal of this run: '{run.goal}'."},
        ]

        for evt in events_list:
            if evt.event_type in {"tool.completed", "tool.failed"}:
                messages_to_send.append({"role": "user", "content": f"Event: {evt.event_type} - Summe: {evt.summary}. Details: {evt.payload_json}"})

        # Call local model turn
        adapter = self._service.runtime_adapter
        if adapter is not None and not self._service._simulate_llm:
            try:
                self._service._events.append_event_standalone(
                    run_id=run_id,
                    step_id=step_id,
                    event_type="step.progress",
                    summary="Sende Turn-Anfrage an lokales LLM...",
                )
                response = adapter.complete_turn(run, messages_to_send)
                turn_data = json.loads(response.content)
            except Exception as exc:
                self._service._events.append_event_standalone(
                    run_id=run_id,
                    step_id=step_id,
                    event_type="step.progress",
                    summary=f"Lokales LLM Turn fehlgeschlagen oder ungültiges JSON: {exc}",
                )
                # Fallback to hardcoded tool selection if LLM fails
                turn_data = {}
        else:
            turn_data = {}

        # Parse output fields (1: tool_call, 2: proposed_change, 3: host_action, 4: follow_up)
        # 1. Tool Loop Integration
        tool_call_data = turn_data.get("tool_call")
        tool_id: str | None = None
        if tool_call_data and isinstance(tool_call_data, dict):
            tool_id_raw = tool_call_data.get("tool_id")
            if isinstance(tool_id_raw, str):
                tool_id = tool_id_raw
            args = tool_call_data.get("arguments") or {}
        else:
            args = {}

        if not tool_id:
            # Fallback heuristics
            title_lower = step.title.lower()
            if "auflisten" in title_lower or "list" in title_lower:
                tool_id = "filesystem.list"
                args = {"path": "."}
            elif "erkennen" in title_lower or "detect" in title_lower or "projekt" in title_lower:
                tool_id = "project.detect"
                args = {}
            elif "git" in title_lower:
                tool_id = "git.status"
                args = {}
            elif "kontext" in title_lower or "lesen" in title_lower or "read" in title_lower:
                tool_id = "filesystem.read"
                args = {"path": "README.md"}
            elif "suche" in title_lower or "search" in title_lower:
                tool_id = "filesystem.search"
                args = {"query": "", "glob": "**/*", "path": "."}
            else:
                tool_id = "filesystem.list"
                args = {"path": "."}

        self._service._events.append_event_standalone(
            run_id=run_id,
            step_id=step_id,
            event_type="tool.requested",
            summary=f"Tool angefordert: {tool_id}",
            payload={"tool_id": tool_id, "arguments": args},
        )

        tool_call = self._service.tools.execute_tool(
            run_id=run_id,
            step_id=step_id,
            tool_id=tool_id,
            arguments=args,
            workspace_root=workspace_root,
        )

        event_type = "tool.completed" if tool_call.status == "completed" else "tool.failed"
        self._service._events.append_event_standalone(
            run_id=run_id,
            step_id=step_id,
            event_type=event_type,
            summary=f"Tool {tool_id}: {tool_call.status}",
            severity="info" if tool_call.status == "completed" else "error",
            payload={"tool_call_id": tool_call.id, "tool_id": tool_id},
        )

        if tool_call.status != "completed":
            raise RuntimeError(tool_call.error_message or f"Tool {tool_id} failed")

        # 2. File proposed change & Review Gates integration
        proposed_change = turn_data.get("proposed_change")
        if proposed_change and isinstance(proposed_change, dict):
            p_file = proposed_change.get("file_path")
            p_op = proposed_change.get("operation")
            p_explanation = proposed_change.get("explanation") or ""
            p_content = proposed_change.get("content") or ""

            if p_file and p_op:
                from app.agent_workbench.models import ProposeFileChangeRequest
                self._service.file_changes.propose_change(
                    run_id=run_id,
                    step_id=step_id,
                    workspace_root=workspace_root,
                    request=ProposeFileChangeRequest(
                        file_path=p_file,
                        operation=p_op,
                        summary=p_explanation,
                        proposed_content=p_content,
                    )
                )

        # 3. Host Action Integration
        host_action = turn_data.get("host_action")
        if host_action and isinstance(host_action, dict):
            ha_type = host_action.get("action_type")
            ha_payload = host_action.get("payload") or {}
            if ha_type:
                self._service._host_actions.create_action(
                    run_id=run_id,
                    step_id=step_id,
                    action_type=ha_type,
                    payload=ha_payload,
                )

        # 4. Follow Up Integration
        follow_up = turn_data.get("follow_up")
        if follow_up and isinstance(follow_up, dict):
            fu_text = follow_up.get("text")
            if fu_text:
                from app.agent_workbench.models import FollowUpRequest
                self._service.followups.create_followup(
                    run_id=run_id,
                    request=FollowUpRequest(text=fu_text)
                )

        if self._service._simulate_llm:
            self._service._events.append_event_standalone(
                run_id=run_id,
                step_id=step_id,
                event_type="step.progress",
                summary="Simulated LLM iteration complete",
                payload={"simulated": True},
            )
