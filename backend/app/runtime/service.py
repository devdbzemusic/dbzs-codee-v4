from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib import error, request

try:
    import psutil  # type: ignore[import-not-found]
except ModuleNotFoundError:
    psutil = None  # type: ignore[assignment]

_SIMULATION_MODE = os.getenv("DBZS_RUNTIME_SIMULATION", "0").strip() == "1"

from app.antigravity.service import AntigravityAgentService
from app.core.config import get_ollama_dir, get_ollama_models_dir
from app.models.index_service import ModelIndexService
from app.models.schemas import IndexedModel
from app.runtime.launch import (
    build_launch_plan,
    default_warmup_interval_seconds,
    default_warmup_timeout_seconds,
    is_oom_stderr,
    wait_for_runtime_endpoint,
    resolve_preferred_port,
)
from app.runtime.chat_stream import (
    parse_llama_server_sse_finish_reason,
    parse_llama_server_sse_has_tool_call,
    parse_llama_server_sse_line,
)
from app.runtime.chat_clients import LlamaServerChatClient, OllamaChatClient
from app.runtime.cloud_client import CloudRuntimeClient
from app.runtime.gpu_detect import GpuInfo, detect_gpu
from app.runtime.hardware_fingerprint import collect_hardware_fingerprint, fingerprint_hash
from app.runtime.process_runner import CapturingSubprocessRunner
from app.runtime.prompts import RUNTIME_CHAT_SYSTEM_PROMPT
from app.runtime.residency import RuntimeResidencyRegistry, compute_launch_fingerprint
from app.runtime.resource_planner import RuntimeResourcePlanner
from app.runtime.service_persistence import (
    provider_for_model,
    read_json_file,
    utc_now_iso,
    write_json_file,
)
from app.runtime.service_types import ChatClient, ManagedProcess, ProcessRunner, RuntimeStreamContext
from app.runtime.slot_contract import slot_id_for_port, slot_port
from app.runtime.schemas import (
    RuntimeChatMessage,
    RuntimeChatRequest,
    RuntimeChatResponse,
    RuntimeFallbackPolicy,
    RuntimeLogsResponse,
    RuntimeProfileName,
    RuntimeResidencyEntry,
    RuntimeResourcePlan,
    RuntimeSlotId,
    RuntimeStatus,
    RuntimeWarmupDiagnostics,
    RuntimeWarmupResult,
)

_MAX_OOM_RETRIES = 3


def normalize_runtime_endpoint(endpoint: str) -> str:
    """Rewrite loopback-only hosts that llama-server may advertise as 0.0.0.0."""
    value = endpoint.strip().rstrip("/")
    if not value:
        return value
    lowered = value.lower()
    for bad, good in (
        ("://0.0.0.0", "://127.0.0.1"),
        ("://[::]", "://127.0.0.1"),
        ("://::", "://127.0.0.1"),
    ):
        if bad in lowered:
            idx = lowered.index(bad)
            value = value[:idx] + good + value[idx + len(bad) :]
            lowered = value.lower()
    return value


def _default_port_for_slot(slot_id: str) -> int:
    try:
        return slot_port(slot_id)
    except ValueError:
        return 8091


def _build_sampling_payload(chat_request: RuntimeChatRequest) -> dict:
    """Build conservative llama.cpp/OpenAI-compatible sampling options."""
    return {
        "temperature": chat_request.temperature,
        "top_p": chat_request.top_p if chat_request.top_p is not None else 0.88,
        "min_p": chat_request.min_p if chat_request.min_p is not None else 0.05,
        "repeat_penalty": chat_request.repeat_penalty if chat_request.repeat_penalty is not None else 1.18,
        "repeat_last_n": chat_request.repeat_last_n if chat_request.repeat_last_n is not None else 256,
        "presence_penalty": chat_request.presence_penalty if chat_request.presence_penalty is not None else 0.15,
        "frequency_penalty": chat_request.frequency_penalty if chat_request.frequency_penalty is not None else 0.25,
    }


class RuntimeService:
    def __init__(
        self,
        model_index_service: ModelIndexService | None = None,
        process_runner: ProcessRunner | None = None,
        chat_client: ChatClient | None = None,
        ollama_chat_client: ChatClient | None = None,
        ollama_dir: Path | None = None,
        ollama_models_dir: Path | None = None,
        endpoint_checker: Callable[[str], bool] | None = None,
        warmup_timeout_seconds: float | None = None,
        warmup_interval_seconds: float | None = None,
        simulation_mode: bool | None = None,
        antigravity_service: AntigravityAgentService | None = None,
        gpu_detector: Callable[[], GpuInfo | None] | None = None,
    ) -> None:
        self.model_index_service = model_index_service or ModelIndexService()
        self.process_runner = process_runner or CapturingSubprocessRunner()
        self.chat_client = chat_client or LlamaServerChatClient()
        self.ollama_chat_client = ollama_chat_client or OllamaChatClient()
        self.ollama_dir = ollama_dir or get_ollama_dir()
        self.ollama_models_dir = ollama_models_dir or get_ollama_models_dir()
        self.models_dir = self.model_index_service.models_dir
        self._endpoint_checker = endpoint_checker or self._endpoint_available
        self._warmup_timeout_seconds = (
            warmup_timeout_seconds if warmup_timeout_seconds is not None else default_warmup_timeout_seconds()
        )
        self._warmup_interval_seconds = (
            warmup_interval_seconds if warmup_interval_seconds is not None else default_warmup_interval_seconds()
        )
        self._slots: dict[str, ManagedProcess | None] = {}
        self._external_slot_pids: dict[str, int] = {}
        self._shared_slot_bindings: dict[str, str] = {}
        self._statuses: dict[str, RuntimeStatus] = {
            "fast_gpu": RuntimeStatus(state="stopped", slot_id="fast_gpu"),
            "quality_cpu": RuntimeStatus(state="stopped", slot_id="quality_cpu"),
            "utility": RuntimeStatus(state="stopped", slot_id="utility"),
            "orchestrator_cpu": RuntimeStatus(state="stopped", slot_id="orchestrator_cpu"),
        }
        self._last_active_slot_id: str = "quality_cpu"
        self._process: ManagedProcess | None = None
        self._status = RuntimeStatus(state="stopped")
        self._simulation_mode: bool = simulation_mode if simulation_mode is not None else _SIMULATION_MODE
        self.antigravity_service = antigravity_service or AntigravityAgentService()
        self._slot_locks = {
            "fast_gpu": threading.Lock(),
            "quality_cpu": threading.Lock(),
            "utility": threading.Lock(),
            "orchestrator_cpu": threading.Lock(),
        }
        # P2 Phase 5: Initialize tool registry
        from app.runtime.tool_registry import RuntimeToolRegistry
        from app.runtime.win_runtimes import discover_win_llama_runtime_dirs

        # P1 Requirement 10: In strict mode, tool registry searches ONLY project runtime
        # plus the configured Windows runtime root (D:/win_runtimes by default).
        runtime_dir = self.models_dir / "llama.cpp-win-runtime"
        strict_mode = getattr(self.model_index_service, "discovery_mode", "project_local_strict")
        runtime_search_paths = [str(runtime_dir), str(runtime_dir / "bin"), str(self.models_dir)]
        for win_runtime in discover_win_llama_runtime_dirs():
            runtime_search_paths.append(str(win_runtime))
            runtime_search_paths.append(str(win_runtime / "bin"))
        self.tool_registry = RuntimeToolRegistry(
            search_paths=runtime_search_paths,
            allow_system_path=False if strict_mode == "project_local_strict" else True,
        )
        self.tool_registry.discover_tools()  # Pre-discover on startup
        self.fallback_policy: RuntimeFallbackPolicy = "strict"
        # Phase 1: Runtime Resource Planner — replaces the old slot-hardcoded
        # ctx/gpu-layers overrides with hardware-fit, model-size-aware plans.
        self.resource_planner = RuntimeResourcePlanner()
        # Injectable so tests don't shell out to nvidia-smi/wmic on every start_model() call.
        self._gpu_detector: Callable[[], GpuInfo | None] = gpu_detector or detect_gpu
        # Phase 2: Runtime Residency Cache — wraps self._slots/_statuses, doesn't replace them.
        self.residency = RuntimeResidencyRegistry()
        # Phase 5: usage stats from the most recent chat_stream() call (llama-server only).
        self._last_chat_usage: dict[str, int] | None = None
        self._last_chat_finish_reason: str | None = None
        self.cloud_runtime_client = CloudRuntimeClient()


    def status(self) -> RuntimeStatus:
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        return self.status_for_slot(active_slot)

    def _clear_shared_slot_binding(self, slot_id: str) -> None:
        self._shared_slot_bindings.pop(slot_id, None)

    def _clear_external_slot_pid(self, slot_id: str) -> None:
        self._external_slot_pids.pop(slot_id, None)

    def _listening_pid_for_port(self, port: int) -> int | None:
        if psutil is None:
            return None
        try:
            for conn in psutil.net_connections(kind="tcp"):
                if conn.status == psutil.CONN_LISTEN and conn.laddr and conn.laddr.port == port and conn.pid:
                    return int(conn.pid)
        except Exception:
            return None
        return None

    def _pid_commandline(self, pid: int) -> str | None:
        if psutil is None:
            return None
        try:
            return " ".join(psutil.Process(pid).cmdline())
        except Exception:
            return None

    def _pid_exists(self, pid: int) -> bool:
        if psutil is None or not hasattr(psutil, "pid_exists"):
            return True
        try:
            return bool(psutil.pid_exists(pid))
        except Exception:
            return True

    def _port_owner_matches_model(self, port: int, model: IndexedModel) -> tuple[bool, int | None, str | None]:
        owner_pid = self._listening_pid_for_port(port)
        if owner_pid is None:
            return False, None, None
        command_line = self._pid_commandline(owner_pid)
        model_path = str(Path(model.path)).lower()
        return bool(command_line and model_path in command_line.lower()), owner_pid, command_line

    def _is_stale_port_conflict_status(self, slot_id: str, status: RuntimeStatus) -> bool:
        message = status.message or ""
        if status.state != "error" or "already serving another runtime process" not in message:
            return False

        port = status.port or _default_port_for_slot(slot_id)
        owner_pid = self._listening_pid_for_port(port)
        return owner_pid is None

    def _bind_shared_slot(self, target_slot_id: str, source_slot_id: str) -> RuntimeStatus:
        if target_slot_id == source_slot_id:
            self._clear_shared_slot_binding(target_slot_id)
            return self.status_for_slot(source_slot_id)

        source_status = self.status_for_slot(source_slot_id)
        if source_status.state != "running" or not source_status.endpoint:
            self._clear_shared_slot_binding(target_slot_id)
            stopped = RuntimeStatus(state="stopped", slot_id=target_slot_id)
            self._statuses[target_slot_id] = stopped
            return stopped

        self._shared_slot_bindings[target_slot_id] = source_slot_id
        alias_status = source_status.model_copy(
            update={
                "slot_id": target_slot_id,
                "message": (
                    source_status.message
                    or f"Shared runtime via slot '{source_slot_id}'."
                ),
            }
        )
        self._statuses[target_slot_id] = alias_status
        source_entry = self.residency.entry_for_slot(source_slot_id)
        if source_entry is not None and source_status.pid is not None and source_status.endpoint:
            self.residency.record_shared(
                target_slot_id,
                source_entry=source_entry,
                process_id=source_status.pid,
                endpoint=source_status.endpoint,
            )
        return alias_status

    def _find_running_slot_for_model(
        self,
        model_id: str,
        *,
        exclude_slot_id: str | None = None,
    ) -> str | None:
        for candidate_slot_id in self._statuses:
            if candidate_slot_id == exclude_slot_id:
                continue
            candidate_status = self.status_for_slot(candidate_slot_id)
            if candidate_status.state == "running" and candidate_status.model_id == model_id and candidate_status.endpoint:
                return candidate_slot_id
        return None

    def status_for_slot(self, slot_id: str) -> RuntimeStatus:
        if self._simulation_mode:
            return self._statuses.get(slot_id, RuntimeStatus(state="stopped", slot_id=slot_id))
        bound_slot_id = self._shared_slot_bindings.get(slot_id)
        if bound_slot_id:
            bound_status = self.status_for_slot(bound_slot_id)
            if bound_status.state == "running" and bound_status.endpoint:
                alias_status = bound_status.model_copy(
                    update={
                        "slot_id": slot_id,
                        "message": (
                            bound_status.message
                            or f"Shared runtime via slot '{bound_slot_id}'."
                        ),
                    }
                )
                self._statuses[slot_id] = alias_status
                if slot_id == getattr(self, "_last_active_slot_id", "quality_cpu"):
                    self._process = self._slots.get(bound_slot_id)
                    self._status = alias_status
                return alias_status
            self._clear_shared_slot_binding(slot_id)
            self._statuses[slot_id] = RuntimeStatus(state="stopped", slot_id=slot_id)
        external_pid = self._external_slot_pids.get(slot_id)
        current = self._statuses.get(slot_id, RuntimeStatus(state="stopped", slot_id=slot_id))
        if (
            process := self._slots.get(slot_id)
        ) is None and external_pid is None and self._is_stale_port_conflict_status(slot_id, current):
            current = RuntimeStatus(state="stopped", slot_id=slot_id, message="Stale port-conflict state cleared.")
            self._statuses[slot_id] = current
        if external_pid and current.port:
            owner_pid = self._listening_pid_for_port(current.port)
            if owner_pid == external_pid:
                if slot_id == getattr(self, "_last_active_slot_id", "quality_cpu"):
                    self._process = None
                    self._status = current
                return current
            self._clear_external_slot_pid(slot_id)
            self._statuses[slot_id] = RuntimeStatus(state="stopped", slot_id=slot_id)
        if process and process.poll() is not None:
            self._slots[slot_id] = None
            self._statuses[slot_id] = RuntimeStatus(
                state="stopped",
                slot_id=slot_id,
                message=f"Runtime process for slot '{slot_id}' exited."
            )
        # update backwards-compatible fields
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        if slot_id == active_slot:
            self._process = self._slots.get(active_slot)
            self._status = self._statuses.get(active_slot, RuntimeStatus(state="stopped", slot_id=active_slot))
        return self._statuses.get(slot_id, RuntimeStatus(state="stopped", slot_id=slot_id))

    def get_last_chat_usage(self) -> dict[str, int] | None:
        """Usage stats from the most recently completed chat_stream() call."""
        return self._last_chat_usage

    def get_last_chat_finish_reason(self) -> str | None:
        return self._last_chat_finish_reason

    def tokenize(self, slot_id: str, text: str) -> int:
        """Real token count via the running slot's own llama-server /tokenize
        endpoint (Phase 5) — replaces the chars/4 heuristic wherever a slot is
        actually reachable. Callers fall back to the heuristic themselves
        when this raises (e.g. slot not running).
        """
        status = self.status_for_slot(slot_id)
        if status.state != "running" or not status.endpoint:
            raise RuntimeError(f"target_slot_unavailable: slot={slot_id}")

        body = json.dumps({"content": text}).encode("utf-8")
        endpoint = normalize_runtime_endpoint(status.endpoint)
        http_request = request.Request(
            f"{endpoint}/tokenize",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(http_request, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (error.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f"tokenize request failed: {exc}") from exc

        tokens = data.get("tokens")
        if not isinstance(tokens, list):
            raise RuntimeError("llama-server tokenize response did not include a tokens array.")
        return len(tokens)

    def warmup_slot_inference(
        self,
        slot_id: str,
        *,
        model_id: str,
        decision_id: str | None = None,
        timeout_ms: int = 45_000,
    ) -> RuntimeWarmupResult:
        """Streaming mini completion via backend→llama-server (same path as real chat).

        HTTP 200 without a real token is NOT inference_ready.
        """
        started = time.perf_counter()
        endpoint_ready_ms = 0
        prompt_eval_ms = 0
        first_token_ms = 0

        def elapsed_ms() -> int:
            return int((time.perf_counter() - started) * 1000)

        status = self.status_for_slot(slot_id)
        if status.state != "running" or not status.endpoint:
            return RuntimeWarmupResult(
                ok=False,
                outcome="endpoint_not_ready",
                detail=f"Slot '{slot_id}' is not running or has no endpoint.",
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage="process_started",
            )

        if (status.model_id or "") != model_id:
            mismatch = (
                f"Slot model '{status.model_id}' does not match requested '{model_id}'"
            )
            if decision_id:
                mismatch = f"{mismatch} (decision_id={decision_id})"
            return RuntimeWarmupResult(
                ok=False,
                outcome="binding_mismatch",
                detail=mismatch,
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage="model_loaded",
            )

        endpoint = normalize_runtime_endpoint(status.endpoint)
        if not self._endpoint_checker(endpoint):
            return RuntimeWarmupResult(
                ok=False,
                outcome="endpoint_not_ready",
                detail=f"Endpoint not reachable: {endpoint}",
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage="process_started",
            )
        endpoint_ready_ms = elapsed_ms()

        # Same completion shape as real chat; verify at least one generated token.
        messages = [
            {"role": "system", "content": "Antworte minimal."},
            {"role": "user", "content": "Antworte nur mit OK."},
        ]
        timeout_seconds = max(1.0, timeout_ms / 1000.0)

        def _post(payload: dict[str, Any]) -> tuple[bytes, str, int | None, dict[str, str]]:
            body = json.dumps(payload).encode("utf-8")
            http_request = request.Request(
                f"{endpoint}/v1/chat/completions",
                data=body,
                headers={
                    "content-type": "application/json",
                    "accept": "text/event-stream, application/json",
                },
                method="POST",
            )
            with request.urlopen(http_request, timeout=timeout_seconds) as response:
                content_type = ""
                headers: dict[str, str] = {}
                try:
                    content_type = str(response.headers.get("Content-Type") or "")
                except Exception:
                    content_type = ""
                try:
                    headers = {str(key): str(value) for key, value in response.headers.items()}
                except Exception:
                    headers = {}
                return response.read(), content_type, getattr(response, "status", None), headers

        content_parts: list[str] = []
        finish_reason: str | None = None
        prompt_eval_seen = False
        stream_mode = True
        first_token_ms = 0
        prompt_eval_ms = 0
        tool_call_detected = False
        raw_response_preview = ""
        http_status: int | None = None
        response_headers: dict[str, str] | None = None
        stream_events: list[str] = []
        parser_decision: str | None = None
        request_method = "POST"
        api_mode = "chat"
        max_tokens = 8
        request_body_preview: str | None = None
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        content_type = ""

        try:
            stream_payload = {
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0,
                "stream": True,
                "stream_options": {"include_usage": True},
            }
            request_body_preview = json.dumps(stream_payload, ensure_ascii=False)[:8192]
            raw_body, content_type, http_status, response_headers = _post(stream_payload)
            prompt_eval_seen = True
            prompt_eval_ms = elapsed_ms()

            text = raw_body.decode("utf-8", errors="replace")
            raw_response_preview = text[:8192]
            stripped = text.strip()
            parsed_json = None
            if stripped.startswith("{") and "data:" not in stripped[:32]:
                try:
                    parsed_json = json.loads(stripped)
                except json.JSONDecodeError:
                    parsed_json = None

            if isinstance(parsed_json, dict):
                stream_mode = False
                parser_decision = "non_stream_json"
                choices = parsed_json.get("choices")
                usage = parsed_json.get("usage")
                if isinstance(usage, dict):
                    prompt_tokens = usage.get("prompt_tokens")
                    completion_tokens = usage.get("completion_tokens")
                if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                    message = choices[0].get("message")
                    if isinstance(message, dict):
                        text_content = message.get("content")
                        if isinstance(text_content, str) and text_content:
                            content_parts.append(text_content)
                            stream_events.append("message.content")
                        else:
                            reasoning_content = message.get("reasoning_content")
                            if isinstance(reasoning_content, str) and reasoning_content:
                                content_parts.append(reasoning_content)
                                stream_events.append("message.reasoning_content")
                        if isinstance(message.get("tool_calls"), list) and message["tool_calls"]:
                            tool_call_detected = True
                            stream_events.append("message.tool_calls")
                    finish_reason = choices[0].get("finish_reason")
                    if isinstance(finish_reason, str) and finish_reason:
                        pass
                    else:
                        finish_reason = "stop"
                    if content_parts and first_token_ms == 0:
                        first_token_ms = elapsed_ms()
            else:
                parser_decision = "stream_sse"
                for line in text.splitlines():
                    if line.startswith("data:"):
                        stream_events.append("sse.data")
                    chunk = parse_llama_server_sse_line(line)
                    if chunk:
                        if first_token_ms == 0:
                            first_token_ms = elapsed_ms()
                        content_parts.append(chunk)
                        stream_events.append("delta.content_or_reasoning")
                    elif parse_llama_server_sse_has_tool_call(line):
                        tool_call_detected = True
                        if first_token_ms == 0:
                            first_token_ms = elapsed_ms()
                        stream_events.append("delta.tool_calls")
                    reason = parse_llama_server_sse_finish_reason(line)
                    if reason:
                        finish_reason = reason
                        stream_events.append(f"finish:{reason}")

            # Fallback: generation proof via non-stream if SSE produced nothing.
            if not "".join(content_parts).strip() and not tool_call_detected:
                non_stream_payload = {
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": 0,
                    "stream": False,
                }
                request_body_preview = json.dumps(non_stream_payload, ensure_ascii=False)[:8192]
                raw_body, content_type, http_status, response_headers = _post(non_stream_payload)
                stream_mode = False
                parser_decision = "stream_then_non_stream_fallback"
                # Keep whichever attempt's raw body is more informative — an
                # unexpected streaming shape is usually the actual symptom;
                # only fall back to the non-stream body if the stream attempt
                # returned nothing at all.
                if not raw_response_preview:
                    raw_response_preview = raw_body.decode("utf-8", errors="replace")[:8192]
                data = json.loads(raw_body.decode("utf-8"))
                usage = data.get("usage") if isinstance(data, dict) else None
                if isinstance(usage, dict):
                    prompt_tokens = usage.get("prompt_tokens")
                    completion_tokens = usage.get("completion_tokens")
                choices = data.get("choices") if isinstance(data, dict) else None
                if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                    message = choices[0].get("message")
                    if isinstance(message, dict):
                        text_content = message.get("content")
                        if isinstance(text_content, str) and text_content:
                            content_parts = [text_content]
                            first_token_ms = elapsed_ms()
                            stream_events.append("fallback.message.content")
                        else:
                            reasoning_content = message.get("reasoning_content")
                            if isinstance(reasoning_content, str) and reasoning_content:
                                content_parts = [reasoning_content]
                                first_token_ms = elapsed_ms()
                                stream_events.append("fallback.message.reasoning_content")
                        if isinstance(message.get("tool_calls"), list) and message["tool_calls"]:
                            tool_call_detected = True
                            stream_events.append("fallback.message.tool_calls")
                    finish_reason = choices[0].get("finish_reason")
                    if not isinstance(finish_reason, str) or not finish_reason:
                        finish_reason = "stop"

        except TimeoutError as exc:
            return RuntimeWarmupResult(
                ok=False,
                outcome="warmup_timeout",
                detail=str(exc),
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage=(
                    "prompt_eval_verified"
                    if prompt_eval_seen
                    else "endpoint_reachable"
                ),
                diagnostics=RuntimeWarmupDiagnostics(
                    endpoint=f"{endpoint}/v1/chat/completions",
                    api_mode=api_mode,
                    request_method=request_method,
                    request_body=request_body_preview,
                    http_status=http_status,
                    content_type=content_type,
                    response_headers=response_headers,
                    stream_events=stream_events or None,
                    parser_decision=parser_decision,
                    max_tokens=max_tokens,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    endpoint_ready_ms=endpoint_ready_ms,
                    prompt_eval_ms=prompt_eval_ms,
                    first_token_ms=first_token_ms,
                    total_warmup_ms=elapsed_ms(),
                    token_count=len(content_parts),
                    finish_reason=finish_reason,
                    readiness_stage=(
                        "prompt_eval_verified"
                        if prompt_eval_seen
                        else "endpoint_reachable"
                    ),
                    stream_mode=stream_mode,
                ),
            )
        except error.HTTPError as exc:
            details = ""
            try:
                details = exc.read().decode("utf-8", errors="replace")
            except Exception:
                details = str(exc)
            oom = bool(
                re.search(
                    r"out of memory|cuda.*oom|ggml_cuda|insufficient memory",
                    details,
                    re.I,
                )
            )
            return RuntimeWarmupResult(
                ok=False,
                outcome="runtime_oom" if oom else "warmup_http_failed",
                detail=(details or f"HTTP {exc.code}")[:400],
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage="endpoint_reachable",
            )
        except (error.URLError, OSError, json.JSONDecodeError) as exc:
            return RuntimeWarmupResult(
                ok=False,
                outcome="warmup_http_failed",
                detail=(
                    f"Warm-up konnte llama-server nicht erreichen. "
                    f"Endpoint: {endpoint} | {exc}"
                ),
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage="endpoint_reachable",
            )

        content = "".join(content_parts).strip()
        token_count = max(len(content_parts), 1 if content else 0)
        if not content and not tool_call_detected:
            return RuntimeWarmupResult(
                ok=False,
                outcome="warmup_empty_response",
                detail="Warm-up lieferte keinen Token (HTTP allein reicht nicht).",
                model_id=model_id,
                model_name=status.model_name,
                slot_id=slot_id,  # type: ignore[arg-type]
                elapsed_ms=elapsed_ms(),
                readiness_stage=(
                    "prompt_eval_verified" if prompt_eval_seen else "endpoint_reachable"
                ),
                diagnostics=RuntimeWarmupDiagnostics(
                    endpoint=f"{endpoint}/v1/chat/completions",
                    api_mode=api_mode,
                    request_method=request_method,
                    request_body=request_body_preview,
                    http_status=http_status,
                    content_type=content_type,
                    response_headers=response_headers,
                    stream_events=stream_events or None,
                    parser_decision=parser_decision,
                    max_tokens=max_tokens,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    endpoint_ready_ms=endpoint_ready_ms,
                    prompt_eval_ms=prompt_eval_ms,
                    first_token_ms=first_token_ms,
                    total_warmup_ms=elapsed_ms(),
                    token_count=0,
                    finish_reason=finish_reason,
                    readiness_stage=(
                        "prompt_eval_verified"
                        if prompt_eval_seen
                        else "endpoint_reachable"
                    ),
                    stream_mode=stream_mode,
                    tool_call_detected=tool_call_detected,
                    raw_response_preview=raw_response_preview or None,
                    stderr_tail=self._stream_tail_for_slot("stderr", slot_id) or None,
                ),
            )

        if finish_reason is None:
            finish_reason = "stop"

        # Stream path preferred; non-stream fallback still proves generation.
        readiness: str = (
            "inference_ready" if stream_mode else "token_generation_verified"
        )
        diagnostics = RuntimeWarmupDiagnostics(
            endpoint=f"{endpoint}/v1/chat/completions",
            api_mode=api_mode,
            request_method=request_method,
            request_body=request_body_preview,
            http_status=http_status,
            content_type=content_type,
            response_headers=response_headers,
            stream_events=stream_events or None,
            parser_decision=parser_decision,
            max_tokens=max_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            endpoint_ready_ms=endpoint_ready_ms,
            model_load_ms=endpoint_ready_ms,
            prompt_eval_ms=prompt_eval_ms,
            first_token_ms=first_token_ms,
            total_warmup_ms=elapsed_ms(),
            token_count=token_count,
            finish_reason=finish_reason,
            readiness_stage=readiness,  # type: ignore[arg-type]
            stream_mode=stream_mode,
            tool_call_detected=tool_call_detected,
        )
        return RuntimeWarmupResult(
            ok=True,
            outcome="inference_ready",
            detail=content[:64] if content else "[tool_call]",
            model_id=model_id,
            model_name=status.model_name,
            slot_id=slot_id,  # type: ignore[arg-type]
            elapsed_ms=elapsed_ms(),
            readiness_stage=readiness,  # type: ignore[arg-type]
            diagnostics=diagnostics,
        )

    def is_slot_chat_ready(self, slot_id: str) -> bool:
        """
        P0 Requirement: Calculate real slot readiness for chat.
        A slot is chat-ready when:
        1. It is in "running" state
        2. It has an endpoint configured
        3. The endpoint is reachable
        """
        status = self.status_for_slot(slot_id)
        
        if status.state != "running":
            return False
        
        if not status.endpoint:
            return False
        
        return self._endpoint_checker(status.endpoint)

    def start_model(
        self,
        model_id: str,
        *,
        slot_id: str | None = None,
        config: dict[str, object] | None = None,
    ) -> RuntimeStatus:
        model_index = self.model_index_service.build_index()
        model = next((candidate for candidate in model_index.models if candidate.id == model_id), None)

        caller_config = dict(config or {})
        caller_port = caller_config.get("port")

        port_for_slot = caller_port
        if slot_id:
            port_for_slot = _default_port_for_slot(slot_id)
        elif not port_for_slot and model:
            port_for_slot = resolve_preferred_port(model, self.models_dir, config_override=caller_config)

        target_slot_id = slot_id or self._determine_slot(model_id, port_for_slot)
        lock = self._slot_locks.get(target_slot_id) or threading.Lock()

        with lock:
            self._clear_shared_slot_binding(target_slot_id)
            self._clear_external_slot_pid(target_slot_id)
            if self._simulation_mode:
                # Determine simulation port
                sim_port = port_for_slot
                if sim_port is None:
                    sim_port = _default_port_for_slot(target_slot_id)
                status = RuntimeStatus(
                    state="running",
                    provider="llama.cpp",
                    model_id=model_id,
                    model_name=f"[SIM] {model_id}",
                    port=sim_port,
                    endpoint=f"http://127.0.0.1:{sim_port}",
                    message="Simulationsmodus aktiv — kein echtes Modell geladen.",
                    slot_id=target_slot_id,
                    hardware_mode="cpu" if target_slot_id == "quality_cpu" else "gpu" if target_slot_id == "fast_gpu" else "cpu",
                    gpu_layers=0 if target_slot_id in ("quality_cpu", "orchestrator_cpu") else None,
                )
                self._statuses[target_slot_id] = status
                self._last_active_slot_id = target_slot_id
                self._process = None
                self._status = status
                return status

            requested_profile = caller_config.get("profile")
            if not isinstance(requested_profile, str):
                requested_profile = None
            gpu = self._gpu_detector()
            hardware_fp = collect_hardware_fingerprint(gpu)
            hardware_hash = fingerprint_hash(hardware_fp)
            capabilities = self.tool_registry.detect_capabilities()
            runtime_version = self._get_runtime_version()

            current = self.status_for_slot(target_slot_id)
            if current.state == "running":
                can_reuse_current = current.model_id == model_id
                if can_reuse_current and model is not None and model.runtime_launcher != "ollama":
                    candidate_plan = self._plan_for_candidate(
                        model, target_slot_id, gpu=gpu, hardware_hash=hardware_hash, requested_profile=requested_profile,
                    )
                    if candidate_plan is not None:
                        candidate_fingerprint = compute_launch_fingerprint(
                            model,
                            candidate_plan,
                            runtime_version=runtime_version,
                            runtime_backend=hardware_fp.runtime_backend,
                        )
                        # Reuse only on identical launch fingerprint — a same-model
                        # request with a different profile/ctx/gpu-layers must restart.
                        can_reuse_current = self.residency.can_reuse(target_slot_id, candidate_fingerprint)
                if can_reuse_current:
                    self._last_active_slot_id = target_slot_id
                    self._process = self._slots.get(target_slot_id)
                    self._status = current
                    return current
                self.stop_model_for_slot(target_slot_id)

            shared_slot_id = self._find_running_slot_for_model(model_id, exclude_slot_id=target_slot_id)
            if shared_slot_id is not None:
                shared_status = self._bind_shared_slot(target_slot_id, shared_slot_id)
                if shared_status.state == "running":
                    self._last_active_slot_id = target_slot_id
                    self._process = self._slots.get(shared_slot_id)
                    self._status = shared_status
                    return shared_status

            # Binding / role settings: never silently substitute another GGUF.
            # Retry loops below may still OOM-reduce the *same* model.
            ordered_candidate_ids = [model_id]
            last_failure_message: str | None = None
            last_failure_stderr_tail: str | None = None
            last_failure_stdout_tail: str | None = None

            for index, candidate_id in enumerate(ordered_candidate_ids):
                candidate_model = next((candidate for candidate in model_index.models if candidate.id == candidate_id), None)
                if not candidate_model:
                    continue

                candidate_port = caller_port
                if not candidate_port and slot_id:
                    candidate_port = _default_port_for_slot(target_slot_id)
                elif not candidate_port:
                    candidate_port = resolve_preferred_port(candidate_model, self.models_dir, config_override=caller_config)
                if candidate_port is None:
                    candidate_port = _default_port_for_slot(target_slot_id)

                resource_plan = self._plan_for_candidate(
                    candidate_model, target_slot_id, gpu=gpu, hardware_hash=hardware_hash, requested_profile=requested_profile,
                )

                oom_attempt = 0
                while True:
                    candidate_config = dict(caller_config)
                    candidate_config.pop("profile", None)
                    if resource_plan is not None:
                        candidate_config.setdefault("context_size", resource_plan.context_size)
                        candidate_config.setdefault("n_gpu_layers", resource_plan.gpu_layers)
                        candidate_config.setdefault("gpu_layers", resource_plan.gpu_layers)
                        candidate_config.setdefault("batch_size", resource_plan.batch_size)
                        candidate_config.setdefault("micro_batch_size", resource_plan.micro_batch_size)
                        candidate_config.setdefault("parallel", resource_plan.parallel)
                        candidate_config.setdefault("n_threads", resource_plan.threads)
                        candidate_config.setdefault("cache_type_k", resource_plan.cache_type_k)
                        candidate_config.setdefault("cache_type_v", resource_plan.cache_type_v)
                        candidate_config.setdefault("cache_reuse", 256)
                    if target_slot_id == "quality_cpu":
                        # Chat/CPU slot never runs on GPU, regardless of planner or caller input.
                        candidate_config["n_gpu_layers"] = 0
                        candidate_config["gpu_layers"] = 0
                    if target_slot_id == "orchestrator_cpu":
                        # Router slot is CPU-only with fixed, deliberately small launch
                        # parameters — it's a 270M model, not sized like the other slots.
                        candidate_config["n_gpu_layers"] = 0
                        candidate_config["gpu_layers"] = 0
                        candidate_config["context_size"] = 4096
                        candidate_config["n_threads"] = 4
                        candidate_config["parallel"] = 2
                    candidate_config["port"] = candidate_port

                    plan = build_launch_plan(
                        candidate_model,
                        models_dir=self.models_dir,
                        ollama_dir=self.ollama_dir,
                        ollama_models_dir=self.ollama_models_dir,
                        config_override=candidate_config,
                        capabilities=capabilities,
                    )
                    if plan.blockers:
                        last_failure_message = plan.blockers[0]
                        last_failure_stderr_tail = None
                        last_failure_stdout_tail = None
                        break

                    try:
                        process = self.process_runner.start(plan.command, plan.runtime_dir, plan.env)
                        self._slots[target_slot_id] = process
                    except OSError as exc:
                        last_failure_message = f"Failed to start runtime: {exc}"
                        last_failure_stderr_tail = None
                        last_failure_stdout_tail = None
                        break

                    if candidate_model.runtime_launcher == "ollama":
                        self._save_last_good_command(candidate_id, plan.command, plan.port, candidate_model)
                        self._save_selected_model(candidate_id)
                        status = RuntimeStatus(
                            state="running",
                            provider=provider_for_model(candidate_model),
                            model_id=candidate_model.id,
                            model_name=candidate_model.name,
                            port=plan.port,
                            pid=process.pid if process else None,
                            endpoint=plan.endpoint,
                            message=f"Runtime started successfully on port {plan.port}.",
                            slot_id=target_slot_id,
                            hardware_mode=resource_plan.hardware_mode if resource_plan else None,
                            gpu_layers=resource_plan.gpu_layers if resource_plan else None,
                            vram_total_bytes=resource_plan.available_vram_bytes if resource_plan else None,
                            vram_used_bytes=resource_plan.estimated_total_vram_bytes if resource_plan else None,
                        )
                        self._statuses[target_slot_id] = status
                        self._last_active_slot_id = target_slot_id
                        self._process = process
                        self._status = status
                        return status

                    def make_stderr_tail(s_id: str):
                        return lambda: self._stream_tail_for_slot("stderr", s_id)

                    ready, failure_message = wait_for_runtime_endpoint(
                        plan.endpoint,
                        self._endpoint_checker,
                        process,
                        timeout_seconds=self._warmup_timeout_seconds,
                        interval_seconds=self._warmup_interval_seconds,
                        stderr_tail=make_stderr_tail(target_slot_id),
                    )
                    if ready:
                        owner_matches, owner_pid, owner_command = self._port_owner_matches_model(plan.port, candidate_model)
                        launched_pid = process.pid if process else None
                        if launched_pid is not None and not self._pid_exists(launched_pid):
                            owner_pid = None
                        if owner_pid is not None and launched_pid is not None and owner_pid != launched_pid:
                            self.process_runner.drain_process(process)
                            process.terminate()
                            if owner_matches and owner_pid:
                                self._slots[target_slot_id] = None
                                self._external_slot_pids[target_slot_id] = owner_pid
                                status = RuntimeStatus(
                                    state="running",
                                    provider=provider_for_model(candidate_model),
                                    model_id=candidate_model.id,
                                    model_name=candidate_model.name,
                                    port=plan.port,
                                    pid=owner_pid,
                                    endpoint=plan.endpoint,
                                    message=f"Runtime reused existing listener on port {plan.port}.",
                                    slot_id=target_slot_id,
                                    hardware_mode=resource_plan.hardware_mode if resource_plan else None,
                                    gpu_layers=resource_plan.gpu_layers if resource_plan else None,
                                    vram_total_bytes=resource_plan.available_vram_bytes if resource_plan else None,
                                    vram_used_bytes=resource_plan.estimated_total_vram_bytes if resource_plan else None,
                                )
                                self._statuses[target_slot_id] = status
                                self._last_active_slot_id = target_slot_id
                                self._process = None
                                self._status = status
                                return status
                            last_failure_message = (
                                f"Port {plan.port} is already serving another runtime process"
                                + (f": {owner_command}" if owner_command else ".")
                            )
                            stderr_tail_fn = getattr(self.process_runner, "stderr_tail", None)
                            stdout_tail_fn = getattr(self.process_runner, "stdout_tail", None)
                            last_failure_stderr_tail = stderr_tail_fn(process) if callable(stderr_tail_fn) else None
                            last_failure_stdout_tail = stdout_tail_fn(process) if callable(stdout_tail_fn) else None
                            self._terminate_process_for_slot(target_slot_id)
                            break
                        self._save_last_good_command(
                            candidate_id,
                            plan.command,
                            plan.port,
                            candidate_model,
                            resource_plan=resource_plan,
                            gpu=gpu,
                        )
                        self._save_selected_model(candidate_id)
                        if resource_plan is not None:
                            launch_fingerprint = compute_launch_fingerprint(
                                candidate_model,
                                resource_plan,
                                runtime_version=runtime_version,
                                runtime_backend=hardware_fp.runtime_backend,
                            )
                            self.residency.record_started(
                                target_slot_id,  # type: ignore[arg-type]
                                model_id=candidate_model.id,
                                process_id=process.pid if process else 0,
                                endpoint=plan.endpoint,
                                launch_fingerprint=launch_fingerprint,
                                plan=resource_plan,
                            )
                        status = RuntimeStatus(
                            state="running",
                            provider=provider_for_model(candidate_model),
                            model_id=candidate_model.id,
                            model_name=candidate_model.name,
                            port=plan.port,
                            pid=process.pid if process else None,
                            endpoint=plan.endpoint,
                            message=f"Runtime started successfully on port {plan.port}.",
                            slot_id=target_slot_id,
                            hardware_mode=resource_plan.hardware_mode if resource_plan else None,
                            gpu_layers=resource_plan.gpu_layers if resource_plan else None,
                            vram_total_bytes=resource_plan.available_vram_bytes if resource_plan else None,
                            vram_used_bytes=resource_plan.estimated_total_vram_bytes if resource_plan else None,
                        )
                        self._statuses[target_slot_id] = status
                        self._last_active_slot_id = target_slot_id
                        self._process = process
                        self._status = status
                        return status

                    stderr_tail = self._stream_tail_for_slot("stderr", target_slot_id)
                    stdout_tail = self._stream_tail_for_slot("stdout", target_slot_id)
                    self._terminate_process_for_slot(target_slot_id)
                    last_failure_message = failure_message
                    last_failure_stderr_tail = stderr_tail
                    last_failure_stdout_tail = stdout_tail

                    can_retry_oom = (
                        resource_plan is not None
                        and target_slot_id != "quality_cpu"
                        and resource_plan.gpu_layers > 0
                        and is_oom_stderr(stderr_tail)
                        and oom_attempt < _MAX_OOM_RETRIES
                    )
                    if can_retry_oom:
                        oom_attempt += 1
                        resource_plan = self.resource_planner.reduce_for_oom(resource_plan, oom_attempt)
                        if target_slot_id == "fast_gpu" and resource_plan.gpu_layers == 0:
                            last_failure_message = "GPU-OOM: CPU-Fallback für fast_gpu ist deaktiviert."
                            last_failure_stderr_tail = stderr_tail
                            last_failure_stdout_tail = stdout_tail
                            break
                        continue

                    break

                if index == len(ordered_candidate_ids) - 1:
                    status = RuntimeStatus(
                        state="error",
                        message=last_failure_message,
                        stderr_tail=last_failure_stderr_tail or "",
                        stdout_tail=last_failure_stdout_tail or "",
                        slot_id=target_slot_id,
                    )
                    self._statuses[target_slot_id] = status
                    self._last_active_slot_id = target_slot_id
                    self._status = status
                    return status

            if last_failure_message is not None:
                status = RuntimeStatus(
                    state="error",
                    message=last_failure_message,
                    stderr_tail=last_failure_stderr_tail,
                    stdout_tail=last_failure_stdout_tail,
                    slot_id=target_slot_id,
                )
                self._statuses[target_slot_id] = status
                self._last_active_slot_id = target_slot_id
                self._status = status
                return status
            return RuntimeStatus(state="error", message="No candidates available", slot_id=target_slot_id)

        status = RuntimeStatus(
            state="error",
            message=f"No compatible local model could be started for {model_id}.",
            slot_id=target_slot_id,
        )
        self._statuses[target_slot_id] = status
        self._last_active_slot_id = target_slot_id
        self._status = status
        return status

    def start_model_with_config(self, model_id: str, config: dict, *, slot_id: str | None = None) -> RuntimeStatus:
        return self.start_model(
            model_id,
            slot_id=slot_id,
            config=dict(config or {}),
        )

    def stop_model(self) -> RuntimeStatus:
        if self._simulation_mode:
            self._status = RuntimeStatus(state="stopped", message="Simulationsmodus gestoppt.")
            for slot_id in self._statuses:
                self._statuses[slot_id] = RuntimeStatus(state="stopped", slot_id=slot_id)
            return self._status
        for slot_id in list(self._slots.keys()):
            self._terminate_process_for_slot(slot_id)
            self.residency.record_stopped(slot_id)
        self._status = RuntimeStatus(state="stopped", message="All runtimes stopped.")
        return self._status

    def stop_model_for_slot(self, slot_id: str) -> RuntimeStatus:
        bound_slot_id = self._shared_slot_bindings.get(slot_id)
        if bound_slot_id:
            self._clear_shared_slot_binding(slot_id)
            self.residency.record_stopped(slot_id)
            self._statuses[slot_id] = RuntimeStatus(
                state="stopped",
                slot_id=slot_id,
                message=f"Shared runtime binding to '{bound_slot_id}' removed.",
            )
            return self._statuses[slot_id]
        if self._simulation_mode:
            self._statuses[slot_id] = RuntimeStatus(state="stopped", slot_id=slot_id, message="Simulationsmodus gestoppt.")
            return self._statuses[slot_id]
        self._terminate_process_for_slot(slot_id)
        self.residency.record_stopped(slot_id)
        self._statuses[slot_id] = RuntimeStatus(state="stopped", slot_id=slot_id, message="Runtime stopped.")
        return self._statuses[slot_id]

    def _build_antigravity_prompt(self, chat_request: RuntimeChatRequest) -> tuple[str, str | None]:
        system_messages = [m.content for m in chat_request.messages if m.role == "system"]
        conversation_parts: list[str] = []
        if system_messages:
            conversation_parts.append("System:\n" + "\n".join(system_messages))
        for message in chat_request.messages:
            if message.role == "system":
                continue
            label = "User" if message.role == "user" else "Assistant"
            conversation_parts.append(f"{label}: {message.content}")
        prompt = "\n\n".join(conversation_parts).strip()
        system_instructions = None
        if system_messages:
            system_instructions = "\n".join(system_messages)
        return prompt, system_instructions

    def _try_antigravity_chat(self, chat_request: RuntimeChatRequest) -> RuntimeChatResponse | None:
        if not self.antigravity_service.is_available():
            return None
        if getattr(chat_request, "provider", None) not in {"antigravity", "google-antigravity"}:
            return None
        prompt, system_instructions = self._build_antigravity_prompt(chat_request)
        result = self.antigravity_service.run_prompt_sync(
            prompt,
            system_instructions=system_instructions,
            tools=getattr(chat_request, "tools", None),
        )
        if result.error:
            raise RuntimeError(result.error)
        return RuntimeChatResponse(
            message=RuntimeChatMessage(role="assistant", content=result.text),
            model_id="antigravity",
            model_name=result.model or "antigravity",
        )

    def chat(self, chat_request: RuntimeChatRequest) -> RuntimeChatResponse:
        antigravity_response = self._try_antigravity_chat(chat_request)
        if antigravity_response is not None:
            return antigravity_response

        if (chat_request.provider or "").strip().lower() in {"openai", "anthropic"}:
            from app.settings.service import get_settings_service

            provider = (chat_request.provider or "").strip().lower()
            settings = get_settings_service().load()
            messages = [message.model_dump() for message in self._build_chat_messages(chat_request)]
            content = self.cloud_runtime_client.chat(
                messages,
                model=chat_request.model_id,
                settings=settings,
                provider=provider,
            )
            return RuntimeChatResponse(
                message=RuntimeChatMessage(role="assistant", content=content),
                model_id=chat_request.model_id,
                model_name=chat_request.model_id or provider,
            )

        if self._simulation_mode:
            last_user = next(
                (m.content for m in reversed(chat_request.messages) if m.role == "user"),
                "",
            )
            return RuntimeChatResponse(
                message=RuntimeChatMessage(
                    role="assistant",
                    content=(
                        f"[Simulationsmodus] Deine Nachricht: \"{last_user}\"\n\n"
                        "Kein echtes Modell geladen. Setze `DBZS_RUNTIME_SIMULATION=0` "
                        "und lade ein GGUF-Modell, um echte Antworten zu erhalten."
                    ),
                ),
                model_id="simulation",
                model_name="[SIM]",
            )
        if antigravity_response is not None:
            return antigravity_response

        target = self.resolve_chat_target(chat_request)
        slot_id = target.slot_id
        current = self.status_for_slot(slot_id)

        self.residency.begin_request(slot_id)
        try:
            messages = self._build_chat_messages(chat_request)
            native_tools = chat_request.native_tools_payload()
            payload = {
                "messages": [message.model_dump() for message in messages],
                **_build_sampling_payload(chat_request),
            }
            if native_tools:
                payload["tools"] = native_tools
            if current.provider == "ollama":
                payload.update({
                    "model": current.model_name,
                    "stream": False,
                    "options": {"num_predict": chat_request.max_tokens},
                })
                content = self.ollama_chat_client.complete(current.endpoint, payload)
            else:
                payload.update({"max_tokens": chat_request.max_tokens})
                try:
                    content = self.chat_client.complete(current.endpoint, payload)
                except RuntimeError as exc:
                    if native_tools and "HTTP Error 400" in str(exc):
                        fallback_payload = {key: value for key, value in payload.items() if key != "tools"}
                        content = self.chat_client.complete(current.endpoint, fallback_payload)
                    else:
                        raise
                if native_tools and not content.strip():
                    fallback_payload = {key: value for key, value in payload.items() if key != "tools"}
                    content = self.chat_client.complete(current.endpoint, fallback_payload)
            return RuntimeChatResponse(
                message=RuntimeChatMessage(role="assistant", content=content),
                model_id=current.model_id,
                model_name=current.model_name,
            )
        finally:
            self.residency.end_request(slot_id)

    def chat_stream(self, chat_request: RuntimeChatRequest) -> Iterator[str]:
        antigravity_response = self._try_antigravity_chat(chat_request)
        if antigravity_response is not None:
            for token in antigravity_response.message.content.split():
                yield token + " "
            return

        if self._simulation_mode:
            last_user = next(
                (m.content for m in reversed(chat_request.messages) if m.role == "user"),
                "",
            )
            simulated = (
                f"[Simulationsmodus] Deine Nachricht: \"{last_user}\"\n\n"
                "Kein echtes Modell geladen. Setze `DBZS_RUNTIME_SIMULATION=0` "
                "und lade ein GGUF-Modell, um echte Antworten zu erhalten."
            )
            for token in simulated.split():
                yield token + " "
            return

        target = self.resolve_chat_target(chat_request)
        slot_id = target.slot_id
        current = self.status_for_slot(slot_id)

        self._last_chat_usage = None
        self._last_chat_finish_reason = None
        self.residency.begin_request(slot_id)
        try:
            messages = self._build_chat_messages(chat_request)
            native_tools = chat_request.native_tools_payload()
            payload = {
                "messages": [message.model_dump() for message in messages],
                **_build_sampling_payload(chat_request),
            }
            if native_tools:
                payload["tools"] = native_tools
            if current.provider == "ollama":
                payload.update({
                    "model": current.model_name,
                    "options": {"num_predict": chat_request.max_tokens},
                })
                yield from self.ollama_chat_client.stream(current.endpoint, payload)
            else:
                payload.update({"max_tokens": chat_request.max_tokens})

                def capture_usage(usage: dict[str, int]) -> None:
                    self._last_chat_usage = usage

                try:
                    emitted = False
                    for chunk in self.chat_client.stream(
                        current.endpoint,
                        payload,
                        on_usage=capture_usage,
                    ):
                        if chunk:
                            emitted = True
                        yield chunk
                    self._last_chat_finish_reason = getattr(
                        self.chat_client,
                        "last_finish_reason",
                        None,
                    )
                    # if chat_request.tools and not emitted and False:  # DEAKTIVIERT: Verursacht doppelte Tokens
                    #     fallback_payload = {key: value for key, value in payload.items() if key != "tools"}
                    #     yield from self.chat_client.stream(current.endpoint, fallback_payload)
                except RuntimeError as exc:
                    if native_tools and "HTTP Error 400" in str(exc):
                        fallback_payload = {key: value for key, value in payload.items() if key != "tools"}
                        yield from self.chat_client.stream(current.endpoint, fallback_payload, on_usage=capture_usage)
                    else:
                        raise
        finally:
            self.residency.end_request(slot_id)

    def _terminate_process(self) -> None:
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        self._terminate_process_for_slot(active_slot)

    def _terminate_process_for_slot(self, slot_id: str) -> None:
        process = self._slots.get(slot_id)
        if process and process.poll() is None:
            process.terminate()
        self._slots[slot_id] = None
        self._statuses[slot_id] = RuntimeStatus(state="stopped", slot_id=slot_id)

    def get_logs(self) -> RuntimeLogsResponse:
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        current = self.status_for_slot(active_slot)
        return RuntimeLogsResponse(
            state=current.state,
            model_id=current.model_id,
            stderr_tail=self._stream_tail_for_slot("stderr", active_slot),
            stdout_tail=self._stream_tail_for_slot("stdout", active_slot),
        )

    def get_logs_for_slot(self, slot_id: str) -> RuntimeLogsResponse:
        current = self.status_for_slot(slot_id)
        return RuntimeLogsResponse(
            state=current.state,
            model_id=current.model_id,
            stderr_tail=self._stream_tail_for_slot("stderr", slot_id),
            stdout_tail=self._stream_tail_for_slot("stdout", slot_id),
        )

    def _stderr_tail(self) -> str:
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        return self._stream_tail_for_slot("stderr", active_slot)

    def _stdout_tail(self) -> str:
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        return self._stream_tail_for_slot("stdout", active_slot)

    def _stream_tail_for_slot(self, stream: str, slot_id: str) -> str:
        process = self._slots.get(slot_id)
        if process is None:
            return ""
        runner = self.process_runner
        if hasattr(runner, "drain_process"):
            runner.drain_process(process)
        method_name = f"{stream}_tail"
        if hasattr(runner, method_name):
            return getattr(runner, method_name)(process)
        return ""

    def _determine_slot(self, model_id: str, port: int | None) -> str:
        configured_slot = slot_id_for_port(port)
        if configured_slot:
            return configured_slot
            
        model_index = self.model_index_service.build_index()
        model = next((m for m in model_index.models if m.id == model_id), None)
        
        search_str = model_id.lower()
        if model:
            search_str = f"{model.id} {model.name} {model.path}".lower()
            
        if "functiongemma" in search_str or "orchestrator" in search_str:
            return "orchestrator_cpu"
        if "chat" in search_str or "instruct" in search_str or "quality" in search_str:
            return "quality_cpu"
        if "code" in search_str or "coder" in search_str or "debug" in search_str or "review" in search_str:
            return "fast_gpu"
        if "embed" in search_str or "rerank" in search_str or "utility" in search_str:
            return "utility"
        return "quality_cpu"

    def resolve_chat_target(self, chat_request: RuntimeChatRequest) -> RuntimeStreamContext:
        slot_id = chat_request.slot_id or self._route_request_slot(chat_request)
        current = self.status_for_slot(slot_id)
        effective_policy: RuntimeFallbackPolicy = chat_request.fallback_policy or self.fallback_policy

        # A broker decision_id means the frontend already bound model+slot.
        # Never swap to another running slot under the hood.
        if chat_request.decision_id:
            effective_policy = "strict"
        
        # Validate model-slot consistency: if model_id is specified, it must match
        if chat_request.model_id and current.model_id != chat_request.model_id:
            raise RuntimeError(
                f"selected_model_not_running_in_slot: "
                f"requested model '{chat_request.model_id}' but slot '{slot_id}' "
                f"has '{current.model_id}'"
            )
        
        if current.state == "running" and current.endpoint:
            return RuntimeStreamContext(
                slot_id=slot_id,
                model_id=current.model_id,
                model_name=current.model_name,
                endpoint=current.endpoint,
            )

        if effective_policy in ("allow_local_fallback", "allow_any_fallback"):
            fallback_slot = self._select_local_fallback(slot_id)
            if fallback_slot is not None:
                fallback_status = self.status_for_slot(fallback_slot)
                if fallback_status.state == "running" and fallback_status.endpoint:
                    return RuntimeStreamContext(
                        slot_id=fallback_slot,
                        model_id=fallback_status.model_id,
                        model_name=fallback_status.model_name,
                        endpoint=fallback_status.endpoint,
                        fallback_reason=f"fallback to {fallback_slot} because {slot_id} was unavailable",
                    )

        raise RuntimeError(f"target_slot_unavailable: slot '{slot_id}' is not running")

    def _select_local_fallback(self, requested_slot: str) -> str | None:
        ordered_slots: list[str] = []
        if requested_slot == "quality_cpu":
            ordered_slots = ["fast_gpu", "utility"]
        elif requested_slot == "fast_gpu":
            ordered_slots = ["quality_cpu", "utility"]
        else:
            ordered_slots = ["fast_gpu", "quality_cpu"]

        for slot_id in ordered_slots:
            status = self.status_for_slot(slot_id)
            if status.state == "running" and status.endpoint:
                return slot_id
        return None

    def _route_request_slot(self, chat_request: RuntimeChatRequest) -> str:
        if chat_request.slot_id:
            return chat_request.slot_id
        
        # If model_id is set but slot_id is not, something is wrong with Broker.
        # Don't fix it silently — let validation layer catch it.
        if chat_request.model_id:
            # Only acceptable if model is actually running somewhere
            for s_id, status in self._statuses.items():
                if status.model_id == chat_request.model_id and status.state == "running":
                    return s_id
            # Model ID set but not running → error, not fallback
            raise RuntimeError(
                f"Model {chat_request.model_id} is not running in any slot. "
                "Frontend should have selected a slot before sending request."
            )
        
        if chat_request.file_context:
            return "fast_gpu"

        last_user_message = ""
        for message in reversed(chat_request.messages):
            if message.role == "user":
                last_user_message = message.content.lower()
                break

        coding_markers = [
            "implement",
            "code",
            "debug",
            "fix",
            "patch",
            "parallel",
            "review",
            "plan",
            "architektur",
            "architecture",
            "klasse",
            "funktion",
            "datei",
        ]
        if any(marker in last_user_message for marker in coding_markers):
            return "fast_gpu"

        return "quality_cpu"

    def _stream_tail(self, stream: str) -> str:
        # Keep this for backward compatibility signature if needed
        active_slot = getattr(self, "_last_active_slot_id", "quality_cpu")
        return self._stream_tail_for_slot(stream, active_slot)


    def _endpoint_available(self, url: str) -> bool:
        base = url.rstrip("/")
        candidates = [f"{base}/", f"{base}/health", f"{base}/v1/models"]
        for candidate in candidates:
            try:
                with request.urlopen(candidate, timeout=2) as response:
                    if 200 <= response.status < 300:
                        return True
            except (OSError, TimeoutError, error.URLError):
                continue
        return False

    def _build_chat_messages(self, chat_request: RuntimeChatRequest) -> list[RuntimeChatMessage]:
        messages = [
            RuntimeChatMessage(
                role="system",
                content=RUNTIME_CHAT_SYSTEM_PROMPT,
            )
        ]

        if chat_request.file_context:
            context = chat_request.file_context
            messages.append(
                RuntimeChatMessage(
                    role="system",
                    content=(
                        f"Aktive Datei: {context.path}\n"
                        f"Sprache: {context.language}\n\n"
                        "Dateiinhalt:\n"
                        f"```{context.language}\n{context.content}\n```"
                    ),
                )
            )

        messages.extend(chat_request.messages)
        return self._merge_consecutive_same_role_messages(messages)

    @staticmethod
    def _merge_consecutive_same_role_messages(
        messages: list[RuntimeChatMessage],
    ) -> list[RuntimeChatMessage]:
        """Collapse runs of consecutive same-role messages into one.

        The desktop client assembles the outgoing conversation from several
        independently-authored system-role fragments (goal capsule, active
        task contract, runtime tool instructions, project memory, ...), and
        this service itself prepends its own system prompt and an optional
        file-context system message on top of that. Several local chat
        templates (e.g. Gemma's, applied server-side by llama-server) reject
        a message list whose roles do not strictly alternate -- including
        runs of consecutive "system" messages -- and fail the whole request
        with a Jinja "Conversation roles must alternate" error. Merging
        consecutive same-role messages (joined with a blank line) preserves
        all content and ordering while producing a template-safe sequence,
        without needing to know which template a given local model uses.
        """
        merged: list[RuntimeChatMessage] = []
        for message in messages:
            if merged and merged[-1].role == message.role:
                merged[-1] = RuntimeChatMessage(
                    role=merged[-1].role,
                    content=f"{merged[-1].content}\n\n{message.content}",
                )
            else:
                merged.append(message)
        return merged

    def get_resource_plan_for_slot(self, slot_id: str) -> RuntimeResourcePlan | None:
        """The actual resource plan a running slot was launched with, if known.

        Used by the API layer to surface real gpu_layers/context_size/VRAM
        values instead of the previous hardcoded placeholders.
        """
        status = self.status_for_slot(slot_id)
        if status.state != "running" or not status.model_id:
            return None
        gpu = self._gpu_detector()
        hardware_hash = fingerprint_hash(collect_hardware_fingerprint(gpu))
        plan_data = self._load_last_good_resource_plan(status.model_id, hardware_hash)
        if plan_data is None:
            return None
        try:
            return RuntimeResourcePlan.model_validate(plan_data)
        except Exception:
            return None

    def _get_runtime_version(self) -> str:
        tool = self.tool_registry.get_registry().get_tool("llama-server")
        if tool is not None and tool.version:
            return tool.version
        return "unknown"

    def _plan_for_candidate(
        self,
        candidate_model: IndexedModel,
        target_slot_id: str,
        *,
        gpu: GpuInfo | None,
        hardware_hash: str,
        requested_profile: str | None,
    ) -> RuntimeResourcePlan | None:
        if candidate_model.runtime_launcher == "ollama":
            return None
        plan_profile = requested_profile or (
            "large_context" if target_slot_id == "quality_cpu"
            else "cpu_safe" if target_slot_id == "orchestrator_cpu"
            else "balanced"
        )
        # Reuse a previously OOM-reduced gpu_layers value on matching hardware,
        # so a fixed profile does not re-trigger the same OOM retry loop on
        # every subsequent launch. Skip a persisted full-CPU plan when the
        # caller asks for hybrid/GPU profiles — otherwise hybrid never recovers
        # after a prior cpu_safe save.
        custom_overrides: dict[str, object] | None = None
        persisted_plan = self._load_last_good_resource_plan(candidate_model.id, hardware_hash)
        if persisted_plan is not None and isinstance(persisted_plan.get("gpu_layers"), int):
            persisted_layers = int(persisted_plan["gpu_layers"])
            skip_cpu_persist = persisted_layers == 0 and plan_profile in (
                "hybrid",
                "fast",
                "balanced",
                "large_context",
            )
            if not skip_cpu_persist:
                custom_overrides = {"gpu_layers": persisted_layers}
        return self.resource_planner.plan(
            candidate_model,
            slot_id=target_slot_id,  # type: ignore[arg-type]
            gpu=gpu,
            requested_profile=plan_profile,  # type: ignore[arg-type]
            custom_overrides=custom_overrides,
        )

    def sweep_idle_slots(self, idle_timeout_seconds: float | None = None) -> list[str]:
        """Stop slots whose residency policy is idle_evict and have been idle
        past the timeout. Callers (a scheduler, or the "Cache leeren"-adjacent
        UI action) invoke this periodically — RuntimeService does not run its
        own background thread for this.
        """
        timeout = (
            idle_timeout_seconds
            if idle_timeout_seconds is not None
            else float(os.getenv("DBZS_RESIDENCY_IDLE_TIMEOUT_SECONDS", "900"))
        )
        evicted: list[str] = []
        for slot_id in list(self._statuses.keys()):
            if self.residency.is_idle_expired(slot_id, timeout):
                self.residency.mark_evicting(slot_id)
                self.stop_model_for_slot(slot_id)
                evicted.append(slot_id)
        return evicted

    def get_hardware_fingerprint(self):
        return collect_hardware_fingerprint(self._gpu_detector())

    def get_llama_capabilities(self):
        return self.tool_registry.detect_capabilities()

    def preview_resource_plan(
        self,
        model_id: str,
        slot_id: str,
        profile: str | None = None,
    ) -> RuntimeResourcePlan:
        """Compute a resource plan without launching anything (UI "Neu vermessen")."""
        model_index = self.model_index_service.build_index()
        model = next((candidate for candidate in model_index.models if candidate.id == model_id), None)
        if model is None:
            raise ValueError(f"Model '{model_id}' not found in index.")
        gpu = self._gpu_detector()
        plan_profile = profile or (
            "large_context" if slot_id == "quality_cpu"
            else "cpu_safe" if slot_id == "orchestrator_cpu"
            else "balanced"
        )
        return self.resource_planner.plan(
            model,
            slot_id=slot_id,  # type: ignore[arg-type]
            gpu=gpu,
            requested_profile=plan_profile,  # type: ignore[arg-type]
        )

    def _load_last_good_resource_plan(self, model_id: str, hardware_hash: str) -> dict | None:
        runtime_path = self.models_dir / "models.runtime.json"
        if not runtime_path.exists():
            return None
        try:
            runtime_data = read_json_file(runtime_path)
        except Exception:
            return None
        models = runtime_data.get("models", {})
        if not isinstance(models, dict):
            return None
        entry = models.get(model_id, {})
        if not isinstance(entry, dict):
            return None
        saved = entry.get("last_good_resource_plan")
        if not isinstance(saved, dict) or saved.get("hardware_fingerprint_hash") != hardware_hash:
            return None
        plan_data = saved.get("plan")
        return plan_data if isinstance(plan_data, dict) else None

    def _save_last_good_command(
        self,
        model_id: str,
        command: list[str],
        port: int,
        model: IndexedModel,
        *,
        resource_plan: RuntimeResourcePlan | None = None,
        gpu: GpuInfo | None = None,
    ) -> None:
        runtime_path = self.models_dir / "models.runtime.json"
        if runtime_path.exists():
            runtime_data = read_json_file(runtime_path)
        else:
            runtime_data = {"schema_version": "1.0", "models": {}}

        if "models" not in runtime_data or not isinstance(runtime_data["models"], dict):
            runtime_data["models"] = {}

        existing = runtime_data["models"].get(model_id, {})
        if not isinstance(existing, dict):
            existing = {}

        existing_runtime = existing.get("runtime", {})
        if not isinstance(existing_runtime, dict):
            existing_runtime = {}
        existing_server = existing.get("server", {})
        if not isinstance(existing_server, dict):
            existing_server = {}

        model_path = None
        n_ctx = model.runtime.ctx or 4096
        n_gpu_layers = model.runtime.gpu_layers if model.runtime.gpu_layers is not None else 0
        threads = 4

        for index, arg in enumerate(command):
            if arg == "-m" and index + 1 < len(command):
                model_path = command[index + 1]
            elif arg == "--ctx-size" and index + 1 < len(command):
                n_ctx = int(command[index + 1])
            elif arg == "--gpu-layers" and index + 1 < len(command):
                n_gpu_layers = int(command[index + 1])
            elif arg == "--threads" and index + 1 < len(command):
                threads = int(command[index + 1])

        updated_entry = {
            **existing,
            "load_ok": True,
            "error": "",
            "last_tested": utc_now_iso(),
            "last_good_preset": existing.get("last_good_preset", "safe"),
            "last_good_command": {
                "model_path": model_path or "",
                "host": "127.0.0.1",
                "port": port,
                "n_ctx": n_ctx,
                "n_gpu_layers": n_gpu_layers,
                "threads": threads,
            },
            "runtime": {
                **existing_runtime,
                "ctx": n_ctx,
                "gpu_layers": n_gpu_layers,
            },
            "server": {
                **existing_server,
                "enabled": existing_server.get("enabled", True),
                "preferred_port": port,
            },
        }

        if resource_plan is not None:
            hardware_fp = collect_hardware_fingerprint(gpu)
            updated_entry["last_good_resource_plan"] = {
                "hardware_fingerprint_hash": fingerprint_hash(hardware_fp),
                "plan": resource_plan.model_dump(),
            }

        runtime_data["models"][model_id] = updated_entry

        write_json_file(runtime_path, runtime_data)

    def _save_selected_model(self, model_id: str) -> None:
        state_path = self.models_dir / "models.state.json"
        if state_path.exists():
            state_data = read_json_file(state_path)
        else:
            state_data = {"schema_version": "1.0", "models": {}}

        state_data["selected_model_id"] = model_id
        write_json_file(state_path, state_data)

    def _fallback_model_candidates(self, requested_model_id: str, models: list[IndexedModel]) -> list[str]:
        requested = next((model for model in models if model.id == requested_model_id), None)
        if requested is None:
            return []

        candidates: list[tuple[int, str]] = []
        requested_name = requested.name.lower()
        requested_capabilities = set(requested.capabilities)
        requested_runtime = requested.runtime_launcher
        requested_path = requested.path.lower()

        for model in models:
            if model.id == requested_model_id:
                continue
            if model.runtime_launcher != requested_runtime:
                continue
            if model.format != "gguf":
                continue
            if not model.path:
                continue

            name_lower = model.name.lower()
            path_lower = model.path.lower()
            prefers_qwen = "qwen" in path_lower or "qwen" in name_lower or "qwen" in requested_path
            prefers_gemma = "gemma" in path_lower or "gemma" in name_lower or "gemma" in requested_path
            is_local_model = any(token in path_lower for token in ["d:/models", "\\models\\", "models\\chat", "models\\qwen", "models\\gemma"])
            capability_overlap = requested_capabilities & set(model.capabilities)
            score = 0

            if requested_name and "gemma4" in requested_name and prefers_qwen:
                score += 100
            if requested_name and "gemma4" in requested_name and prefers_gemma and "4" not in name_lower:
                score += 90
            if requested_name and "gemma" in requested_name and prefers_qwen:
                score += 80
            if is_local_model and (prefers_qwen or prefers_gemma):
                score += 70
            if capability_overlap:
                score += 50
            if "chat" in requested_capabilities and "chat" in model.capabilities:
                score += 20
            if "code" in requested_capabilities and "code" in model.capabilities:
                score += 10
            if score > 0:
                candidates.append((score, model.id))

        ordered = []
        seen: set[str] = set()
        for _, candidate_id in sorted(candidates, key=lambda item: item[0], reverse=True):
            if candidate_id in seen:
                continue
            seen.add(candidate_id)
            ordered.append(candidate_id)
        return ordered
