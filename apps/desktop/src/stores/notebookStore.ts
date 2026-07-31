import { create } from "zustand";

export type NotebookTabId = "mission-control" | "cdee" | "runtime" | "jobs" | "agent-workbench" | "editor";

const STORAGE_KEY = "dbzs-operations-notebook-tab";

const NOTEBOOK_TABS: NotebookTabId[] = [
  "mission-control",
  "cdee",
  "runtime",
  "jobs",
  "agent-workbench",
  "editor"
];

function readPersistedTab(): NotebookTabId {
  if (typeof window === "undefined") {
    return "cdee";
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && NOTEBOOK_TABS.includes(raw as NotebookTabId)) {
      return raw as NotebookTabId;
    }
  } catch {
    // jsdom or restricted environments may block localStorage
  }
  return "cdee";
}

interface NotebookState {
  activeTab: NotebookTabId;
  runtimeFocusSlotId: string | null;
  setActiveTab: (tab: NotebookTabId) => void;
  focusEditorTab: () => void;
  focusRuntimeSlot: (slotId?: string | null) => void;
  clearRuntimeSlotFocus: () => void;
}

export const useNotebookStore = create<NotebookState>((set) => ({
  activeTab: readPersistedTab(),
  runtimeFocusSlotId: null,
  setActiveTab: (tab) => {
    set({ activeTab: tab });
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, tab);
      }
    } catch {
      // ignore persistence failures
    }
  },
  focusEditorTab: () => {
    set({ activeTab: "editor" });
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, "editor");
      }
    } catch {
      // ignore persistence failures
    }
  },
  focusRuntimeSlot: (slotId) => {
    set({ activeTab: "runtime", runtimeFocusSlotId: slotId?.trim() || null });
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, "runtime");
      }
    } catch {
      // ignore persistence failures
    }
  },
  clearRuntimeSlotFocus: () => {
    set({ runtimeFocusSlotId: null });
  }
}));

export const NOTEBOOK_TAB_LABELS: Record<NotebookTabId, string> = {
  "mission-control": "Mission Control",
  cdee: "C@dee",
  runtime: "Runtime",
  jobs: "Jobs",
  "agent-workbench": "Agent Workbench",
  editor: "Editor"
};
