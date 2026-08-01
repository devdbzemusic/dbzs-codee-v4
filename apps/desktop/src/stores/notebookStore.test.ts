import { describe, expect, it } from "vitest";
import { NOTEBOOK_TAB_LABELS, useNotebookStore } from "./notebookStore";

describe("notebookStore", () => {
  it("defaults to mission-control", () => {
    useNotebookStore.setState({ activeTab: "mission-control" });
    expect(useNotebookStore.getState().activeTab).toBe("mission-control");
  });

  it("switches tabs and exposes labels for all notebook tabs", () => {
    useNotebookStore.getState().setActiveTab("editor");
    expect(useNotebookStore.getState().activeTab).toBe("editor");

    expect(Object.keys(NOTEBOOK_TAB_LABELS)).toEqual([
      "mission-control",
      "cdee",
      "runtime",
      "model-lab",
      "jobs",
      "agent-workbench",
      "editor"
    ]);
  });

  it("focusEditorTab selects editor tab", () => {
    useNotebookStore.getState().setActiveTab("cdee");
    useNotebookStore.getState().focusEditorTab();
    expect(useNotebookStore.getState().activeTab).toBe("editor");
  });

  it("focusRuntimeSlot selects runtime tab and stores the target slot", () => {
    useNotebookStore.getState().setActiveTab("cdee");
    useNotebookStore.getState().focusRuntimeSlot("fast_gpu");

    expect(useNotebookStore.getState().activeTab).toBe("runtime");
    expect(useNotebookStore.getState().runtimeFocusSlotId).toBe("fast_gpu");

    useNotebookStore.getState().clearRuntimeSlotFocus();
    expect(useNotebookStore.getState().runtimeFocusSlotId).toBeNull();
  });
});
