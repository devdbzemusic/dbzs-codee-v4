export function SettingsSearch({
  value,
  onChange,
  onNavigate,
  hits,
}: {
  value: string;
  onChange: (value: string) => void;
  onNavigate: (key: string) => void;
  hits: Array<{ key: string; label: string; category: string }>;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-dbzs-muted">
        Settings suchen
        <input
          className="mt-2 w-full border border-dbzs-border bg-dbzs-panel px-3 py-2 text-dbzs-text"
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="z. B. Idle-Unload, RAG, API Key…"
          type="search"
          value={value}
        />
      </label>
      {value.trim() && hits.length > 0 ? (
        <ul className="mt-2 max-h-28 overflow-auto border border-dbzs-border/70 bg-dbzs-panelSoft text-[11px]">
          {hits.slice(0, 8).map((hit) => (
            <li key={hit.key}>
              <button
                className="w-full px-2 py-1 text-left text-dbzs-muted hover:bg-dbzs-panel hover:text-dbzs-cyan"
                onClick={() => onNavigate(hit.key)}
                type="button"
              >
                <span className="text-dbzs-text">{hit.label}</span>
                <span className="ml-2 text-[10px] opacity-70">
                  {hit.category} · {hit.key}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
