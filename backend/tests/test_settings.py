from pathlib import Path
import json

from fastapi.testclient import TestClient

from app.main import app
from app.settings import migrations
from app.settings.service import SettingsService, get_settings_service


def override_service(settings_path: Path):
    def _factory() -> SettingsService:
        return SettingsService(settings_path=settings_path)

    return _factory


def _minimal_payload(**overrides):
    payload = {
        "theme": "dark",
        "autoSave": False,
        "editorFontSize": 16,
        "terminalShell": "pwsh",
        "safeCommandConfirmation": True,
        "telemetryEnabled": False,
        "modelsPath": "D:/Models",
        "defaultModelId": "model-a",
        "defaultChatModelId": "",
        "defaultModelName": "Default Model",
        "backendUrl": "http://127.0.0.1:8876",
        "agentExecutionEnabled": True,
        "safeMode": True,
        "maxAgentRuntimeSeconds": 5400,
        "maxFileScanCount": 1500,
        "cloudModelsEnabled": False,
        "preferLocalModels": True,
        "localOnlyModels": True,
        "ollamaBaseUrl": "http://127.0.0.1:11434",
        "anthropicApiKey": "",
        "openaiApiKey": "",
        "defaultPlannerModelId": "",
        "defaultCoderModelId": "model-a",
        "defaultReviewerModelId": "",
        "defaultDebugModelId": "",
        "autoStartChatRuntime": False,
        "autoStartCodingRuntime": False,
        "autoStartVisionRuntime": False,
        "autoStartReviewRuntime": False,
        "idleUnloadWorkModelsMinutes": 10,
        "chatRuntimeSlot": "quality_cpu",
        "codingRuntimeSlot": "fast_gpu",
        "chatRuntimePort": 8081,
        "codingRuntimePort": 8082,
        "stopDesktopRuntimesOnExit": True,
        "maxAutonomousSteps": 20,
        "maxDebugRetries": 2,
        "maxFailedTaskRetries": 1,
        "localOnly": True,
        "modelDiscoveryMode": "project_local_strict",
        "runtimeChatUseBroker": True,
        "runtimeChatEnableSlotValidation": True,
        "runtimeChatEnableAgentTurnLoop": True,
        "runtimeChatEnableStrictFallback": True,
        "runtimeChatEnableDiagnostics": True,
        "runtimeChatShadowMode": True,
        "runtimeChatCanaryPercent": 100,
        "runtimeChatStopOnShadowMismatch": True,
        "reasoningDisplayMode": "summary",
        "contextSpoolerEnabled": True,
        "ragEnabled": True,
        "hybridRetrievalEnabled": True,
        "reasoningTraceEnabled": True,
        "tokenBudgetOutputReserveRatio": 0.22,
        "tokenBudgetToolReserveRatio": 0.07,
        "tokenBudgetSafetyReserveRatio": 0.05,
        "conversationControlV2": True,
        "legacyStructuredMarkupParser": False,
        "defaultOrchestratorModelId": "functiongemma-270m-it",
        "autoStartOrchestratorRuntime": False,
        "orchestratorRuntimeSlot": "orchestrator_cpu",
        "orchestratorRuntimePort": 8094,
    }
    payload.update(overrides)
    return payload


def test_get_settings_creates_default_file(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)

    response = client.get("/settings")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["theme"] == "dark"
    assert body["telemetryEnabled"] is False
    assert body["backendUrl"] == "http://127.0.0.1:8876"
    assert body["runtimeChatShadowMode"] is False
    assert body["runtimeChatStopOnShadowMismatch"] is False
    assert body["autoStartOrchestratorRuntime"] is True
    assert body["orchestratorRuntimeSlot"] == "orchestrator_cpu"
    assert body["orchestratorRuntimePort"] == 8084
    assert body["schemaVersion"] == 1
    assert body["revision"] == 0
    assert body["conversationControlV2"] is True
    assert body["legacyStructuredMarkupParser"] is False
    assert body["ollamaBaseUrl"] == "http://127.0.0.1:11434"
    assert body["modelsPath"] == "D:/Models"
    assert settings_path.exists()


def test_put_settings_persists_valid_settings(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)
    payload = _minimal_payload()

    update_response = client.put("/settings", json=payload)
    get_response = client.get("/settings")

    app.dependency_overrides.clear()
    assert update_response.status_code == 200
    saved = get_response.json()
    for key, value in payload.items():
        assert saved[key] == value, key
    assert saved["revision"] >= 1
    assert saved["updatedAt"]


def test_put_settings_rejects_telemetry_enabled(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)
    payload = _minimal_payload(telemetryEnabled=True)

    response = client.put("/settings", json=payload)

    app.dependency_overrides.clear()
    assert response.status_code == 422


def test_patch_settings_changes_only_specified_keys(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)
    client.get("/settings")
    before = client.get("/settings").json()

    response = client.patch(
        "/settings",
        json={
            "baseRevision": before["revision"],
            "changes": {"idleUnloadWorkModelsMinutes": 0, "safeCommandConfirmation": False},
        },
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["settings"]["idleUnloadWorkModelsMinutes"] == 0
    assert body["settings"]["safeCommandConfirmation"] is False
    assert body["settings"]["theme"] == before["theme"]
    assert body["revision"] == before["revision"] + 1
    assert set(body["appliedKeys"]) == {"idleUnloadWorkModelsMinutes", "safeCommandConfirmation"}


def test_patch_settings_revision_conflict(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)
    client.get("/settings")

    response = client.patch(
        "/settings",
        json={"baseRevision": 999, "changes": {"theme": "light"}},
    )

    app.dependency_overrides.clear()
    assert response.status_code == 409
    assert response.json()["detail"] == "settings_revision_conflict"


def test_corrupt_settings_file_is_backed_up(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    settings_path.write_text("{not-json", encoding="utf-8")
    service = SettingsService(settings_path=settings_path)

    loaded = service.load()

    assert loaded.theme == "dark"
    backups = list(tmp_path.glob("settings.json.corrupt.*"))
    assert len(backups) == 1
    assert settings_path.exists()
    raw = json.loads(settings_path.read_text(encoding="utf-8"))
    assert raw["schemaVersion"] == 1


def test_load_backs_up_settings_before_applying_a_real_migration(
    tmp_path: Path, monkeypatch
) -> None:
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(
        json.dumps({"schemaVersion": 1, "theme": "dark"}), encoding="utf-8"
    )

    def bump_theme_field(raw: dict) -> dict:
        return {**raw, "theme": "light"}

    monkeypatch.setattr(migrations, "CURRENT_SCHEMA_VERSION", 2)
    monkeypatch.setattr(migrations, "MIGRATIONS", {2: bump_theme_field})

    service = SettingsService(settings_path=settings_path)
    loaded = service.load()

    assert loaded.schemaVersion == 2
    assert loaded.theme == "light"
    backups = list(tmp_path.glob("settings.json.pre-migration-v1-to-v2.*"))
    assert len(backups) == 1
    backed_up_raw = json.loads(backups[0].read_text(encoding="utf-8"))
    assert backed_up_raw["theme"] == "dark"  # pre-migration content preserved


def test_load_does_not_back_up_for_the_trivial_missing_schema_version_case(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(json.dumps({"theme": "dark"}), encoding="utf-8")

    service = SettingsService(settings_path=settings_path)
    service.load()

    assert list(tmp_path.glob("settings.json.pre-migration-*")) == []


def test_atomic_save_replaces_file(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    service = SettingsService(settings_path=settings_path)
    first = service.load()
    first.theme = "light"
    saved = service.save(first)
    assert saved.theme == "light"
    assert not settings_path.with_name("settings.json.tmp").exists()
    assert json.loads(settings_path.read_text(encoding="utf-8"))["theme"] == "light"


def test_conversation_control_v2_persists(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)
    before = client.get("/settings").json()

    response = client.patch(
        "/settings",
        json={
            "baseRevision": before["revision"],
            "changes": {"conversationControlV2": False},
        },
    )
    again = client.get("/settings").json()

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert again["conversationControlV2"] is False


def test_diagnostics_redacts_secrets(tmp_path: Path) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    client = TestClient(app)
    before = client.get("/settings").json()
    client.patch(
        "/settings",
        json={
            "baseRevision": before["revision"],
            "changes": {"openaiApiKey": "sk-secret", "anthropicApiKey": "ant-secret"},
        },
    )

    response = client.get("/settings/diagnostics")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["settingsPath"].endswith("settings.json")
    assert "sk-secret" not in json.dumps(body)
    assert "ant-secret" not in json.dumps(body)
    assert body["settingsRedacted"]["openaiApiKey"] == "***"
    assert body["settingsRedacted"]["anthropicApiKey"] == "***"
    assert body["effectiveSources"]["openaiApiKey"] == "settings_file"
    assert body["effectiveSources"]["anthropicApiKey"] == "settings_file"
    assert "orphanedSettings" in body


def test_diagnostics_reports_env_secret_source(tmp_path: Path, monkeypatch) -> None:
    settings_path = tmp_path / "settings.json"
    app.dependency_overrides[get_settings_service] = override_service(settings_path)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-only")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ant-env-only")
    client = TestClient(app)

    response = client.get("/settings/diagnostics")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["effectiveSources"]["openaiApiKey"] == "environment"
    assert body["effectiveSources"]["anthropicApiKey"] == "environment"
    assert body["settingsRedacted"]["openaiApiKey"] == ""
    assert "sk-env-only" not in json.dumps(body)
