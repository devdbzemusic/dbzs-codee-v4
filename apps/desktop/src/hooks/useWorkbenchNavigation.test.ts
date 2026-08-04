import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkbenchNavigation } from "./useWorkbenchNavigation";
import { useWorkbenchLayoutStore } from "@/stores/workbenchLayoutStore";
import { RAIL_REGISTRY } from "@/components/workbench/ActivityRail";

describe("useWorkbenchNavigation", () => {
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

  it("navigates through the shared rail registry and persists the active item", () => {
    const { result } = renderHook(() => useWorkbenchNavigation());

    act(() => {
      result.current.navigateTo("model-lab");
    });

    expect(result.current.activeRailItem).toBe("model-lab");
    expect(result.current.shortcutFor("settings")).toBe("0");
    expect(result.current.railShortcuts.chat).toBe("5");
    expect(window.localStorage.getItem("dbzs-workbench-layout-v2")).toContain("\"activeRailItem\":\"model-lab\"");
  });

  it("stays aligned with the activity rail navigation registry", () => {
    const { result } = renderHook(() => useWorkbenchNavigation());

    expect(
      RAIL_REGISTRY.map((entry) => [entry.id, entry.shortcut])
    ).toEqual(
      Object.entries(result.current.railShortcuts)
    );
  });
});
