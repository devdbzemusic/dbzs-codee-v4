import { create } from "zustand";

export type WorkbenchShellMode = "classic" | "neural-workbench";

export type WorkbenchRailItem =
  | "workspace"
  | "search"
  | "git"
  | "debug"
  | "chat"
  | "runtime"
  | "model-lab"
  | "jobs"
  | "agent-workbench"
  | "settings";

export type WorkbenchInspectorTab =
  | "context"
  | "trace"
  | "agents"
  | "debug-log"
  | "runtime"
  | "model"
  | "git"
  | "properties"
  | "diagnostics";

export type WorkbenchDockTab = "terminal" | "git" | "event-bus" | "problems" | "output" | "jobs" | "tests";

export type WorkbenchLayoutPreset =
  | "chat-focus"
  | "code-focus"
  | "review-focus"
  | "agent-ops"
  | "model-ops"
  | "minimal"
  | null;

const STORAGE_KEY = "dbzs-workbench-layout-v2";

const VALID_RAIL_ITEMS: WorkbenchRailItem[] = [
  "workspace", "search", "git", "debug", "chat", "runtime", "model-lab", "jobs", "agent-workbench", "settings"
];
const VALID_INSPECTOR_TABS: WorkbenchInspectorTab[] = [
  "context", "trace", "agents", "debug-log", "runtime", "model", "git", "properties", "diagnostics"
];
const VALID_DOCK_TABS: WorkbenchDockTab[] = ["terminal", "git", "event-bus", "problems", "output", "jobs", "tests"];

type PersistedLayout = Pick<
  WorkbenchLayoutState,
  | "shellMode"
  | "activeRailItem"
  | "activeInspectorTab"
  | "activeDockTab"
  | "leftSidebarWidth"
  | "inspectorWidth"
  | "bottomDockHeight"
  | "leftSidebarOpen"
  | "inspectorOpen"
  | "bottomDockOpen"
  | "activePresetId"
>;

function readPersistedLayout(): Partial<PersistedLayout> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>;
    return {
      shellMode: parsed.shellMode === "classic" ? "classic" : "neural-workbench",
      activeRailItem: VALID_RAIL_ITEMS.includes(parsed.activeRailItem as WorkbenchRailItem)
        ? parsed.activeRailItem
        : "workspace",
      activeInspectorTab: VALID_INSPECTOR_TABS.includes(parsed.activeInspectorTab as WorkbenchInspectorTab)
        ? parsed.activeInspectorTab
        : "agents",
      activeDockTab: VALID_DOCK_TABS.includes(parsed.activeDockTab as WorkbenchDockTab)
        ? parsed.activeDockTab
        : "terminal",
      leftSidebarWidth: typeof parsed.leftSidebarWidth === "number" ? parsed.leftSidebarWidth : 280,
      inspectorWidth: typeof parsed.inspectorWidth === "number" ? parsed.inspectorWidth : 320,
      bottomDockHeight: typeof parsed.bottomDockHeight === "number" ? parsed.bottomDockHeight : 200,
      leftSidebarOpen: typeof parsed.leftSidebarOpen === "boolean" ? parsed.leftSidebarOpen : true,
      inspectorOpen: typeof parsed.inspectorOpen === "boolean" ? parsed.inspectorOpen : false,
      bottomDockOpen: typeof parsed.bottomDockOpen === "boolean" ? parsed.bottomDockOpen : false,
      activePresetId: parsed.activePresetId ?? null
    };
  } catch {
    return {};
  }
}

function persistLayout(state: PersistedLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence cannot affect the available shell.
  }
}

export interface WorkbenchLayoutState {
  shellMode: WorkbenchShellMode;
  activeRailItem: WorkbenchRailItem;
  activeInspectorTab: WorkbenchInspectorTab;
  activeDockTab: WorkbenchDockTab;
  leftSidebarWidth: number;
  inspectorWidth: number;
  bottomDockHeight: number;
  leftSidebarOpen: boolean;
  inspectorOpen: boolean;
  bottomDockOpen: boolean;
  activePresetId: WorkbenchLayoutPreset;
  setShellMode: (shellMode: WorkbenchShellMode) => void;
  setActiveRailItem: (item: WorkbenchRailItem) => void;
  setActiveInspectorTab: (tab: WorkbenchInspectorTab) => void;
  setActiveDockTab: (tab: WorkbenchDockTab) => void;
  setLeftSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setBottomDockHeight: (height: number) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  toggleLeftSidebar: () => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setBottomDockOpen: (open: boolean) => void;
  toggleBottomDock: () => void;
  applyPreset: (presetId: WorkbenchLayoutPreset) => void;
}

const initialLayout = readPersistedLayout();

export const useWorkbenchLayoutStore = create<WorkbenchLayoutState>((set, get) => ({
  shellMode: initialLayout.shellMode ?? "neural-workbench",
  activeRailItem: initialLayout.activeRailItem ?? "workspace",
  activeInspectorTab: initialLayout.activeInspectorTab ?? "agents",
  activeDockTab: initialLayout.activeDockTab ?? "terminal",
  leftSidebarWidth: initialLayout.leftSidebarWidth ?? 280,
  inspectorWidth: initialLayout.inspectorWidth ?? 320,
  bottomDockHeight: initialLayout.bottomDockHeight ?? 200,
  leftSidebarOpen: initialLayout.leftSidebarOpen ?? true,
  inspectorOpen: initialLayout.inspectorOpen ?? false,
  bottomDockOpen: initialLayout.bottomDockOpen ?? false,
  activePresetId: initialLayout.activePresetId ?? null,

  setShellMode: (shellMode) => { set({ shellMode }); persistLayout(get()); },
  setActiveRailItem: (activeRailItem) => { set({ activeRailItem }); persistLayout(get()); },
  setActiveInspectorTab: (activeInspectorTab) => { set({ activeInspectorTab }); persistLayout(get()); },
  setActiveDockTab: (activeDockTab) => { set({ activeDockTab }); persistLayout(get()); },
  setLeftSidebarWidth: (leftSidebarWidth) => { set({ leftSidebarWidth }); persistLayout(get()); },
  setInspectorWidth: (inspectorWidth) => { set({ inspectorWidth }); persistLayout(get()); },
  setBottomDockHeight: (bottomDockHeight) => { set({ bottomDockHeight }); persistLayout(get()); },
  setLeftSidebarOpen: (leftSidebarOpen) => { set({ leftSidebarOpen }); persistLayout(get()); },
  toggleLeftSidebar: () => { set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })); persistLayout(get()); },
  setInspectorOpen: (inspectorOpen) => { set({ inspectorOpen }); persistLayout(get()); },
  toggleInspector: () => { set((s) => ({ inspectorOpen: !s.inspectorOpen })); persistLayout(get()); },
  setBottomDockOpen: (bottomDockOpen) => { set({ bottomDockOpen }); persistLayout(get()); },
  toggleBottomDock: () => { set((s) => ({ bottomDockOpen: !s.bottomDockOpen })); persistLayout(get()); },

  applyPreset: (presetId) => {
    const presets: Record<NonNullable<WorkbenchLayoutPreset>, Partial<WorkbenchLayoutState>> = {
      "chat-focus":    { leftSidebarOpen: true,  inspectorOpen: true,  bottomDockOpen: false, activeRailItem: "chat"      },
      "code-focus":    { leftSidebarOpen: true,  inspectorOpen: true,  bottomDockOpen: false, activeRailItem: "workspace" },
      "review-focus":  { leftSidebarOpen: false, inspectorOpen: true,  bottomDockOpen: false, activeRailItem: "git"       },
      "agent-ops":     { leftSidebarOpen: true,  inspectorOpen: true,  bottomDockOpen: true,  activeRailItem: "agent-workbench" },
      "model-ops":     { leftSidebarOpen: false, inspectorOpen: true,  bottomDockOpen: true,  activeRailItem: "runtime"   },
      "minimal":       { leftSidebarOpen: false, inspectorOpen: false, bottomDockOpen: false  }
    };
    if (presetId && presets[presetId]) {
      set({ ...presets[presetId], activePresetId: presetId });
      persistLayout(get());
    }
  }
}));
