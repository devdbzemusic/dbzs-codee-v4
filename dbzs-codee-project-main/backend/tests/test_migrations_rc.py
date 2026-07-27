import sqlite3
from pathlib import Path

import pytest

from app.core.migrations import MigrationManager


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
