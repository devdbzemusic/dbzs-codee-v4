"""
DBZS – Division By Zeros
Datei: migrations.py
Bereich: Backend Settings

Zweck:
    Versionierter Migrations-Runner fuer settings.json. Aktuell existiert
    keine echte Migration (CURRENT_SCHEMA_VERSION == 1) — dieses Modul legt
    die Struktur fuer kuenftige Schema-Aenderungen an, statt bei Bedarf wieder
    Ad-hoc-Feld-Patches in service.py zu verstreuen.

Warum:
    `SettingsService.load()` hatte bisher nur einen einzigen inline Spezialfall
    ("schemaVersion" fehlt -> auf 1 setzen). Das skaliert nicht auf eine
    zweite oder dritte Schema-Aenderung. Jede registrierte Migration bekommt
    stattdessen eine feste Zielversion und wird der Reihe nach angewendet.
"""

from __future__ import annotations

from collections.abc import Callable

MigrationFn = Callable[[dict], dict]

# Bump when a new migration is registered below; the runner walks from the
# document's current schemaVersion up to this value, one migration at a time.
CURRENT_SCHEMA_VERSION = 1

# Keyed by the version a migration produces, e.g. `{2: migrate_v1_to_v2}`.
# Empty today — no schema change has required one yet.
MIGRATIONS: dict[int, MigrationFn] = {}


def migrate(raw: dict) -> tuple[dict, bool]:
    """Applies all registered migrations in order, from the document's current
    schemaVersion up to CURRENT_SCHEMA_VERSION.

    Returns (migrated_dict, changed) — `changed` is True if anything about the
    dict was altered (including the trivial "schemaVersion field was entirely
    missing" case), so the caller knows whether to persist the result.
    """
    changed = False
    if "schemaVersion" not in raw:
        raw = {**raw, "schemaVersion": 1}
        changed = True

    version = raw.get("schemaVersion", 1)
    if not isinstance(version, int):
        version = 1

    while version < CURRENT_SCHEMA_VERSION:
        next_version = version + 1
        migration = MIGRATIONS.get(next_version)
        if migration is None:
            # No migration registered for this step — stop rather than silently
            # skip ahead; a gap here is a bug in MIGRATIONS, not something to paper over.
            break
        raw = migration(raw)
        raw["schemaVersion"] = next_version
        version = next_version
        changed = True

    return raw, changed
