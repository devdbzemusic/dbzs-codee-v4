import sqlite3
from pathlib import Path

import pytest

from app.agents.service import AgentRegistryService
from app.core.migrations import MigrationManager, run_all_migrations


def test_pending_migration_is_transactional_and_backed_up(tmp_path: Path):
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO legacy(value) VALUES ('kept')")

    def migrate(conn: sqlite3.Connection) -> None:
        conn.execute("ALTER TABLE legacy ADD COLUMN migrated INTEGER DEFAULT 1")

    manager = MigrationManager(str(database))
    assert manager.run_pending([("001_test", migrate)]) == 1
    assert manager.run_pending([("001_test", migrate)]) == 0
    assert list(tmp_path.glob("legacy.sqlite3.pre-migration-*.bak"))
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT value, migrated FROM legacy").fetchone() == ("kept", 1)


def test_failed_migration_rolls_back_and_is_not_marked(tmp_path: Path):
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE legacy (id INTEGER PRIMARY KEY)")

    def broken(conn: sqlite3.Connection) -> None:
        conn.execute("ALTER TABLE legacy ADD COLUMN temporary TEXT")
        raise RuntimeError("boom")

    manager = MigrationManager(str(database))
    with pytest.raises(RuntimeError, match="boom"):
        manager.run_pending([("001_broken", broken)])
    with sqlite3.connect(database) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(legacy)")}
        assert "temporary" not in columns
        assert conn.execute("SELECT COUNT(*) FROM migrations WHERE name='001_broken'").fetchone()[0] == 0


def test_run_all_migrations_against_a_freshly_bootstrapped_agents_db(tmp_path: Path):
    # Regression test for the exact failure the boot orchestrator's
    # database-init phase (app/main.py:_run_database_init) surfaced the
    # first time this code path actually ran: a fresh AgentRegistryService
    # install creates `agent_logs` with only `created_at`, never a legacy
    # `timestamp` column, so migration 001's backfill must not assume that
    # column exists.
    db_path = tmp_path / "agents.sqlite3"
    AgentRegistryService(db_path=db_path)  # creates agents/agent_logs tables, no `timestamp` column

    applied = run_all_migrations(db_path=str(db_path))

    assert applied == 4
    with sqlite3.connect(db_path) as conn:
        log_columns = {row[1] for row in conn.execute("PRAGMA table_info(agent_logs)").fetchall()}
        assert "legacy_timestamp" in log_columns
        table_names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert "job_loop_state" in table_names
        assert "review_gates" in table_names

    # Idempotent: running again against the same DB applies nothing new.
    assert run_all_migrations(db_path=str(db_path)) == 0
