interface Tab {
  id: string;
  label: string;
  badge?: number;
  disabled?: boolean;
}

interface TabStripProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

/** Horizontal tab strip for panel navigation. */
export function TabStrip({ tabs, activeTab, onTabChange, className = "" }: TabStripProps) {
  return (
    <div
      aria-label="Panel-Tabs"
      className={`flex shrink-0 overflow-x-auto border-b border-dbzs-border bg-dbzs-panelSoft ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          aria-disabled={tab.disabled}
          aria-selected={activeTab === tab.id}
          className={`relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-dbzs-cyan ${
            activeTab === tab.id
              ? "border-dbzs-cyan text-dbzs-text"
              : "border-transparent text-dbzs-muted hover:text-dbzs-text"
          } ${tab.disabled ? "pointer-events-none opacity-40" : ""}`}
          key={tab.id}
          onClick={() => !tab.disabled && onTabChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 ? (
            <span className="flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-dbzs-cyan/20 px-0.5 text-[9px] font-bold text-dbzs-cyan">
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
