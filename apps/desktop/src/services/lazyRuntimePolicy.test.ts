import { afterEach, describe, expect, it } from "vitest";
import {
  formatLazyRuntimeStatusLabel,
  getIdleUnloadDiagnostics,
  isWorkModelLoaded,
  looksLikeOrchestratorModel,
  registerIdleEvictionActiveRunGuard,
  stopWorkModelIdleWatcherForTests,
  touchWorkModelActivity
} from "./lazyRuntimePolicy";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";

describe("lazyRuntimePolicy", () => {
  afterEach(() => {
    stopWorkModelIdleWatcherForTests();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  });
  it("treats FunctionGemma as orchestrator, not work model", () => {
    expect(
      looksLikeOrchestratorModel({
        model_id: "functiongemma-270m-it.Q8_0",
        model_name: "FunctionGemma"
      })
    ).toBe(true);
    expect(
      isWorkModelLoaded({
        state: "running",
        provider: "llama.cpp",
        model_id: "functiongemma-270m-it.Q8_0",
        model_name: "FunctionGemma",
        port: 8084,
        pid: 1,
        endpoint: "http://127.0.0.1:8084",
        message: ""
      })
    ).toBe(false);
  });

  it("shows Arbeitsmodell nicht geladen before first start", () => {
    expect(
      formatLazyRuntimeStatusLabel({
        backendReachable: true,
        workModelLoaded: false
      })
    ).toContain("Arbeitsmodell: nicht geladen");
  });

  it("defaults autoStart work runtimes to false", () => {
    expect(DEFAULT_SETTINGS.autoStartChatRuntime).toBe(false);
    expect(DEFAULT_SETTINGS.autoStartCodingRuntime).toBe(false);
    expect(DEFAULT_SETTINGS.autoStartVisionRuntime).toBe(false);
    expect(DEFAULT_SETTINGS.autoStartReviewRuntime).toBe(false);
    expect(DEFAULT_SETTINGS.idleUnloadWorkModelsMinutes).toBe(10);
  });

  it("reports disabled idle-unload diagnostics when minutes are 0", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, idleUnloadWorkModelsMinutes: 0 },
    });
    const diag = getIdleUnloadDiagnostics();
    expect(diag.enabled).toBe(false);
    expect(diag.effectiveStatus).toBe("disabled");
    expect(diag.nextUnloadAt).toBeNull();
  });

  it("reports blocked status when an active run guard is set", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, idleUnloadWorkModelsMinutes: 10 },
    });
    touchWorkModelActivity();
    registerIdleEvictionActiveRunGuard(() => true);
    const diag = getIdleUnloadDiagnostics();
    expect(diag.blockedByActiveRun).toBe(true);
    expect(diag.effectiveStatus).toBe("blocked");
  });
});
