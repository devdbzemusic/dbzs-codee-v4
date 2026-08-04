import { WorkbenchStatusBadge, type UiStatusTone } from "@/components/workbench/WorkbenchStatusBadge";
import type { WorkbenchStatusItem } from "@/hooks/useWorkbenchStatus";

interface WorkbenchStatusBarProps {
  items: WorkbenchStatusItem[];
  workspaceLabel: string;
}

/** Neural Workbench status bar — bottom strip with semantic badges and workspace label. */
export function WorkbenchStatusBar({ items, workspaceLabel }: WorkbenchStatusBarProps) {
  return (
    <footer className="dbzs-workbench__status" role="status" aria-label="System-Status">
      <div className="dbzs-workbench__status-items">
        {items.map((item) => (
          <WorkbenchStatusBadge
            key={item.label}
            label={item.label}
            tone={item.tone as UiStatusTone}
            value={item.value}
            title={item.tooltip}
          />
        ))}
      </div>
      <span className="dbzs-workbench__status-label" aria-label="Aktiver Workspace">
        {workspaceLabel}
      </span>
    </footer>
  );
}
