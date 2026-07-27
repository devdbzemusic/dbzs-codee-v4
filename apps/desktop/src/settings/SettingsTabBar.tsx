import type { SettingsCategory } from "./settingsRegistry";
import { SETTINGS_TABS } from "./settingsRegistry";

export function SettingsTabBar({
  active,
  onChange,
}: {
  active: SettingsCategory;
  onChange: (category: SettingsCategory) => void;
}) {
  return (
    <div
      aria-label="Settings-Kategorien"
      className="flex flex-wrap gap-1 border-b border-dbzs-border pb-2"
      role="tablist"
    >
      {SETTINGS_TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            aria-selected={selected}
            className={`border px-2 py-1 text-[11px] ${
              selected
                ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan"
                : "border-dbzs-border text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-text"
            }`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
