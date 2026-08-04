import type { ReactNode } from "react";
import { PanelHeader } from "@/components/workbench/primitives/PanelPrimitives";
import { SplitHandle } from "@/components/workbench/primitives/SplitHandle";
import type { PointerEvent } from "react";

interface WorkspaceSidebarProps {
  /** Content of the sidebar (WorkspaceExplorer, search results, etc.) */
  children: ReactNode;
  /** Panel title displayed in the header */
  title?: string;
  /** Pixel width of the sidebar */
  width: number;
  /** Whether the sidebar is currently visible */
  open: boolean;
  /** Called when the user clicks the collapse chevron */
  onCollapse: () => void;
  /** Called when the user starts resizing (pointerdown on the split handle) */
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
}

/**
 * Left sidebar panel of the Neural Workbench.
 * Hosts explorer, search, git views etc. depending on the active rail item.
 */
export function WorkspaceSidebar({
  children,
  title = "Workspace",
  width,
  open,
  onCollapse,
  onResizeStart
}: WorkspaceSidebarProps) {
  if (!open) {
    return null;
  }

  return (
    <>
      <aside
        aria-label={title}
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-dbzs-border bg-dbzs-panel"
        style={{ width, minWidth: width, maxWidth: width }}
      >
        <PanelHeader title={title} onCollapse={onCollapse} />
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </aside>
      <SplitHandle direction="horizontal" onResizeStart={onResizeStart} aria-label="Linke Leiste verbreitern" />
    </>
  );
}
