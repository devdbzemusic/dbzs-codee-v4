import type { ReactNode, PointerEvent } from "react";
import { TabStrip } from "@/components/workbench/primitives/TabStrip";
import { SplitHandle } from "@/components/workbench/primitives/SplitHandle";
import type { WorkbenchDockTab } from "@/stores/workbenchLayoutStore";

const DOCK_TABS: { id: WorkbenchDockTab; label: string }[] = [
  { id: "terminal",  label: "Terminal"   },
  { id: "git",       label: "Git"        },
  { id: "event-bus", label: "Event Bus"  },
  { id: "problems",  label: "Problems"   },
  { id: "output",    label: "Output"     },
  { id: "jobs",      label: "Jobs"       },
  { id: "tests",     label: "Tests"      }
];

interface BottomDockProps {
  /** Content rendered for the active dock tab */
  children: ReactNode;
  /** Currently active dock tab */
  activeTab: WorkbenchDockTab;
  /** Called when the user selects a different tab */
  onTabChange: (tab: WorkbenchDockTab) => void;
  /** Badge counts per tab */
  badges?: Partial<Record<WorkbenchDockTab, number>>;
  /** Pixel height of the dock */
  height: number;
  /** Whether the dock is visible */
  open: boolean;
  /** Called to collapse the dock */
  onCollapse: () => void;
  /** Called when the user starts resizing */
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
}

/**
 * Bottom dock for terminal, event bus, problems, output, jobs and tests.
 * Height is resizable via a SplitHandle at the top.
 */
export function BottomDock({
  children,
  activeTab,
  onTabChange,
  badges = {},
  height,
  open,
  onCollapse,
  onResizeStart
}: BottomDockProps) {
  if (!open) {
    return null;
  }

  const tabs = DOCK_TABS.map((t) => ({ ...t, badge: badges[t.id] }));

  return (
    <>
      <SplitHandle direction="vertical" onResizeStart={onResizeStart} aria-label="Dock-Höhe anpassen" />
      <section
        aria-label="Bottom Dock"
        className="flex shrink-0 flex-col overflow-hidden border-t border-dbzs-border bg-dbzs-panel"
        style={{ height, minHeight: height, maxHeight: height }}
      >
        <div className="flex items-center justify-between border-b border-dbzs-border bg-dbzs-panelSoft pr-2">
          <TabStrip
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(id) => onTabChange(id as WorkbenchDockTab)}
            className="border-b-0"
          />
          <button
            aria-label="Dock einklappen"
            className="ml-auto grid h-5 w-5 shrink-0 place-items-center text-dbzs-muted hover:text-dbzs-text"
            onClick={onCollapse}
            type="button"
          >
            <svg fill="none" height="12" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="12">
              <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="panel-scroll flex-1 overflow-y-auto">
          {children}
        </div>
      </section>
    </>
  );
}
