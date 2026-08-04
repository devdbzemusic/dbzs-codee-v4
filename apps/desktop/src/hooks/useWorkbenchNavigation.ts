import { useCallback } from "react";
import { useWorkbenchLayoutStore, type WorkbenchRailItem } from "@/stores/workbenchLayoutStore";

/** Maps each rail item to the keyboard shortcut digit (1–9, 0). */
const RAIL_SHORTCUTS: Record<WorkbenchRailItem, string> = {
  "workspace":       "1",
  "search":          "2",
  "git":             "3",
  "debug":           "4",
  "chat":            "5",
  "runtime":         "6",
  "model-lab":       "7",
  "jobs":            "8",
  "agent-workbench": "9",
  "settings":        "0"
};

/**
 * Workbench navigation controller.
 * Provides typed navigation helpers and keyboard shortcut metadata.
 */
export function useWorkbenchNavigation() {
  const { activeRailItem, setActiveRailItem } = useWorkbenchLayoutStore();

  const navigateTo = useCallback(
    (item: WorkbenchRailItem) => {
      setActiveRailItem(item);
    },
    [setActiveRailItem]
  );

  /** Returns the shortcut key for a given rail item (e.g. "1" for workspace). */
  const shortcutFor = useCallback((item: WorkbenchRailItem) => RAIL_SHORTCUTS[item], []);

  return {
    activeRailItem,
    navigateTo,
    shortcutFor,
    railShortcuts: RAIL_SHORTCUTS
  };
}
