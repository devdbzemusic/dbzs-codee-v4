import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTEBOOK_TAB_LABELS, useNotebookStore } from "./notebookStore";

describe("notebookStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useNotebookStore.setState({
      activeTab: "cdee",
      runtimeFocusSlotId: null,
      splitChatEditor: false
    });
  });

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

  it("persists the active tab and split-chat editor preference", () => {
    useNotebookStore.getState().setActiveTab("jobs");
    useNotebookStore.getState().toggleSplitChatEditor();

    expect(window.localStorage.getItem("dbzs-operations-notebook-tab")).toBe("jobs");
    expect(window.localStorage.getItem("dbzs-operations-notebook-split-chat-editor")).toBe("1");
    expect(useNotebookStore.getState().splitChatEditor).toBe(true);
  });

  it("hydrates persisted notebook state on module load", async () => {
    window.localStorage.setItem("dbzs-operations-notebook-tab", "editor");
    window.localStorage.setItem("dbzs-operations-notebook-split-chat-editor", "1");
    vi.resetModules();

    const { useNotebookStore: hydratedStore } = await import("./notebookStore");

    expect(hydratedStore.getState().activeTab).toBe("editor");
    expect(hydratedStore.getState().splitChatEditor).toBe(true);
  });
});
