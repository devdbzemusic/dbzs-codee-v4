import { useEffect, useState } from "react";
import type { BackupSummary, RagIndexStatus } from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ragClient } from "@/services/ragClient";

export function DiagnosticsStorageTab() {
  const { diagnostics, loadDiagnostics, settings, isLoading, setError, loadInitialState } =
    useSettingsStore();
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const { resetWorkspace, state: workspaceState } = useWorkspaceStore();
  const [ragStatus, setRagStatus] = useState<RagIndexStatus | null>(null);
  const [ragBusy, setRagBusy] = useState(false);
  const backendReady = backendHealth?.status === "ok";
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!backendReady) {
      return;
    }
    void loadDiagnostics();
  }, [backendReady, loadDiagnostics]);

  useEffect(() => {
    const root = workspaceState.projectPath;
    const id = root ? ragClient.workspaceId(root) : null;
    if (!id) {
      setRagStatus(null);
      return;
    }
    void ragClient
      .status(id)
      .then(setRagStatus)
      .catch(() => setRagStatus(null));
  }, [workspaceState.projectPath]);

  const loadBackups = async () => {
    const list = window.dbzs.listBackups;
    if (!list) return;
    try {
      setBackups(await list());
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Backups konnten nicht geladen werden.");
    }
  };

  useEffect(() => {
    void loadBackups();
  }, []);

  const createBackupNow = async () => {
    const create = window.dbzs.createBackup;
    if (!create) return;
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      const summary = await create();
      setBackupMessage(`Backup erstellt (${summary.fileCount} Dateien).`);
      await loadBackups();
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Backup fehlgeschlagen.");
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async (backupId: string) => {
    const restore = window.dbzs.restoreBackup;
    if (!restore) return;
    if (!window.confirm("Backup wiederherstellen? Der aktuelle Stand wird vorher zusätzlich gesichert.")) {
      return;
    }
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      const result = await restore(backupId);
      setBackupMessage(
        result.errors.length > 0
          ? `Wiederhergestellt mit Fehlern: ${result.errors.join("; ")}`
          : `${result.restoredFiles.length} Dateien wiederhergestellt. Neustart empfohlen.`
      );
      await loadBackups();
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Wiederherstellung fehlgeschlagen.");
    } finally {
      setBackupBusy(false);
    }
  };

  const openBackupsFolder = async () => {
    const open = window.dbzs.openBackupsFolder;
    if (!open) return;
    await open();
  };

  const reloadBackend = async () => {
    try {
      setError(null);
      const reload = window.dbzs.reloadBackend;
      if (!reload) {
        throw new Error("reloadBackend is unavailable.");
      }
      await reload();
      await loadInitialState();
      await loadDiagnostics();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Backend reload failed.");
    }
  };

  const reindex = async () => {
    if (!workspaceState.projectPath) return;
    setRagBusy(true);
    try {
      await ragClient.syncIndex(workspaceState.projectPath, {
        force: true,
        reason: "settings_reindex",
      });
      const id = ragClient.workspaceId(workspaceState.projectPath);
      if (id) setRagStatus(await ragClient.status(id));
    } finally {
      setRagBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-xs text-dbzs-muted">
      <div className="border border-dbzs-border bg-dbzs-panelSoft p-3 space-y-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-dbzs-muted">
          Speicherorte
        </h4>
        <Row label="Settings-Datei" value={diagnostics?.settingsPath ?? "—"} />
        <Row label="App-Data" value={diagnostics?.appDataDir ?? "—"} />
        <Row label="Models (effektiv)" value={diagnostics?.modelsDir ?? settings.modelsPath} />
        <Row
          label="Win-Runtimes"
          value={diagnostics?.winRuntimesDir ?? "D:/win_runtimes"}
        />
        <Row label="Workspace" value={workspaceState.projectPath ?? "—"} />
        <Row label="Backend URL" value={settings.backendUrl} />
        <Row label="Schema-Version" value={String(diagnostics?.schemaVersion ?? settings.schemaVersion ?? 1)} />
        <Row label="Revision" value={String(diagnostics?.revision ?? settings.revision ?? 0)} />
        <Row label="Zuletzt gespeichert" value={diagnostics?.lastSavedAt ?? settings.updatedAt ?? "—"} />
        <Row label="Geladen um" value={diagnostics?.loadedAt ?? "—"} />
        {!backendReady ? (
          <p className="text-[10px] leading-4 text-dbzs-amber">
            Backend startet noch. Diagnose wird geladen, sobald der Health-Check grün ist.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className="border border-dbzs-border px-2 py-1 hover:border-dbzs-cyan/40"
            disabled={!backendReady}
            onClick={() => void loadDiagnostics()}
            type="button"
          >
            Diagnose aktualisieren
          </button>
          <button
            className="border border-dbzs-amber/50 bg-dbzs-amber/10 px-2 py-1 text-dbzs-amber"
            disabled={isLoading}
            onClick={() => void reloadBackend()}
            type="button"
          >
            Backend neu laden
          </button>
          <button
            className="border border-dbzs-border px-2 py-1"
            disabled={isLoading}
            onClick={() => void resetWorkspace()}
            type="button"
          >
            Workspace zurücksetzen
          </button>
        </div>
      </div>

      <div className="border border-dbzs-border bg-dbzs-panelSoft p-3 space-y-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-dbzs-muted">RAG</h4>
        <p>
          Status: {ragStatus?.state ?? (settings.ragEnabled === false ? "deaktiviert" : "bereit")}
        </p>
        <p>
          {ragStatus
            ? `${ragStatus.chunkCount} Chunks · ${ragStatus.embeddingCount} Embeddings`
            : "Noch kein Indexstatus für diesen Workspace."}
        </p>
        <button
          className="border border-dbzs-cyan/40 px-2 py-1 text-dbzs-cyan disabled:opacity-40"
          disabled={ragBusy || !workspaceState.projectPath}
          onClick={() => void reindex()}
          type="button"
        >
          {ragBusy ? "Indexiere…" : "Reindex"}
        </button>
      </div>

      <div className="border border-dbzs-border bg-dbzs-panelSoft p-3 space-y-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-dbzs-muted">
          Backup &amp; Wiederherstellung
        </h4>
        <p className="text-[10px] leading-4">
          Sichert Settings, Codee-Datenbanken (ohne den rebuildbaren RAG-Index), aktive
          Workspace-Daten unter .codee (ohne Restore-Points) sowie kleine Modellprofile.
          Läuft automatisch beim Start, wenn die letzte Sicherung &gt; 24h zurückliegt.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="border border-dbzs-border px-2 py-1 hover:border-dbzs-cyan/40 disabled:opacity-40"
            disabled={backupBusy}
            onClick={() => void createBackupNow()}
            type="button"
          >
            {backupBusy ? "Läuft…" : "Jetzt sichern"}
          </button>
          <button
            className="border border-dbzs-border px-2 py-1 hover:border-dbzs-cyan/40"
            onClick={() => void openBackupsFolder()}
            type="button"
          >
            Ordner öffnen
          </button>
        </div>
        {backupMessage ? <p className="text-[10px] text-dbzs-cyan">{backupMessage}</p> : null}
        {backups.length === 0 ? (
          <p className="text-[10px] leading-4">Noch keine Backups vorhanden.</p>
        ) : (
          <ul className="space-y-1">
            {backups.map((backup) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 border border-dbzs-border px-2 py-1"
                key={backup.id}
              >
                <span>
                  {new Date(backup.createdAt).toLocaleString()} · {backup.reason} · {backup.fileCount} Dateien
                </span>
                <button
                  className="border border-dbzs-amber/50 px-2 py-0.5 text-dbzs-amber disabled:opacity-40"
                  disabled={backupBusy}
                  onClick={() => void restoreBackup(backup.id)}
                  type="button"
                >
                  Wiederherstellen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border border-dbzs-border bg-dbzs-panelSoft p-3 space-y-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-dbzs-muted">
          Quellen / Overrides
        </h4>
        {Object.entries(diagnostics?.effectiveSources ?? {}).map(([key, value]) => (
          <Row key={key} label={key} value={value} />
        ))}
        {(diagnostics?.orphanedSettings?.length ?? 0) > 0 ? (
          <p className="text-[10px] leading-4">
            Orphaned (nur Anzeige): {diagnostics?.orphanedSettings.join(", ")}
          </p>
        ) : null}
        <p className="text-[10px] leading-4 text-dbzs-muted">
          Export/Import und Reset liegen oben im Notebook. Secrets werden beim Export
          redigiert. Empfohlen: API-Keys nur in EnvVars (
          <code className="text-dbzs-text">OPENAI_API_KEY</code> /{" "}
          <code className="text-dbzs-text">ANTHROPIC_API_KEY</code>
          ); Settings-Felder leer lassen. Einträge in settings.json wären optionaler
          Override (plaintext) — kein OS Credential Store nötig.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
      <span>{label}</span>
      <span className="break-all text-dbzs-text">{value}</span>
    </div>
  );
}
