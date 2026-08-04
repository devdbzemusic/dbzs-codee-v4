import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_LAYOUT_PRESET_LABELS,
  WORKBENCH_LAYOUT_PRESET_ORDER,
  useWorkbenchLayoutStore
} from "./workbenchLayoutStore";

const STORAGE_KEY = "dbzs-workbench-layout-v2";

describe("workbenchLayoutStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkbenchLayoutStore.setState({
      shellMode: "neural-workbench",
      activeRailItem: "workspace",
      activeInspectorTab: "agents",
      activeDockTab: "terminal",
      leftSidebarWidth: 280,
      inspectorWidth: 320,
      bottomDockHeight: 200,
      leftSidebarOpen: true,
      inspectorOpen: false,
      bottomDockOpen: false,
      activePresetId: null
    });
  });

  it("defaults to the neural workbench and keeps the classic shell available", () => {
    expect(useWorkbenchLayoutStore.getState().shellMode).toBe("neural-workbench");

    useWorkbenchLayoutStore.getState().setShellMode("classic");

    expect(useWorkbenchLayoutStore.getState().shellMode).toBe("classic");
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"shellMode":"classic"');
  });

  it("tracks presentation-only navigation state", () => {
    const store = useWorkbenchLayoutStore.getState();
    store.setActiveRailItem("debug");
    store.setActiveInspectorTab("debug-log");
    store.setActiveDockTab("git");

    expect(useWorkbenchLayoutStore.getState()).toMatchObject({
      activeRailItem: "debug",
      activeInspectorTab: "debug-log",
      activeDockTab: "git"
    });
  });

  it("persists panel dimensions and collapse state", () => {
    const store = useWorkbenchLayoutStore.getState();
    store.setLeftSidebarWidth(350);
    store.setInspectorWidth(400);
    store.setBottomDockHeight(250);
    store.toggleInspector();
    store.toggleBottomDock();

    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(saved.leftSidebarWidth).toBe(350);
    expect(saved.inspectorWidth).toBe(400);
    expect(saved.bottomDockHeight).toBe(250);
    expect(saved.inspectorOpen).toBe(true);
    expect(saved.bottomDockOpen).toBe(true);
  });

  it("applies layout presets correctly", () => {
    useWorkbenchLayoutStore.getState().applyPreset("chat-focus");

    expect(useWorkbenchLayoutStore.getState()).toMatchObject({
      activePresetId: "chat-focus",
      leftSidebarOpen: true,
      inspectorOpen: true,
      bottomDockOpen: false,
      activeRailItem: "chat",
      activeInspectorTab: "context"
    });
  });

  it("cycles through all persisted focus presets in order", () => {
    const store = useWorkbenchLayoutStore.getState();

    for (const expectedPreset of WORKBENCH_LAYOUT_PRESET_ORDER) {
      store.cyclePreset();
      expect(useWorkbenchLayoutStore.getState().activePresetId).toBe(expectedPreset);
      expect(WORKBENCH_LAYOUT_PRESET_LABELS[expectedPreset].length).toBeGreaterThan(0);
    }
  });

  it("hydrates a persisted preset and sanitized layout fields on module load", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        shellMode: "classic",
        activeRailItem: "model-lab",
        activeInspectorTab: "model",
        activeDockTab: "jobs",
        leftSidebarWidth: 360,
        inspectorWidth: 410,
        bottomDockHeight: 260,
        leftSidebarOpen: false,
        inspectorOpen: true,
        bottomDockOpen: true,
        activePresetId: "model-ops"
      })
    );
    vi.resetModules();

    const { useWorkbenchLayoutStore: hydratedStore } = await import("./workbenchLayoutStore");

    expect(hydratedStore.getState()).toMatchObject({
      shellMode: "classic",
      activeRailItem: "model-lab",
      activeInspectorTab: "model",
      activeDockTab: "jobs",
      leftSidebarWidth: 360,
      inspectorWidth: 410,
      bottomDockHeight: 260,
      leftSidebarOpen: false,
      inspectorOpen: true,
      bottomDockOpen: true,
      activePresetId: "model-ops"
    });
  });

  it("ignores invalid persisted values and falls back to safe defaults", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        shellMode: "bad",
        activeRailItem: "unknown",
        activeInspectorTab: "broken",
        activeDockTab: "invalid",
        activePresetId: "missing"
      })
    );
    vi.resetModules();

    const { useWorkbenchLayoutStore: hydratedStore } = await import("./workbenchLayoutStore");

    expect(hydratedStore.getState()).toMatchObject({
      shellMode: "neural-workbench",
      activeRailItem: "workspace",
      activeInspectorTab: "agents",
      activeDockTab: "terminal",
      activePresetId: null
    });
  });
});
