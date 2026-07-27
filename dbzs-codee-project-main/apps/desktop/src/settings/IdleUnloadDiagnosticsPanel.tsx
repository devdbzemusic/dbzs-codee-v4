import { useEffect, useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  getIdleUnloadDiagnostics,
  type IdleUnloadDiagnostics,
} from "@/services/lazyRuntimePolicy";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms <= 0) return "jetzt fällig";
  const totalSec = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function statusLabel(status: IdleUnloadDiagnostics["effectiveStatus"]): string {
  switch (status) {
    case "disabled":
      return "Deaktiviert (0 Minuten)";
    case "blocked":
      return "Aktiver Run verhindert Unload";
    case "due":
      return "Unload fällig (Watcher prüft periodisch)";
    case "waiting":
      return "Aktiv · wartet auf Idle";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function IdleUnloadDiagnosticsPanel() {
  const minutes = useSettingsStore(
    (state) => state.settings.idleUnloadWorkModelsMinutes ?? 10,
  );
  const [snapshot, setSnapshot] = useState<IdleUnloadDiagnostics>(() =>
    getIdleUnloadDiagnostics(),
  );

  useEffect(() => {
    const refresh = () => setSnapshot(getIdleUnloadDiagnostics());
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [minutes]);

  return (
    <div className="border border-dbzs-border/70 bg-dbzs-panelSoft p-2 text-[10px] leading-4 text-dbzs-muted">
      <p className="text-[11px] font-medium uppercase tracking-wide text-dbzs-muted">
        Idle-Unload Diagnose
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <span>Status: <span className="text-dbzs-text">{statusLabel(snapshot.effectiveStatus)}</span></span>
        <span>
          Konfiguriert:{" "}
          <span className="text-dbzs-text">
            {snapshot.configuredMinutes === 0
              ? "aus"
              : `${snapshot.configuredMinutes} Min`}
          </span>
        </span>
        <span>
          Watcher:{" "}
          <span className="text-dbzs-text">
            {snapshot.watcherActive ? "aktiv" : "nicht gestartet"}
          </span>
        </span>
        <span>
          Letzte Arbeitsmodell-Aktivität:{" "}
          <span className="text-dbzs-text">
            {new Date(snapshot.lastActivityAt).toLocaleTimeString()}
          </span>
        </span>
        <span>
          Nächster möglicher Unload:{" "}
          <span className="text-dbzs-text">
            {snapshot.nextUnloadAt
              ? `${new Date(snapshot.nextUnloadAt).toLocaleTimeString()} (${formatDuration(snapshot.msUntilUnload)})`
              : "—"}
          </span>
        </span>
        <span>
          Aktiver Run blockiert:{" "}
          <span className="text-dbzs-text">
            {snapshot.blockedByActiveRun ? "ja" : "nein"}
          </span>
        </span>
      </div>
    </div>
  );
}
