export function SettingsPageHeader({ compact }: { compact?: boolean }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium text-dbzs-text">Settings Notebook</h3>
      <p className="mt-1 text-[11px] text-dbzs-muted">
        {compact
          ? "Alle Einstellungen mit Quelle, Dirty-Status und Persistenz."
          : "Tabbed Settings mit Registry, Patch-Persistenz und Diagnose der Speicherorte."}
      </p>
    </div>
  );
}
