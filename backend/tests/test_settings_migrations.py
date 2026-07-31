import pytest

from app.settings import migrations


def test_migrate_adds_missing_schema_version() -> None:
    migrated, changed = migrations.migrate({"defaultModelId": "coder.gguf"})

    assert migrated["schemaVersion"] == 1
    assert changed is True


def test_migrate_is_a_noop_when_already_current(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migrations, "CURRENT_SCHEMA_VERSION", 1)
    monkeypatch.setattr(migrations, "MIGRATIONS", {})

    migrated, changed = migrations.migrate({"schemaVersion": 1, "defaultModelId": "coder.gguf"})

    assert migrated == {"schemaVersion": 1, "defaultModelId": "coder.gguf"}
    assert changed is False


def test_migrate_applies_a_registered_migration_and_bumps_version(monkeypatch: pytest.MonkeyPatch) -> None:
    def rename_field(raw: dict) -> dict:
        next_raw = dict(raw)
        if "oldFieldName" in next_raw:
            next_raw["newFieldName"] = next_raw.pop("oldFieldName")
        return next_raw

    monkeypatch.setattr(migrations, "CURRENT_SCHEMA_VERSION", 2)
    monkeypatch.setattr(migrations, "MIGRATIONS", {2: rename_field})

    migrated, changed = migrations.migrate({"schemaVersion": 1, "oldFieldName": "value"})

    assert migrated["schemaVersion"] == 2
    assert migrated["newFieldName"] == "value"
    assert "oldFieldName" not in migrated
    assert changed is True


def test_migrate_applies_multiple_steps_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def step_to_2(raw: dict) -> dict:
        calls.append(2)
        return {**raw, "v2Field": True}

    def step_to_3(raw: dict) -> dict:
        calls.append(3)
        return {**raw, "v3Field": True}

    monkeypatch.setattr(migrations, "CURRENT_SCHEMA_VERSION", 3)
    monkeypatch.setattr(migrations, "MIGRATIONS", {2: step_to_2, 3: step_to_3})

    migrated, changed = migrations.migrate({"schemaVersion": 1})

    assert calls == [2, 3]
    assert migrated["schemaVersion"] == 3
    assert migrated["v2Field"] is True
    assert migrated["v3Field"] is True
    assert changed is True


def test_migrate_stops_at_a_gap_instead_of_skipping_ahead(monkeypatch: pytest.MonkeyPatch) -> None:
    def step_to_3(raw: dict) -> dict:
        return {**raw, "v3Field": True}

    # No migration registered for version 2 — the runner must stop at 1, not jump to 3.
    monkeypatch.setattr(migrations, "CURRENT_SCHEMA_VERSION", 3)
    monkeypatch.setattr(migrations, "MIGRATIONS", {3: step_to_3})

    migrated, changed = migrations.migrate({"schemaVersion": 1})

    assert migrated["schemaVersion"] == 1
    assert "v3Field" not in migrated
    assert changed is False


def test_migrate_treats_non_integer_schema_version_as_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migrations, "CURRENT_SCHEMA_VERSION", 1)
    monkeypatch.setattr(migrations, "MIGRATIONS", {})

    migrated, _changed = migrations.migrate({"schemaVersion": "not-a-number"})

    assert migrated["schemaVersion"] == "not-a-number"  # untouched: no migration ran, nothing to bump
