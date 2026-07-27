interface SafeModeOverlayProps {
  error: {
    phase: string;
    message: string;
  };
}

export function SafeModeOverlay({ error }: SafeModeOverlayProps) {
  const handleRestart = () => {
    window.dbzs?.restartApp?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dbzs-bg/80 backdrop-blur-sm">
      <div className="max-w-md rounded-lg border border-dbzs-red/50 bg-dbzs-panel p-6 text-center shadow-lg">
        <h2 className="text-lg font-bold text-dbzs-red">Safe Mode Aktiv</h2>
        <p className="mt-2 text-sm text-dbzs-textSoft">
          Die Anwendung konnte nicht vollständig gestartet werden und läuft in einem eingeschränkten Modus.
        </p>
        <div className="mt-4 rounded border border-dbzs-border bg-dbzs-bg-secondary p-3 text-left text-xs">
          <p className="font-semibold">Fehler in Phase: <span className="font-mono text-dbzs-amber">{error.phase}</span></p>
          <p className="mt-1 font-mono text-dbzs-text">{error.message}</p>
        </div>
        <p className="mt-4 text-sm text-dbzs-textSoft">
          Bitte überprüfen Sie Ihre Einstellungen (z.B. Modellpfade) und starten Sie die Anwendung neu.
        </p>
        <button
          onClick={handleRestart}
          className="mt-6 rounded border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-4 py-2 text-sm font-medium text-dbzs-cyan hover:bg-dbzs-cyan/20"
        >
          Anwendung neu starten
        </button>
      </div>
    </div>
  );
}
