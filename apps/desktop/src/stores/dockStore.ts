import { create } from "zustand";

export type DockTabId = "terminal" | "debug-console" | "output" | "git";

const TAB_STORAGE_KEY = "dbzs-bottom-dock-tab";
const MAXIMIZED_STORAGE_KEY = "dbzs-bottom-dock-maximized";

export const DOCK_TABS: DockTabId[] = ["terminal", "debug-console", "output", "git"];

function readPersistedTab(): DockTabId {
  if (typeof window === "undefined") {
    return "terminal";
  }
  try {
    const raw = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (raw && DOCK_TABS.includes(raw as DockTabId)) {
      return raw as DockTabId;
    }
  } catch {
    // jsdom or restricted environments may block localStorage
  }
  return "terminal";
}

function readPersistedMaximized(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(MAXIMIZED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface DockState {
  activeTab: DockTabId;
  maximized: boolean;
  setActiveTab: (tab: DockTabId) => void;
  setMaximized: (value: boolean) => void;
  toggleMaximized: () => void;
}

export const useDockStore = create<DockState>((set, get) => ({
  activeTab: readPersistedTab(),
  maximized: readPersistedMaximized(),
  setActiveTab: (tab) => {
    set({ activeTab: tab });
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TAB_STORAGE_KEY, tab);
      }
    } catch {
      // ignore persistence failures
    }
  },
  setMaximized: (value) => {
    set({ maximized: value });
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MAXIMIZED_STORAGE_KEY, value ? "1" : "0");
      }
    } catch {
      // ignore persistence failures
    }
  },
  toggleMaximized: () => {
    get().setMaximized(!get().maximized);
  }
}));

export const DOCK_TAB_LABELS: Record<DockTabId, string> = {
  terminal: "Terminal",
  "debug-console": "Debug Console",
  output: "Output",
  git: "Git"
};
