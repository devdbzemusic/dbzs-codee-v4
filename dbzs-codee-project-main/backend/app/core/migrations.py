"""Database Migration Manager — Automatische Schema-Migrationen."""

from __future__ import annotations

import sqlite3
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable


class MigrationManager:
    """Verwaltet Datenbank-Migrationen für SQLite."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._ensure_migrations_table()

    def _default_db_path(self) -> str:
        """Default SQLite-Pfad."""
        from app.core.config import get_app_data_dir
        app_data = get_app_data_dir()
        return str(Path(app_data) / "agents.sqlite3")

    def _ensure_migrations_table(self) -> None:
        """Erstellt migrations Tabelle falls nicht vorhanden."""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS migrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    applied_at TEXT NOT NULL
                )
            """)
            conn.commit()
        finally:
            conn.close()

    def _get_applied_migrations(self) -> set[str]:
        """Ruft bereits angewendete Migrationen ab."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("SELECT name FROM migrations")
            return {row[0] for row in cursor.fetchall()}
        finally:
            conn.close()

    def _mark_applied(self, name: str) -> None:
        """Markiert Migration als angewendet."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
                (name, datetime.now(UTC).isoformat()),
            )
            conn.commit()
        finally:
            conn.close()

    def register_migration(self, name: str, migration_fn: Callable[[sqlite3.Connection], None]) -> None:
        """
        Registriert eine Migration.

        Args:
            name: Eindeutiger Migrations-Name (z.B. "001_add_timestamp_index")
            migration_fn: Funktion die Connection entgegennimmt und Migration durchführt
        """
        applied = self._get_applied_migrations()
        if name in applied:
            return  # Already applied

        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            migration_fn(conn)
            conn.execute(
                "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
                (name, datetime.now(UTC).isoformat()),
            )
            conn.commit()
            print(f"[Migration] Applied: {name}")
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_backup(self) -> Path | None:
        """Sichert eine vorhandene Datenbank vor der ersten ausstehenden Migration."""
        source = Path(self.db_path)
        if not source.exists() or source.stat().st_size == 0:
            return None
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        backup = source.with_name(f"{source.name}.pre-migration-{timestamp}.bak")
        shutil.copy2(source, backup)
        return backup

    def run_pending(self, migrations: list[tuple[str, Callable[[sqlite3.Connection], None]]]) -> int:
        """
        Führt ausstehende Migrationen aus.

        Args:
            migrations: Liste von (name, migration_fn) Tupeln

        Returns:
            Anzahl angewendeter Migrationen
        """
        applied = self._get_applied_migrations()
        pending = [(name, migration_fn) for name, migration_fn in migrations if name not in applied]
        if pending:
            self.create_backup()
        count = 0

        for name, migration_fn in pending:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.execute("BEGIN IMMEDIATE")
                migration_fn(conn)
                conn.execute(
                    "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
                    (name, datetime.now(UTC).isoformat()),
                )
                conn.commit()
                count += 1
                print(f"[Migration] Applied: {name}")
            except Exception as e:
                conn.rollback()
                print(f"[Migration] Failed {name}: {e}")
                raise
            finally:
                conn.close()

        return count


# ============= Migration Definitions =============

def migration_001_add_legacy_timestamp_column(conn: sqlite3.Connection) -> None:
    """Migration 001: Fügt legacy_timestamp Spalte hinzu für Abwärtskompatibilität."""
    conn.execute("""
        ALTER TABLE agent_logs 
        ADD COLUMN legacy_timestamp TEXT
    """)
    conn.execute("""
        UPDATE agent_logs 
        SET legacy_timestamp = timestamp 
        WHERE legacy_timestamp IS NULL
    """)

def migration_002_add_agent_metadata(conn: sqlite3.Connection) -> None:
    """Migration 002: Fügt Metadata-Spalte zu agents Tabelle hinzu."""
    conn.execute("""
        ALTER TABLE agents 
        ADD COLUMN metadata TEXT
    """)

def migration_003_add_job_loop_state(conn: sqlite3.Connection) -> None:
    """Migration 003: Erstellt job_loop_state Tabelle."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS job_loop_state (
            job_id TEXT PRIMARY KEY,
            step_count INTEGER DEFAULT 0,
            max_steps INTEGER DEFAULT 10,
            started_at TEXT NOT NULL,
            last_step_at TEXT,
            terminated_at TEXT,
            termination_reason TEXT,
            termination_code INTEGER
        )
    """)

def migration_004_add_review_gates(conn: sqlite3.Connection) -> None:
    """Migration 004: Erstellt review_gates Tabellen."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS review_gates (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            step_number INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            reviewed_at TEXT,
            reviewed_by TEXT,
            review_comment TEXT,
            auto_apply_timeout_seconds INTEGER DEFAULT 300
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS proposed_changes (
            id TEXT PRIMARY KEY,
            review_gate_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            old_content TEXT,
            new_content TEXT,
            diff TEXT NOT NULL,
            risk_level TEXT DEFAULT 'medium',
            risk_factors TEXT,
            FOREIGN KEY (review_gate_id) REFERENCES review_gates(id)
        )
    """)


# ============= Public API =============

def run_all_migrations(db_path: str | None = None) -> int:
    """
    Führt alle ausstehenden Migrationen aus.

    Returns:
        Anzahl angewendeter Migrationen
    """
    manager = MigrationManager(db_path=db_path)

    migrations = [
        ("001_add_legacy_timestamp", migration_001_add_legacy_timestamp_column),
        ("002_add_agent_metadata", migration_002_add_agent_metadata),
        ("003_add_job_loop_state", migration_003_add_job_loop_state),
        ("004_add_review_gates", migration_004_add_review_gates),
    ]

    return manager.run_pending(migrations)
