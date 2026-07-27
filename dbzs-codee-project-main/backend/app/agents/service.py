from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
import json
import os
import re
import shutil
import sys
import sqlite3
import subprocess
import time
from typing import Protocol, cast

from app.agents.models import AgentCreateRequest, AgentExecutionStatus, AgentHealthInfo, AgentRecord, AgentRole, AgentRuntimeState, AgentUpdateRequest
from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection

MAX_AGENT_ARGS = 32
MAX_AGENT_ARG_LENGTH = 512
MAX_AGENT_RUNTIME_SECONDS = int(os.getenv("DBZS_AGENT_MAX_RUNTIME_SECONDS", "3600"))
TERMINATE_TIMEOUT_SECONDS = float(os.getenv("DBZS_AGENT_TERMINATE_TIMEOUT_SECONDS", "3"))
LOG_LIMIT_MAX = 250

UNSAFE_ARGUMENT_PATTERN = re.compile(r"[;&|`><]|\$\(|\)\s*\{")


@dataclass
class AgentRow:
    id: str
    name: str
    role: str
    description: str
    command: str
    args_json: str
    cwd: str | None
    enabled: int
    max_job_attempts: int
    created_at: str
    updated_at: str
    last_state: str
    last_pid: int | None
    last_message: str
    last_status_at: str


class ManagedProcess(Protocol):
    pid: int

    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...


class ProcessRunner(Protocol):
    def start(self, command: list[str], cwd: Path) -> ManagedProcess: ...


class SubprocessRunner:
    def start(self, command: list[str], cwd: Path) -> subprocess.Popen[str]:
        return subprocess.Popen(
            command,
            cwd=str(cwd),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )


class AgentRegistryService:
    def __init__(
        self,
        db_path: Path | None = None,
        runner: ProcessRunner | None = None,
        allowed_commands: set[str] | None = None,
    ) -> None:
        self.db_path = db_path or (get_app_data_dir() / "agents.sqlite3")
        self.runner = runner or SubprocessRunner()
        self.allowed_commands = allowed_commands or _default_allowed_commands()
        self._processes: dict[str, ManagedProcess] = {}
        self._process_started_at: dict[str, float] = {}
        self._init_db()
        self._ensure_default_agents()
        self._migrate_legacy_default_agents()

    def list_agents(self) -> list[AgentRecord]:
        self._refresh_runtime_states()
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM agents ORDER BY name COLLATE NOCASE, id"
            ).fetchall()
        return [self._to_record(_row_to_agent_row(row)) for row in rows]

    def get_agent(self, agent_id: str) -> AgentRecord:
        self._refresh_runtime_states()
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM agents WHERE id = ?", (agent_id,)).fetchone()
        if row is None:
            raise KeyError(f"Unknown agent: {agent_id}")
        return self._to_record(_row_to_agent_row(row))

    def create_agent(self, request: AgentCreateRequest) -> AgentRecord:
        self._validate_command(request.command, request.args)
        resolved_cwd = self._validate_cwd(request.cwd)
        now = _utc_now()

        with self._connect() as connection:
            exists = connection.execute("SELECT 1 FROM agents WHERE id = ?", (request.id,)).fetchone()
            if exists is not None:
                raise ValueError(f"Agent already exists: {request.id}")

            connection.execute(
                """
                INSERT INTO agents (
                    id, name, role, description, command, args_json, cwd, enabled, max_job_attempts,
                    created_at, updated_at, last_state, last_pid, last_message, last_status_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    request.id,
                    request.name,
                    request.role,
                    request.description,
                    request.command,
                    json.dumps(request.args),
                    str(resolved_cwd) if resolved_cwd else None,
                    1 if request.enabled else 0,
                    request.max_job_attempts,
                    now,
                    now,
                    "stopped",
                    None,
                    "",
                    now,
                ),
            )

        self._append_log(request.id, "info", "Agent registry entry created.")

        return self.get_agent(request.id)

    def update_agent(self, agent_id: str, request: AgentUpdateRequest) -> AgentRecord:
        current = self.get_agent(agent_id)

        command = request.command if request.command is not None else current.command
        args = request.args if request.args is not None else current.args
        self._validate_command(command, args)

        cwd = request.cwd if request.cwd is not None else current.cwd
        resolved_cwd = self._validate_cwd(cwd)

        enabled = request.enabled if request.enabled is not None else current.enabled

        max_job_attempts = request.max_job_attempts if request.max_job_attempts is not None else current.max_job_attempts

        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE agents
                SET name = ?, role = ?, description = ?, command = ?, args_json = ?, cwd = ?, enabled = ?, max_job_attempts = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    request.name if request.name is not None else current.name,
                    request.role if request.role is not None else current.role,
                    request.description if request.description is not None else current.description,
                    command,
                    json.dumps(args),
                    str(resolved_cwd) if resolved_cwd else None,
                    1 if enabled else 0,
                    max_job_attempts,
                    _utc_now(),
                    agent_id,
                ),
            )
            if updated.rowcount == 0:
                raise KeyError(f"Unknown agent: {agent_id}")

        if not enabled:
            self._stop_running_process(agent_id, "Agent disabled via update.")
        self._append_log(agent_id, "info", "Agent registry entry updated.")

        return self.get_agent(agent_id)

    def start_agent(self, agent_id: str) -> AgentRecord:
        agent = self.get_agent(agent_id)
        if not agent.enabled:
            raise ValueError("Disabled agents cannot be started.")

        active_process = self._processes.get(agent_id)
        if active_process is not None and active_process.poll() is None:
            return agent

        self._validate_command(agent.command, agent.args)
        executable = self._resolve_executable(agent.command)
        cwd = self._validate_cwd(agent.cwd) or Path.cwd()
        extra_args = ["--max-attempts", str(agent.max_job_attempts)]
        process = self.runner.start([executable, *agent.args, *extra_args], cwd=cwd)
        self._processes[agent_id] = process
        self._process_started_at[agent_id] = time.monotonic()

        self._update_status(
            agent_id,
            state="running",
            pid=process.pid,
            message=f"Agent started with pid {process.pid}.",
        )
        self._append_log(agent_id, "info", f"Agent started with pid {process.pid}.")
        return self.get_agent(agent_id)

    def stop_agent(self, agent_id: str) -> AgentRecord:
        _ = self.get_agent(agent_id)

        self._stop_running_process(agent_id, "Agent stopped by user.")
        self._update_status(
            agent_id,
            state="stopped",
            pid=None,
            message="Agent stopped.",
        )
        self._append_log(agent_id, "info", "Agent stop requested by user.")
        return self.get_agent(agent_id)

    def delete_agent(self, agent_id: str) -> None:
        _ = self.get_agent(agent_id)
        self._stop_running_process(agent_id, "Agent deleted while running.")

        with self._connect() as connection:
            deleted = connection.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
            connection.execute("DELETE FROM agent_logs WHERE agent_id = ?", (agent_id,))
            if deleted.rowcount == 0:
                raise KeyError(f"Unknown agent: {agent_id}")

    def get_agent_health(self, agent_id: str) -> AgentHealthInfo:
        agent = self.get_agent(agent_id)
        started_at = self._process_started_at.get(agent_id)
        uptime: float | None = (time.monotonic() - started_at) if started_at is not None else None

        one_hour_ago = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        with self._connect() as connection:
            log_columns = {
                str(row["name"]) for row in connection.execute("PRAGMA table_info(agent_logs)").fetchall()
            }
            created_at_expr = (
                "COALESCE(NULLIF(created_at, ''), timestamp)"
                if "timestamp" in log_columns
                else "created_at"
            )
            error_count = connection.execute(
                f"SELECT COUNT(*) FROM agent_logs WHERE agent_id = ? AND level = 'error' AND {created_at_expr} >= ?",
                (agent_id, one_hour_ago),
            ).fetchone()[0]
            last_log_row = connection.execute(
                f"SELECT message, {created_at_expr} AS created_at FROM agent_logs WHERE agent_id = ? ORDER BY id DESC LIMIT 1",
                (agent_id,),
            ).fetchone()

        return AgentHealthInfo(
            agent_id=agent_id,
            pid=agent.status.pid,
            state=agent.status.state,
            uptime_seconds=uptime,
            error_count_1h=int(error_count),
            last_log=str(last_log_row["message"]) if last_log_row else None,
            last_log_at=str(last_log_row["created_at"]) if last_log_row else None,
        )

    def list_logs(self, agent_id: str, limit: int = 100) -> list[dict[str, str | int]]:
        _ = self.get_agent(agent_id)
        safe_limit = min(max(limit, 1), LOG_LIMIT_MAX)

        with self._connect() as connection:
            log_columns = {
                str(row["name"]) for row in connection.execute("PRAGMA table_info(agent_logs)").fetchall()
            }
            created_at_expr = (
                "COALESCE(NULLIF(created_at, ''), timestamp)"
                if "timestamp" in log_columns
                else "created_at"
            )
            rows = connection.execute(
                f"""
                SELECT id, agent_id, level, message, {created_at_expr} AS created_at
                FROM agent_logs
                WHERE agent_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (agent_id, safe_limit),
            ).fetchall()

        return [
            {
                "id": int(row["id"]),
                "agent_id": str(row["agent_id"]),
                "level": str(row["level"]),
                "message": str(row["message"]),
                "created_at": str(row["created_at"]),
            }
            for row in rows
        ]

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'coder',
                    description TEXT NOT NULL,
                    command TEXT NOT NULL,
                    args_json TEXT NOT NULL,
                    cwd TEXT,
                    enabled INTEGER NOT NULL,
                    max_job_attempts INTEGER NOT NULL DEFAULT 3,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_state TEXT NOT NULL,
                    last_pid INTEGER,
                    last_message TEXT NOT NULL,
                    last_status_at TEXT NOT NULL
                )
                """
            )
            columns = {
                str(row["name"]) for row in connection.execute("PRAGMA table_info(agents)").fetchall()
            }
            if "role" not in columns:
                connection.execute("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'coder'")
            if "max_job_attempts" not in columns:
                connection.execute("ALTER TABLE agents ADD COLUMN max_job_attempts INTEGER NOT NULL DEFAULT 3")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id TEXT NOT NULL,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
                )
                """
            )
            log_columns = {
                str(row["name"]) for row in connection.execute("PRAGMA table_info(agent_logs)").fetchall()
            }
            if "created_at" not in log_columns:
                connection.execute(
                    "ALTER TABLE agent_logs ADD COLUMN created_at TEXT NOT NULL DEFAULT ''"
                )
                log_columns.add("created_at")
            if "timestamp" in log_columns:
                connection.execute(
                    """
                    UPDATE agent_logs
                    SET created_at = timestamp
                    WHERE (created_at = '' OR created_at IS NULL) AND timestamp IS NOT NULL
                    """
                )
                connection.execute(
                    """
                    UPDATE agent_logs
                    SET timestamp = created_at
                    WHERE (timestamp = '' OR timestamp IS NULL) AND created_at IS NOT NULL
                    """
                )
            elif "created_at" in log_columns:
                connection.execute(
                    """
                    UPDATE agent_logs
                    SET created_at = datetime('now')
                    WHERE created_at = '' OR created_at IS NULL
                    """
                )

    def _connect(self):
        return sqlite_connection(self.db_path)

    def _refresh_runtime_states(self) -> None:
        for agent_id, process in list(self._processes.items()):
            started_at = self._process_started_at.get(agent_id)
            if started_at is not None and (time.monotonic() - started_at) > MAX_AGENT_RUNTIME_SECONDS:
                self._stop_running_process(agent_id, "Agent terminated due to runtime timeout.")
                self._update_status(
                    agent_id,
                    state="error",
                    pid=None,
                    message=f"Agent exceeded max runtime of {MAX_AGENT_RUNTIME_SECONDS}s.",
                )
                self._append_log(agent_id, "warning", "Agent terminated after runtime timeout.")
                continue

            exit_code = process.poll()
            if exit_code is None:
                continue

            self._processes.pop(agent_id, None)
            self._process_started_at.pop(agent_id, None)
            state = "stopped" if exit_code == 0 else "error"
            message = "Agent process exited." if exit_code == 0 else f"Agent exited with code {exit_code}."
            self._update_status(agent_id, state=state, pid=None, message=message)
            self._append_log(agent_id, "info" if exit_code == 0 else "error", message)

    def _validate_cwd(self, cwd: str | None) -> Path | None:
        if cwd is None or cwd.strip() == "":
            return None

        candidate = Path(cwd).expanduser().resolve()
        if not candidate.exists() or not candidate.is_dir():
            raise ValueError(f"Invalid working directory: {cwd}")
        return candidate

    def _validate_command(self, command: str, args: list[str]) -> None:
        executable = command.strip()
        if not executable:
            raise ValueError("Command cannot be empty.")

        normalized = Path(executable).name.lower()
        if normalized not in self.allowed_commands:
            raise ValueError(f"Command not allowed: {normalized}")

        if len(args) > MAX_AGENT_ARGS:
            raise ValueError("Too many arguments.")

        for argument in args:
            if len(argument) > MAX_AGENT_ARG_LENGTH:
                raise ValueError("Argument exceeds length limit.")
            if any(char in argument for char in ["\n", "\r", "\0"]):
                raise ValueError("Arguments contain invalid control characters.")
            if UNSAFE_ARGUMENT_PATTERN.search(argument):
                raise ValueError("Argument contains disallowed shell metacharacters.")

    def _resolve_executable(self, command: str) -> str:
        executable = command.strip()
        if Path(executable).exists():
            return str(Path(executable).resolve())

        resolved = shutil.which(executable)
        if resolved is None:
            if executable.lower() in ("python", "python.exe", "python3", "python3.exe"):
                return sys.executable
            raise ValueError(f"Executable not found: {executable}")
        return resolved

    def _stop_running_process(self, agent_id: str, message: str) -> None:
        process = self._processes.get(agent_id)
        if process is None:
            self._process_started_at.pop(agent_id, None)
            return

        if process.poll() is None:
            process.terminate()
            if hasattr(process, "wait"):
                try:
                    process.wait(timeout=TERMINATE_TIMEOUT_SECONDS)
                except (OSError, subprocess.SubprocessError, TimeoutError):
                    if hasattr(process, "kill"):
                        process.kill()

        self._processes.pop(agent_id, None)
        self._process_started_at.pop(agent_id, None)
        self._append_log(agent_id, "info", message)

    def _append_log(self, agent_id: str, level: str, message: str) -> None:
        now = _utc_now()
        with self._connect() as connection:
            log_columns = {
                str(row["name"]) for row in connection.execute("PRAGMA table_info(agent_logs)").fetchall()
            }
            if "timestamp" in log_columns:
                connection.execute(
                    """
                    INSERT INTO agent_logs (agent_id, level, message, timestamp, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (agent_id, level, message, now, now),
                )
            else:
                connection.execute(
                    "INSERT INTO agent_logs (agent_id, level, message, created_at) VALUES (?, ?, ?, ?)",
                    (agent_id, level, message, now),
                )

    def _update_status(self, agent_id: str, state: str, pid: int | None, message: str) -> None:
        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE agents
                SET last_state = ?, last_pid = ?, last_message = ?, last_status_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (state, pid, message, _utc_now(), _utc_now(), agent_id),
            )
            if updated.rowcount == 0:
                raise KeyError(f"Unknown agent: {agent_id}")

    def _to_record(self, row: AgentRow) -> AgentRecord:
        return AgentRecord(
            id=row.id,
            name=row.name,
            role=cast(AgentRole, row.role if row.role in {"planner", "coder", "tester", "reviewer", "debugger", "docs"} else "coder"),
            description=row.description,
            command=row.command,
            args=_parse_args(row.args_json),
            cwd=row.cwd,
            enabled=bool(row.enabled),
            max_job_attempts=row.max_job_attempts,
            created_at=row.created_at,
            updated_at=row.updated_at,
            status=AgentExecutionStatus(
                state=cast(AgentRuntimeState, row.last_state),
                pid=row.last_pid,
                message=row.last_message,
                updated_at=row.last_status_at,
            ),
        )

    def _ensure_default_agents(self) -> None:
        # Absolute path to the agent loop script — works regardless of cwd at runtime.
        _agent_loop_script = str(Path(__file__).parent / "agent_loop.py")

        defaults = [
            {
                "id": "planner",
                "name": "Planner",
                "role": "planner",
                "description": "Zerlegt Aufgaben in umsetzbare Schritte.",
            },
            {
                "id": "coder",
                "name": "Coder",
                "role": "coder",
                "description": "Implementiert Features und Bugfixes.",
            },
            {
                "id": "tester",
                "name": "Tester",
                "role": "tester",
                "description": "Fuehrt Tests aus und sichert Qualitaet.",
            },
            {
                "id": "reviewer",
                "name": "Reviewer",
                "role": "reviewer",
                "description": "Prueft Aenderungen auf Risiken und Regressionen.",
            },
            {
                "id": "debugger",
                "name": "Debugger",
                "role": "debugger",
                "description": "Analysiert Fehler und isoliert Root Causes.",
            },
            {
                "id": "docs",
                "name": "Docs",
                "role": "docs",
                "description": "Pflegt technische Dokumentation.",
            },
        ]

        now = _utc_now()
        with self._connect() as connection:
            for agent in defaults:
                exists = connection.execute("SELECT 1 FROM agents WHERE id = ?", (agent["id"],)).fetchone()
                if exists is not None:
                    continue

                connection.execute(
                    """
                    INSERT INTO agents (
                        id, name, role, description, command, args_json, cwd, enabled, max_job_attempts,
                        created_at, updated_at, last_state, last_pid, last_message, last_status_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        agent["id"],
                        agent["name"],
                        agent["role"],
                        agent["description"],
                        "python",
                        json.dumps([
                            _agent_loop_script,
                            "--agent-id", agent["id"],
                            "--role", agent["role"],
                        ]),
                        None,
                        1,
                        3,
                        now,
                        now,
                        "stopped",
                        None,
                        "",
                        now,
                    ),
                )

    def _migrate_legacy_default_agents(self) -> None:
        """Upgrade default agents that still use the old `node --version` placeholder command."""
        _agent_loop_script = str(Path(__file__).parent / "agent_loop.py")
        default_ids = {"planner", "coder", "tester", "reviewer", "debugger", "docs"}
        now = _utc_now()

        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, role FROM agents WHERE id IN ({})".format(
                    ",".join("?" * len(default_ids))
                ),
                tuple(default_ids),
            ).fetchall()

            for row in rows:
                agent_id = str(row["id"])
                role = str(row["role"])
                current_args = connection.execute(
                    "SELECT command, args_json FROM agents WHERE id = ?", (agent_id,)
                ).fetchone()
                if current_args is None:
                    continue

                if str(current_args["command"]) == "node":
                    connection.execute(
                        "UPDATE agents SET command = ?, args_json = ?, updated_at = ? WHERE id = ?",
                        (
                            "python",
                            json.dumps([
                                _agent_loop_script,
                                "--agent-id", agent_id,
                                "--role", role,
                            ]),
                            now,
                            agent_id,
                        ),
                    )


def _default_allowed_commands() -> set[str]:
    configured = os.getenv("DBZS_AGENT_ALLOWED_COMMANDS")
    if configured:
        return {item.strip().lower() for item in configured.split(",") if item.strip()}

    return {
        "node",
        "python",
        "python.exe",
        "python3",
        "python3.exe",
        "uv",
        "pnpm",
        "npm",
        "powershell",
        "pwsh",
        "cmd",
    }


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _parse_args(args_json: str) -> list[str]:
    try:
        parsed = json.loads(args_json)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed, list):
        return []

    return [str(item) for item in parsed]


def _row_to_agent_row(row: sqlite3.Row) -> AgentRow:
    try:
        max_job_attempts = int(row["max_job_attempts"])
    except (KeyError, TypeError):
        max_job_attempts = 3
    return AgentRow(
        id=str(row["id"]),
        name=str(row["name"]),
        role=str(row["role"]),
        description=str(row["description"]),
        command=str(row["command"]),
        args_json=str(row["args_json"]),
        cwd=row["cwd"],
        enabled=int(row["enabled"]),
        max_job_attempts=max_job_attempts,
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        last_state=str(row["last_state"]),
        last_pid=int(row["last_pid"]) if row["last_pid"] is not None else None,
        last_message=str(row["last_message"]),
        last_status_at=str(row["last_status_at"]),
    )
