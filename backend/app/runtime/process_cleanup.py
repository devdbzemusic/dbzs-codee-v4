from __future__ import annotations

import os
from collections.abc import Iterable

from app.runtime.slot_contract import load_slot_contract

try:
    import psutil  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psutil = None

RUNTIME_PROCESS_NAMES = {
    "llama-server",
    "llama-server.exe",
    "llama-cli",
    "llama-cli.exe",
    "dbzs-backend",
    "dbzs-backend.exe",
    "uvicorn",
    "uvicorn.exe",
    "python",
    "python.exe",
    "pythonw",
    "pythonw.exe",
}

SLOT_MARKERS = ("quality_cpu", "fast_gpu", "utility", "orchestrator_cpu", "vision_gpu")
BACKEND_MARKERS = ("app.main:app", "dbzs-backend", "backend\\app\\main.py", "backend/app/main.py")


def cleanup_target_ports(extra_ports: Iterable[int] | None = None) -> list[int]:
    ports = [int(entry["port"]) for entry in load_slot_contract()["slots"]]
    if extra_ports:
        for port in extra_ports:
            if int(port) not in ports:
                ports.append(int(port))
    return ports


def _commandline_contains_marker(command_line: str, ports: Iterable[int]) -> bool:
    if not command_line:
        return False

    lowered = command_line.lower()
    if any(marker in lowered for marker in BACKEND_MARKERS):
        return True
    if any(marker in lowered for marker in SLOT_MARKERS):
        return True
    if "--port" in lowered:
        return any(
            marker in lowered
            for marker in (
                [f"--port {port}" for port in ports]
                + [f":{port}" for port in ports]
                + [f" {port} " for port in ports]
            )
        )
    return False


def _is_known_runtime_process(name: str, command_line: str, ports: Iterable[int]) -> bool:
    normalized_name = (name or "").strip().lower()
    normalized_command = (command_line or "").strip().lower()
    if normalized_name not in RUNTIME_PROCESS_NAMES:
        return False
    if normalized_name.startswith("llama-server") or normalized_name.startswith("llama-cli"):
        return _commandline_contains_marker(normalized_command, ports) or "llama" in normalized_command
    return _commandline_contains_marker(normalized_command, ports)


def collect_cleanup_candidate_pids(
    *,
    current_pid: int | None = None,
    processes: Iterable[object] | None = None,
    port_pid_map: dict[int, int] | None = None,
    target_ports: Iterable[int] | None = None,
) -> list[int]:
    if psutil is None and processes is None:
        return []

    normalized_ports = list(target_ports or cleanup_target_ports())
    candidates: set[int] = set()

    effective_port_pid_map = port_pid_map or {}
    if not effective_port_pid_map and psutil is not None:
        try:
            for conn in psutil.net_connections(kind="tcp"):
                if conn.status == psutil.CONN_LISTEN and conn.laddr and conn.pid:
                    effective_port_pid_map[int(conn.laddr.port)] = int(conn.pid)
        except Exception:
            effective_port_pid_map = {}

    for port in normalized_ports:
        pid = effective_port_pid_map.get(int(port))
        if pid and pid > 0:
            candidates.add(int(pid))

    effective_processes = list(processes or [])
    if not effective_processes and psutil is not None:
        try:
            effective_processes = list(psutil.process_iter(attrs=["pid", "name", "cmdline"]))
        except Exception:
            effective_processes = []

    for process in effective_processes:
        try:
            info = process.info if hasattr(process, "info") else process
            getter = info.get if hasattr(info, "get") else lambda key, default=None: getattr(info, key, default)
            pid = int(getter("pid", getattr(process, "pid", 0)))
            if pid <= 0:
                continue
            name = getter("name", getattr(process, "name", lambda: "")())
            cmdline = getter("cmdline", None)
            command_line = " ".join(cmdline) if isinstance(cmdline, list) else (cmdline or "")
            if _is_known_runtime_process(str(name or ""), str(command_line or ""), normalized_ports):
                candidates.add(pid)
        except Exception:
            continue

    if current_pid is None:
        current_pid = os.getpid()
    candidates.discard(current_pid)
    candidates.discard(0)
    return sorted(candidates)


def terminate_cleanup_candidates(
    logger,
    *,
    current_pid: int | None = None,
    target_ports: Iterable[int] | None = None,
) -> list[int]:
    if psutil is None:
        return []

    candidate_pids = collect_cleanup_candidate_pids(
        current_pid=current_pid,
        target_ports=target_ports,
    )
    if not candidate_pids:
        return []

    processes = []
    for pid in candidate_pids:
        try:
            proc = psutil.Process(pid)
            logger.info("Runtime cleanup terminating PID %s (%s)", pid, proc.name())
            proc.terminate()
            processes.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    gone, alive = psutil.wait_procs(processes, timeout=1.5)
    killed_pids = [proc.pid for proc in gone]
    for proc in alive:
        try:
            logger.warning("Runtime cleanup force-killing PID %s (%s)", proc.pid, proc.name())
            proc.kill()
            killed_pids.append(proc.pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return sorted(set(killed_pids))
