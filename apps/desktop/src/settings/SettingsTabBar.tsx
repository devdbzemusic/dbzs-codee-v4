import type { SettingsDisplayCategory } from "./settingsDisplay";
import { SETTINGS_DISPLAY_CATEGORIES } from "./settingsDisplay";

export function SettingsTabBar({
  active,
  counts,
  onChange,
}: {
  active: SettingsDisplayCategory;
  counts: Partial<Record<SettingsDisplayCategory, number>>;
  onChange: (category: SettingsDisplayCategory) => void;
}) {
  return (
    <div
      aria-label="Settings-Kategorien"
      className="grid gap-2 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
      role="tablist"
    >
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
        {SETTINGS_DISPLAY_CATEGORIES.map((tab) => {
          const selected = tab.id === active;
          const count = counts[tab.id] ?? 0;
          return (
            <button
              aria-selected={selected}
              className={`border px-3 py-2 text-left text-[11px] ${
                selected
                  ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan"
                  : "border-dbzs-border bg-dbzs-panel text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-text"
              }`}
              key={tab.id}
              onClick={() => onChange(tab.id)}
              role="tab"
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{tab.label}</span>
                <span className="text-[10px] uppercase tracking-[0.12em] opacity-70">{count}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-[10px] leading-4 opacity-80">{tab.description}</div>
            </button>
          );
        })}
      </div>
      <div className="hidden rounded border border-dbzs-border bg-dbzs-bg px-3 py-2 text-[11px] text-dbzs-muted lg:block">
        {SETTINGS_DISPLAY_CATEGORIES.find((tab) => tab.id === active)?.description}
      </div>
    </div>
  );
}
