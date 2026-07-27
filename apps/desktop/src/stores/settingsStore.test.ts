import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSettingsStore } from "./settingsStore";

beforeEach(() => {
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    settingsRevision: 0,
    roleModelConfiguredAt: null,
    backendHealth: null,
    backendStartupStatus: null,
    diagnostics: null,
    isLoading: false,
    error: null
  });

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn().mockResolvedValue({
      status: "ok",
      app: "DBZS Code Assistant",
      version: "0.1.0"
    }),
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockImplementation(async (settings) => settings),
    patchSettings: vi.fn().mockImplementation(async (request) => ({
      settings: { ...DEFAULT_SETTINGS, ...request.changes, revision: (DEFAULT_SETTINGS.revision ?? 0) + 1 },
      revision: (DEFAULT_SETTINGS.revision ?? 0) + 1,
      appliedKeys: Object.keys(request.changes),
      restartRequirements: {}
    })),
    getSettingsDiagnostics: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      revision: 0,
      settingsPath: "C:/tmp/settings.json",
      appDataDir: "C:/tmp",
      modelsDir: "D:/Models",
      loadedAt: new Date().toISOString(),
      validationErrors: [],
      orphanedSettings: [],
      hiddenUserTunableSettings: [],
      hardcodedRuntimeValues: [],
      effectiveSources: {}
    }),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    getModelIndex: vi.fn(),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgentLogs: vi.fn().mockResolvedValue([]),
    listProjectMemory: vi.fn().mockResolvedValue([]),
    upsertProjectMemory: vi.fn(),
    deleteProjectMemory: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn()
  };
});

describe("useSettingsStore", () => {
  it("loads backend health and settings through the preload bridge", async () => {
    await useSettingsStore.getState().loadInitialState();

    expect(useSettingsStore.getState().backendHealth?.status).toBe("ok");
    expect(useSettingsStore.getState().settings.telemetryEnabled).toBe(false);
  });

  it("persists settings through the backend bridge", async () => {
    const saved = await useSettingsStore.getState().updateSettings({
      ...DEFAULT_SETTINGS,
      autoSave: false,
      terminalShell: "pwsh"
    });

    expect(saved).toBe(true);
    expect(window.dbzs.updateSettings).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settings.autoSave).toBe(false);
    expect(useSettingsStore.getState().settings.terminalShell).toBe("pwsh");
  });

  it("reports persistence failures without replacing the current settings", async () => {
    vi.mocked(window.dbzs.updateSettings).mockRejectedValueOnce(new Error("Speichern fehlgeschlagen"));

    const saved = await useSettingsStore.getState().updateSettings({
      ...DEFAULT_SETTINGS,
      autoSave: false
    });

    expect(saved).toBe(false);
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(useSettingsStore.getState().error).toBe("Speichern fehlgeschlagen");
    expect(useSettingsStore.getState().isLoading).toBe(false);
  });

  it("stores backend startup failures in error state", () => {
    useSettingsStore.getState().setBackendStartupStatus({
      state: "failed",
      message: "uv/python nicht gefunden",
      port: 8876,
      ownership: "spawned-by-desktop",
      instanceId: null
    });

    expect(useSettingsStore.getState().backendStartupStatus?.state).toBe("failed");
    expect(useSettingsStore.getState().error).toContain("uv/python");
  });

  it("patches settings through the backend bridge", async () => {
    const saved = await useSettingsStore.getState().patchSettings({
      idleUnloadWorkModelsMinutes: 0
    });

    expect(saved).toBe(true);
    expect(window.dbzs.patchSettings).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settings.idleUnloadWorkModelsMinutes).toBe(0);
    expect(useSettingsStore.getState().settingsRevision).toBe(1);
  });

  it("marks utility model changes as role-model updates", async () => {
    const saved = await useSettingsStore.getState().patchSettings({
      defaultUtilityModelId: "utility-model-id"
    });

    expect(saved).toBe(true);
    expect(useSettingsStore.getState().settings.defaultUtilityModelId).toBe("utility-model-id");
    expect(useSettingsStore.getState().roleModelConfiguredAt).toBeTruthy();
  });
});
