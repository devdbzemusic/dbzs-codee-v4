import type { WorkbenchRailItem } from "@/stores/workbenchLayoutStore";

/** Navigation Registry — single source of truth for all rail entries. */
export interface RailEntry {
  id: WorkbenchRailItem;
  label: string;
  /** Single-character monogram rendered as the icon */
  glyph: string;
  /** Keyboard shortcut digit (shown in tooltip, handled by parent) */
  shortcut: string;
  /** Whether this entry is in the primary group (top) or settings (bottom) */
  group: "primary" | "settings";
}

export const RAIL_REGISTRY: RailEntry[] = [
  { id: "workspace",       label: "Explorer",        glyph: "E",  shortcut: "1", group: "primary"  },
  { id: "search",          label: "Search",          glyph: "S",  shortcut: "2", group: "primary"  },
  { id: "git",             label: "Git",             glyph: "G",  shortcut: "3", group: "primary"  },
  { id: "debug",           label: "Debug",           glyph: "D",  shortcut: "4", group: "primary"  },
  { id: "chat",            label: "Chat",            glyph: "C",  shortcut: "5", group: "primary"  },
  { id: "runtime",         label: "Runtime",         glyph: "R",  shortcut: "6", group: "primary"  },
  { id: "model-lab",       label: "Model Lab",       glyph: "M",  shortcut: "7", group: "primary"  },
  { id: "jobs",            label: "Jobs",            glyph: "J",  shortcut: "8", group: "primary"  },
  { id: "agent-workbench", label: "Agents",          glyph: "A",  shortcut: "9", group: "primary"  },
  { id: "settings",        label: "Einstellungen",   glyph: "⚙",  shortcut: "0", group: "settings" }
];

const PRIMARY_ITEMS  = RAIL_REGISTRY.filter((e) => e.group === "primary");
const SETTINGS_ITEMS = RAIL_REGISTRY.filter((e) => e.group === "settings");

interface RailButtonProps {
  entry: RailEntry;
  active: boolean;
  badge?: number;
  onSelect: (id: WorkbenchRailItem) => void;
}

function RailButton({ entry, active, badge, onSelect }: RailButtonProps) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={`${entry.label} (Ctrl+${entry.shortcut})`}
      className="dbzs-workbench__rail-button"
      data-shortcut={entry.shortcut}
      key={entry.id}
      onClick={() => onSelect(entry.id)}
      title={`${entry.label}  Ctrl+${entry.shortcut}`}
      type="button"
    >
      <span aria-hidden="true">{entry.glyph}</span>
      <span>{entry.label}</span>
      {badge != null && badge > 0 ? (
        <span
          aria-label={`${badge} Einträge`}
          className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-dbzs-cyan px-0.5 text-[9px] font-bold text-dbzs-bg"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

interface ActivityRailProps {
  activeItem: WorkbenchRailItem;
  onSelect: (item: WorkbenchRailItem) => void;
  branchLabel: string;
  /** Optional badge counts per rail item */
  badges?: Partial<Record<WorkbenchRailItem, number>>;
}

export function ActivityRail({ activeItem, onSelect, branchLabel, badges = {} }: ActivityRailProps) {
  return (
    <nav className="dbzs-workbench__rail" aria-label="Workbench-Navigation">
      <div className="dbzs-workbench__rail-nav">
        {PRIMARY_ITEMS.map((entry) => (
          <RailButton
            key={entry.id}
            entry={entry}
            active={activeItem === entry.id}
            badge={badges[entry.id]}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div className="dbzs-workbench__rail-footer">
        {SETTINGS_ITEMS.map((entry) => (
          <RailButton
            key={entry.id}
            entry={entry}
            active={activeItem === entry.id}
            badge={badges[entry.id]}
            onSelect={onSelect}
          />
        ))}
        <div
          className="mt-1 truncate px-2 text-center text-[9px] text-dbzs-muted"
          title={`Branch: ${branchLabel}`}
        >
          {branchLabel}
        </div>
      </div>
    </nav>
  );
}
