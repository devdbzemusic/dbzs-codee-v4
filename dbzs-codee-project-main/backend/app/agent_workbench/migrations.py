"""Idempotent SQLite schema for Agent Workbench."""

from __future__ import annotations

import sqlite3

SCHEMA_VERSION = 1


def ensure_tables(conn: sqlite3.Connection) -> None:
    """Create all agent workbench tables if they do not exist."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            job_id TEXT,
            workspace_root TEXT NOT NULL,
            workspace_name TEXT NOT NULL DEFAULT '',
            goal TEXT NOT NULL,
            status TEXT NOT NULL,
            execution_mode TEXT NOT NULL DEFAULT 'supervised',
            provider TEXT NOT NULL DEFAULT 'local',
            model_id TEXT NOT NULL DEFAULT 'default',
            current_step_id TEXT,
            max_steps INTEGER NOT NULL DEFAULT 20,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            pause_reason TEXT,
            error_message TEXT,
            schema_version TEXT NOT NULL DEFAULT 'agent-run-v1',
            execution_backend TEXT NOT NULL DEFAULT 'simulation',
            runtime_provider TEXT,
            runtime_model_id TEXT,
            runtime_model_name TEXT,
            runtime_endpoint TEXT,
            runtime_pid INTEGER,
            runtime_health_state TEXT,
            runtime_verified_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_steps (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'general',
            depends_on_json TEXT NOT NULL DEFAULT '[]',
            tool_policy_json TEXT NOT NULL DEFAULT '{}',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            input_summary TEXT,
            output_summary TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            error_message TEXT,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_steps_run_id
        ON agent_steps(run_id, ordinal)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_events (
            sequence INTEGER NOT NULL,
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_id TEXT,
            event_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            summary TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id),
            UNIQUE (run_id, sequence)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_events_run_sequence
        ON agent_events(run_id, sequence)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_tool_calls (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_id TEXT NOT NULL,
            tool_id TEXT NOT NULL,
            status TEXT NOT NULL,
            arguments_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT,
            stdout_tail TEXT,
            stderr_tail TEXT,
            exit_code INTEGER,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            error_message TEXT,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_file_changes (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            operation TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            before_hash TEXT,
            after_hash TEXT,
            diff TEXT,
            added_lines INTEGER NOT NULL DEFAULT 0,
            removed_lines INTEGER NOT NULL DEFAULT 0,
            restore_point_id TEXT,
            review_gate_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_followups (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            text TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            processed_at TEXT,
            effect_summary TEXT,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS host_actions (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_id TEXT NOT NULL,
            action_type TEXT NOT NULL,
            status TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT,
            executor_id TEXT,
            created_at TEXT NOT NULL,
            claimed_at TEXT,
            completed_at TEXT,
            error_message TEXT,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_host_actions_pending
        ON host_actions(status, created_at)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_workbench_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    conn.execute(
        "INSERT OR IGNORE INTO agent_workbench_meta (key, value) VALUES (?, ?)",
        ("schema_version", str(SCHEMA_VERSION)),
    )
    conn.commit()
