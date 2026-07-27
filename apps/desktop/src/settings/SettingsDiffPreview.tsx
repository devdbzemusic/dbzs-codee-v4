import type { SettingsDiffEntry } from "./settingsTransfer";
import { formatDiffValue } from "./settingsTransfer";

export function SettingsDiffPreview({
  title,
  diff,
  errors = [],
  fieldErrors = {},
  onCancel,
  onConfirm,
  confirmLabel = "Übernehmen",
  busy = false,
}: {
  title: string;
  diff: SettingsDiffEntry[];
  errors?: string[];
  fieldErrors?: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const canConfirm = diff.length > 0 && !hasFieldErrors && !busy;

  return (
    <div className="border border-dbzs-cyan/40 bg-dbzs-panelSoft p-3 text-xs text-dbzs-muted">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-dbzs-cyan">{title}</h4>
      {errors.length > 0 ? (
        <ul className="mt-2 space-y-1 text-dbzs-amber">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      {hasFieldErrors ? (
        <ul className="mt-2 space-y-1 text-dbzs-red">
          {Object.entries(fieldErrors).map(([key, message]) => (
            <li key={key}>
              {key}: {message}
            </li>
          ))}
        </ul>
      ) : null}
      {diff.length === 0 ? (
        <p className="mt-2">Keine Änderungen.</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-2 overflow-auto">
          {diff.map((entry) => (
            <li className="border border-dbzs-border/60 bg-dbzs-bg px-2 py-1.5" key={String(entry.key)}>
              <div className="font-medium text-dbzs-text">{entry.label}</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <span>
                  Aktuell:{" "}
                  <span className="break-all text-dbzs-muted">{formatDiffValue(entry.from)}</span>
                </span>
                <span>
                  Neu: <span className="break-all text-dbzs-cyan">{formatDiffValue(entry.to)}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="border border-dbzs-border px-3 py-1 text-dbzs-muted hover:border-dbzs-cyan/40"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Abbrechen
        </button>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1 text-dbzs-cyan disabled:opacity-50"
          disabled={!canConfirm}
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Übernehme…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}
