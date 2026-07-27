export function SettingsFooter({
  dirtyCount,
  saving,
  error,
  backendReady,
  onDiscard,
  onSave,
  onRetry,
}: {
  dirtyCount: number;
  saving: boolean;
  error: string | null;
  backendReady: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onRetry: () => void;
}) {
  if (dirtyCount === 0 && !error) {
    return null;
  }

  return (
    <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border border-dbzs-border bg-dbzs-panelSoft px-3 py-2">
      <div className="text-[11px] text-dbzs-muted">
        {dirtyCount > 0 ? (
          <span>
            {dirtyCount} ungespeicherte Änderung{dirtyCount === 1 ? "" : "en"}
          </span>
        ) : (
          <span>Keine offenen Änderungen</span>
        )}
        {error ? <span className="ml-2 text-dbzs-red">{error}</span> : null}
        {!backendReady ? (
          <span className="ml-2 text-dbzs-amber">
            Backend offline: Änderungen werden lokal vorgemerkt, Speichern erst nach Wiederverbindung.
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        {!backendReady ? (
          <button
            className="border border-dbzs-amber/40 bg-dbzs-amber/10 px-3 py-1 text-xs text-dbzs-amber hover:border-dbzs-amber disabled:opacity-50"
            disabled={saving}
            onClick={onRetry}
            type="button"
          >
            Backend prüfen
          </button>
        ) : null}
        <button
          className="border border-dbzs-border px-3 py-1 text-xs text-dbzs-muted hover:border-dbzs-cyan/40 disabled:opacity-50"
          disabled={dirtyCount === 0 || saving}
          onClick={onDiscard}
          type="button"
        >
          Verwerfen
        </button>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1 text-xs text-dbzs-cyan hover:border-dbzs-cyan disabled:opacity-50"
          disabled={dirtyCount === 0 || saving || !backendReady}
          onClick={onSave}
          type="button"
        >
          {saving ? "Speichern…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
