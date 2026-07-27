import { useEffect, useMemo, useState } from "react";
import type { ModelDoctorEntry, RuntimeCheck } from "@dbzs/shared";
import { useRuntimeStore } from "@/stores/runtimeStore";

function CheckBadge({ status }: { status: RuntimeCheck["status"] }) {
  const tone =
    status === "ok"
      ? "border-dbzs-green/40 bg-dbzs-green/10 text-dbzs-green"
      : status === "warn"
        ? "border-dbzs-amber/40 bg-dbzs-amber/10 text-dbzs-amber"
        : "border-dbzs-red/40 bg-dbzs-red/10 text-dbzs-red";

  return (
    <span className={`inline-flex border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  );
}

function ModelDoctorCard({
  entry,
  profileName,
  profiles,
  onProfileChange,
  disabled,
  runtimeRunning,
  onDryRun,
  onProbe,
  onStart,
  onStop
}: {
  entry: ModelDoctorEntry;
  profileName: string;
  profiles: string[];
  onProfileChange: (value: string) => void;
  disabled: boolean;
  runtimeRunning: boolean;
  onDryRun: () => void;
  onProbe: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const [showCommand, setShowCommand] = useState(false);
  const actionDisabled = disabled || entry.blockers.length > 0;

  return (
    <article className="border border-dbzs-border bg-dbzs-panelSoft p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-dbzs-text">{entry.name}</h4>
          <p className="mt-1 font-mono text-[10px] text-dbzs-muted">{entry.model_id}</p>
        </div>
        <span
          className={`border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            entry.runnable
              ? "border-dbzs-green/40 bg-dbzs-green/10 text-dbzs-green"
              : "border-dbzs-red/40 bg-dbzs-red/10 text-dbzs-red"
          }`}
        >
          {entry.runnable ? "runnable" : "blocked"}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-dbzs-muted">Provider</dt>
        <dd>{entry.provider}</dd>
        <dt className="text-dbzs-muted">Launcher</dt>
        <dd>{entry.runtime_launcher}</dd>
        <dt className="text-dbzs-muted">Format</dt>
        <dd>{entry.format}</dd>
        <dt className="text-dbzs-muted">Compatibility</dt>
        <dd>{entry.compatibility}</dd>
      </dl>

      {entry.blockers.length > 0 ? (
        <div className="mt-2 text-[11px] text-dbzs-red">
          <p className="font-medium">Blockers</p>
          <ul className="mt-1 list-disc pl-4">
            {entry.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {entry.warnings.length > 0 ? (
        <div className="mt-2 text-[11px] text-dbzs-amber">
          <p className="font-medium">Warnings</p>
          <ul className="mt-1 list-disc pl-4">
            {entry.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        className="mt-2 text-[11px] text-dbzs-cyan hover:underline"
        onClick={() => setShowCommand((value) => !value)}
        type="button"
      >
        {showCommand ? "Command Preview ausblenden" : "Command Preview anzeigen"}
      </button>
      {showCommand ? (
        <pre className="mt-2 max-h-32 overflow-auto border border-dbzs-border bg-dbzs-bg p-2 text-[10px] leading-5 text-dbzs-muted">
          {entry.command_preview}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-dbzs-muted">
          Profil
          <select
            className="ml-2 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[11px] text-dbzs-text"
            disabled={actionDisabled}
            onChange={(event) => onProfileChange(event.target.value)}
            value={profileName}
          >
            {profiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="border border-dbzs-border bg-dbzs-panel px-2 py-2 text-left text-[11px] hover:border-dbzs-cyan/40 disabled:opacity-40"
          disabled={actionDisabled}
          onClick={onDryRun}
          type="button"
        >
          Dry Run
        </button>
        <button
          className="border border-dbzs-border bg-dbzs-panel px-2 py-2 text-left text-[11px] hover:border-dbzs-cyan/40 disabled:opacity-40"
          disabled={actionDisabled}
          onClick={onProbe}
          type="button"
        >
          Probe Start
        </button>
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-2 text-left text-[11px] font-medium text-dbzs-cyan disabled:opacity-40"
          disabled={actionDisabled || runtimeRunning}
          onClick={onStart}
          type="button"
        >
          Start Runtime
        </button>
        <button
          className="border border-dbzs-border bg-dbzs-panel px-2 py-2 text-left text-[11px] hover:border-dbzs-cyan/40 disabled:opacity-40"
          disabled={disabled || !runtimeRunning}
          onClick={onStop}
          type="button"
        >
          Stop Runtime
        </button>
      </div>
    </article>
  );
}

export type RuntimeDoctorSectionProps = {
  backendOnline: boolean;
};

export function RuntimeDoctorSection({ backendOnline }: RuntimeDoctorSectionProps) {
  const {
    doctorReport,
    doctorLoading,
    actionResult,
    logs,
    status,
    isLoading,
    loadDoctorReport,
    loadLogs,
    dryRunModel,
    probeModel,
    startModel,
    stopModel
  } = useRuntimeStore();

  const [profileByModel, setProfileByModel] = useState<Record<string, string>>({});

  useEffect(() => {
    if (backendOnline) {
      void loadDoctorReport();
    }
  }, [backendOnline, loadDoctorReport]);

  const profiles = useMemo(
    () => doctorReport?.suggested_profiles.map((profile) => profile.name) ?? ["safe_cpu_coder"],
    [doctorReport]
  );

  const runnableModels = useMemo(
    () => doctorReport?.models.filter((entry) => entry.runnable) ?? [],
    [doctorReport]
  );

  const displayedModels = useMemo(() => {
    if (!doctorReport) {
      return [];
    }
    return doctorReport.models.slice(0, 12);
  }, [doctorReport]);

  const runtimeRunning = status?.state === "running";
  const disabled = !backendOnline || isLoading;

  return (
    <section className="border border-dbzs-border bg-dbzs-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">Runtime Doctor</h3>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            Golden Path: Dry Run → Probe → Start → Chat
          </p>
        </div>
        <button
          className="border border-dbzs-border bg-dbzs-panelSoft px-3 py-1.5 text-[11px] hover:border-dbzs-cyan/40 disabled:opacity-40"
          disabled={!backendOnline || doctorLoading}
          onClick={() => void loadDoctorReport()}
          type="button"
        >
          {doctorLoading ? "lädt…" : "Doctor aktualisieren"}
        </button>
      </div>

      {doctorReport ? (
        <>
          <p className="mt-3 text-xs text-dbzs-text">{doctorReport.summary}</p>
          <p className="mt-1 text-[11px] text-dbzs-muted">
            {runnableModels.length} lauffähige Modelle · {doctorReport.models.length} geprüft
          </p>

          <div className="mt-4 space-y-2">
            {doctorReport.checks.map((check) => (
              <div
                className="flex flex-wrap items-start justify-between gap-2 border border-dbzs-border bg-dbzs-bg px-3 py-2"
                key={check.id}
              >
                <div>
                  <p className="text-[11px] font-medium text-dbzs-text">{check.id}</p>
                  <p className="mt-1 text-[11px] text-dbzs-muted">{check.message}</p>
                  {check.recommendation ? (
                    <p className="mt-1 text-[11px] text-dbzs-cyan">{check.recommendation}</p>
                  ) : null}
                </div>
                <CheckBadge status={check.status} />
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {displayedModels.map((entry) => {
              const profileName = profileByModel[entry.model_id] ?? profiles[0] ?? "safe_cpu_coder";
              return (
                <ModelDoctorCard
                  disabled={disabled}
                  entry={entry}
                  key={entry.model_id}
                  onDryRun={() => void dryRunModel(entry.model_id, profileName)}
                  onProbe={() => void probeModel(entry.model_id)}
                  onProfileChange={(value) =>
                    setProfileByModel((current) => ({ ...current, [entry.model_id]: value }))
                  }
                  onStart={() => void startModel(entry.model_id)}
                  onStop={() => void stopModel()}
                  profileName={profileName}
                  profiles={profiles}
                  runtimeRunning={runtimeRunning}
                />
              );
            })}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-dbzs-muted">
          {backendOnline ? "Runtime Doctor wird geladen…" : "Backend offline — Doctor nicht verfügbar."}
        </p>
      )}

      <div className="mt-4 border border-dbzs-border bg-dbzs-bg p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-dbzs-muted">Ergebnis</h4>
          <button
            className="border border-dbzs-border px-2 py-1 text-[10px] hover:border-dbzs-cyan/40 disabled:opacity-40"
            disabled={!backendOnline}
            onClick={() => void loadLogs()}
            type="button"
          >
            Logs aktualisieren
          </button>
        </div>

        {actionResult ? (
          <div className="mt-2 space-y-2 text-[11px]">
            <p className={actionResult.success ? "text-dbzs-green" : "text-dbzs-red"}>
              {actionResult.action ?? "action"} · {actionResult.success ? "OK" : "Fehler"} · {actionResult.message}
            </p>
            {actionResult.command_preview ? (
              <pre className="max-h-32 overflow-auto border border-dbzs-border bg-dbzs-panel p-2 text-[10px] leading-5 text-dbzs-muted">
                {actionResult.command_preview}
              </pre>
            ) : null}
            {actionResult.stderr_tail ? (
              <div>
                <p className="font-medium text-dbzs-red">stderr</p>
                <pre className="mt-1 max-h-40 overflow-auto border border-dbzs-red/30 bg-dbzs-panel p-2 text-[10px] leading-5 text-dbzs-red">
                  {actionResult.stderr_tail}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-dbzs-muted">Noch keine Doctor-Aktion ausgeführt.</p>
        )}

        {logs?.stderr_tail ? (
          <div className="mt-3">
            <p className="text-[11px] font-medium text-dbzs-muted">Aktuelle Runtime-Logs</p>
            <pre className="mt-1 max-h-40 overflow-auto border border-dbzs-border bg-dbzs-panel p-2 text-[10px] leading-5 text-dbzs-muted">
              {logs.stderr_tail}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
