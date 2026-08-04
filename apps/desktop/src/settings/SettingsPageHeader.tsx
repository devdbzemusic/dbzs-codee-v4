export function SettingsPageHeader({ compact }: { compact?: boolean }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium text-dbzs-text">Settings Workspace</h3>
      <p className="mt-1 text-[11px] text-dbzs-muted">
        {compact
          ? "Kategorisierte Konfiguration mit Suche, Quellenstatus und sicheren Patch-Saves."
          : "Planbasierte Settings-Refactor-Ansicht mit Suche, Kategorien, Diff-Persistenz und Diagnosen."}
      </p>
    </div>
  );
}
