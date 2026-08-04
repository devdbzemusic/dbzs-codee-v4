import type { ReactNode, PointerEvent } from "react";
import { TabStrip } from "@/components/workbench/primitives/TabStrip";
import { SplitHandle } from "@/components/workbench/primitives/SplitHandle";
import type { WorkbenchInspectorTab } from "@/stores/workbenchLayoutStore";

const INSPECTOR_TABS: { id: WorkbenchInspectorTab; label: string }[] = [
  { id: "context",     label: "Context"     },
  { id: "agents",      label: "Agents"      },
  { id: "trace",       label: "Trace"       },
  { id: "runtime",     label: "Runtime"     },
  { id: "model",       label: "Model"       },
  { id: "git",         label: "Git"         },
  { id: "debug-log",   label: "Debug Log"   },
  { id: "properties",  label: "Properties"  },
  { id: "diagnostics", label: "Diagnostics" }
];

interface InspectorSidebarProps {
  /** Content rendered for the active tab */
  children: ReactNode;
  /** Currently active inspector tab */
  activeTab: WorkbenchInspectorTab;
  /** Called when the user selects a different tab */
  onTabChange: (tab: WorkbenchInspectorTab) => void;
  /** Pixel width of the inspector */
  width: number;
  /** Whether the inspector is visible */
  open: boolean;
  /** Called when the user collapses the inspector */
  onCollapse: () => void;
  /** Called when the user starts resizing */
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
}

/**
 * Right inspector sidebar.
 * Context-aware detail panel with tabbed navigation.
 */
export function InspectorSidebar({
  children,
  activeTab,
  onTabChange,
  width,
  open,
  onCollapse,
  onResizeStart
}: InspectorSidebarProps) {
  if (!open) {
    return null;
  }

  return (
    <>
      <SplitHandle direction="horizontal" onResizeStart={onResizeStart} aria-label="Inspector verbreitern" />
      <aside
        aria-label="Inspector"
        className="flex min-h-0 flex-col overflow-hidden border-l border-dbzs-border bg-dbzs-panel"
        style={{ width, minWidth: width, maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-dbzs-border bg-dbzs-panelSoft px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-dbzs-muted">Inspector</span>
          <button
            aria-label="Inspector einklappen"
            className="grid h-5 w-5 place-items-center text-dbzs-muted hover:text-dbzs-text"
            onClick={onCollapse}
            type="button"
          >
            <svg fill="none" height="12" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="12">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <TabStrip
          tabs={INSPECTOR_TABS}
          activeTab={activeTab}
          onTabChange={(id) => onTabChange(id as WorkbenchInspectorTab)}
        />
        <div className="panel-scroll flex-1 overflow-y-auto">
          {children}
        </div>
      </aside>
    </>
  );
}
