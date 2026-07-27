import { useState, type ReactNode } from "react";
import type { BackendStartupStatus, BenchmarkResult, GpuInfo } from "@dbzs/shared";
import { ModelDownloadWizard } from "./ModelDownloadWizard";
import { RuntimeDoctorSection } from "./RuntimeDoctorSection";

export type MissionControlPanelProps = {
  backendStartupStatus: BackendStartupStatus | null;
  backendOnline: boolean;
  backendError: string | null;
  electronBridgeActive: boolean;
  workspaceName: string | null;
  workspacePath: string | null;
  workspaceFileCount: number;
  modelIndexLoading: boolean;
  modelIndexError: string | null;
  modelTotal: number | null;
  readyLlamaCount: number;
  readyOllamaCount: number;
  readyModelCount: number;
  runtimeState: string | null;
  runtimeModelName?: string | null;
  runtimeMessage?: string | null;
  openJobCount: number;
  runningJobCount: number;
  failedJobCount: number;
  onReloadBackend: () => void;
  onOpenWorkspace: () => void;
  onScanWorkspace: () => void;
  onReloadModels: () => void;
  onStopRuntime: () => void;
  onLoadGpu?: () => Promise<GpuInfo | null>;
  onRunBenchmark?: () => Promise<BenchmarkResult | null>;
};

export function shouldShowMissionControl({
  activeTab,
  workspacePath,
  backendOnline,
  backendStartupStatus,
  modelIndex
}: {
  activeTab: unknown;
  workspacePath: string | null;
  backendOnline: boolean;
  backendStartupStatus: BackendStartupStatus | null;
  modelIndex: unknown;
}): boolean {
  const backendReady =
    backendOnline &&
    backendStartupStatus?.state !== "starting" &&
    backendStartupStatus?.state !== "failed";
  const modelIndexLoaded = modelIndex !== null;

  if (activeTab && workspacePath && backendReady && modelIndexLoaded) {
    return false;
  }

  return (
    !activeTab ||
    !workspacePath ||
    !backendReady ||
    backendStartupStatus?.state === "failed" ||
    !modelIndexLoaded
  );
}

function backendStatusLabel(
  backendOnline: boolean,
  backendStartupStatus: BackendStartupStatus | null
): string {
  const state = backendStartupStatus?.state ?? "idle";
  if (state === "starting") {
    return "starting";
  }
  if (state === "failed") {
    return "failed";
  }
  if (state === "stopped") {
    return "stopped";
  }
  if (backendOnline) {
    return "ready";
  }
  return state;
}

export function resolveNextAction(props: MissionControlPanelProps): string {
  const backendState = backendStatusLabel(props.backendOnline, props.backendStartupStatus);

  if (backendState === "failed" || backendState === "stopped" || !props.backendOnline) {
    return "Backend-Fehler beheben oder Backend neu laden.";
  }
  if (backendState === "starting") {
    return "Backend-Start abwarten.";
  }
  if (!props.workspacePath) {
    return "Projekt öffnen.";
  }
  if (props.workspaceFileCount === 0) {
    return "Dateien scannen.";
  }
  if (props.modelTotal === 0) {
    return "Modellpfade prüfen.";
  }
  if (props.modelIndexError) {
    return "Modellindex neu laden oder Modellpfade prüfen.";
  }
  if (props.runtimeState !== "running") {
    return "Runtime Doctor: Dry Run → Probe → Start.";
  }
  return "Aufgabe formulieren oder Datei öffnen.";
}

function StatusBadge({ label, tone }: { label: string; tone: "green" | "amber" | "red" | "muted" }) {
  const toneClass =
    tone === "green"
      ? "border-dbzs-green/40 bg-dbzs-green/10 text-dbzs-green"
      : tone === "amber"
        ? "border-dbzs-amber/40 bg-dbzs-amber/10 text-dbzs-amber"
        : tone === "red"
          ? "border-dbzs-red/40 bg-dbzs-red/10 text-dbzs-red"
          : "border-dbzs-border bg-dbzs-bg text-dbzs-muted";

  return (
    <span className={`inline-flex border px-2 py-0.5 text-[11px] uppercase tracking-wide ${toneClass}`}>
      {label}
    </span>
  );
}

function MissionCard({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-dbzs-border bg-dbzs-panel p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-dbzs-text">{children}</div>
    </section>
  );
}

export function MissionControlPanel(props: MissionControlPanelProps) {
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [gpuLoading, setGpuLoading] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [showDownloadWizard, setShowDownloadWizard] = useState(false);
  const backendState = backendStatusLabel(props.backendOnline, props.backendStartupStatus);
  const backendTone =
    backendState === "ready" ? "green" : backendState === "starting" ? "amber" : backendState === "failed" ? "red" : "muted";
  const runtimeTone =
    props.runtimeState === "running" ? "green" : props.runtimeState === "error" ? "red" : "muted";
  const nextAction = resolveNextAction(props);

  return (
    <>
    {showDownloadWizard && <ModelDownloadWizard onClose={() => setShowDownloadWizard(false)} />}
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="border border-dbzs-border bg-dbzs-panel p-6">
          <p className="text-xs uppercase tracking-wide text-dbzs-cyan">Start-Cockpit</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal">DBZS Codee Mission Control</h2>
          <p className="mt-2 text-sm text-dbzs-muted">
            Lokaler AI Coding Assistant · Systemstatus und nächste Schritte
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-dbzs-muted">
            <span>Electron-Bridge:</span>
            <StatusBadge
              label={props.electronBridgeActive ? "aktiv" : "fehlt"}
              tone={props.electronBridgeActive ? "green" : "red"}
            />
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MissionCard title="Backend">
            <div className="flex items-center justify-between gap-2">
              <span className="text-dbzs-muted">Status</span>
              <StatusBadge label={backendState} tone={backendTone} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Port</span>
              <span>{props.backendStartupStatus?.port ?? "—"}</span>
            </div>
            {props.backendError ? (
              <p className="text-xs leading-5 text-dbzs-red">{props.backendError}</p>
            ) : null}
            <button
              className="mt-2 w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-left text-xs text-dbzs-text hover:border-dbzs-cyan/40"
              onClick={props.onReloadBackend}
              type="button"
            >
              Backend neu laden
            </button>
          </MissionCard>

          <MissionCard title="Workspace">
            {props.workspacePath ? (
              <>
                <div className="text-sm font-medium">{props.workspaceName ?? "Workspace"}</div>
                <p className="truncate text-xs text-dbzs-muted">{props.workspacePath}</p>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-dbzs-muted">Dateien</span>
                  <span>{props.workspaceFileCount}</span>
                </div>
              </>
            ) : (
              <p className="text-xs leading-5 text-dbzs-muted">Kein Workspace geöffnet.</p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              <button
                className="w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-2 text-left text-xs font-medium text-dbzs-cyan"
                onClick={props.onOpenWorkspace}
                type="button"
              >
                Projekt öffnen
              </button>
              <button
                className="w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-left text-xs text-dbzs-text hover:border-dbzs-cyan/40 disabled:opacity-40"
                disabled={!props.workspacePath}
                onClick={props.onScanWorkspace}
                type="button"
              >
                Dateien scannen
              </button>
            </div>
          </MissionCard>

          <MissionCard title="Modelle">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Index</span>
              <span>
                {props.modelIndexLoading
                  ? "lädt..."
                  : props.modelIndexError
                    ? "Fehler"
                    : props.modelTotal === null
                      ? "nicht geladen"
                      : "bereit"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Gesamt</span>
              <span>{props.modelTotal ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Ready llama.cpp</span>
              <span>{props.readyLlamaCount}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Ready Ollama</span>
              <span>{props.readyOllamaCount}</span>
            </div>
            {props.modelIndexError ? (
              <p className="text-xs leading-5 text-dbzs-red">{props.modelIndexError}</p>
            ) : null}
            <button
              className="mt-2 w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-left text-xs text-dbzs-text hover:border-dbzs-cyan/40"
              disabled={props.modelIndexLoading}
              onClick={props.onReloadModels}
              type="button"
            >
              Modellindex neu laden
            </button>
            <button
              className="mt-2 w-full border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-2 text-left text-xs font-medium text-dbzs-cyan"
              onClick={() => setShowDownloadWizard(true)}
              type="button"
            >
              Modell herunterladen
            </button>
          </MissionCard>

          <MissionCard title="Runtime">
            <div className="flex items-center justify-between gap-2">
              <span className="text-dbzs-muted">Status</span>
              <StatusBadge label={props.runtimeState ?? "stopped"} tone={runtimeTone} />
            </div>
            {props.runtimeModelName ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-dbzs-muted">Modell</span>
                <span className="truncate">{props.runtimeModelName}</span>
              </div>
            ) : null}
            {props.runtimeMessage ? (
              <p className="text-xs leading-5 text-dbzs-muted">{props.runtimeMessage}</p>
            ) : null}
            <button
              className="mt-2 w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-left text-xs text-dbzs-text hover:border-dbzs-cyan/40 disabled:opacity-40"
              disabled={props.runtimeState !== "running"}
              onClick={props.onStopRuntime}
              type="button"
            >
              Runtime stoppen
            </button>
            {props.onRunBenchmark && (
              <>
                <button
                  className="mt-2 w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-left text-xs text-dbzs-text hover:border-dbzs-cyan/40 disabled:opacity-40"
                  disabled={benchmarkRunning || props.runtimeState !== "running"}
                  onClick={() => {
                    setBenchmarkRunning(true);
                    props.onRunBenchmark!()
                      .then((r) => setBenchmarkResult(r))
                      .catch(() => setBenchmarkResult(null))
                      .finally(() => setBenchmarkRunning(false));
                  }}
                  type="button"
                >
                  {benchmarkRunning ? "Benchmark läuft…" : "Benchmark starten"}
                </button>
                {benchmarkResult && (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    <span className="text-dbzs-muted">Tokens/s</span>
                    <span>{benchmarkResult.tokens_per_second}</span>
                    <span className="text-dbzs-muted">Ø Latenz</span>
                    <span>{benchmarkResult.avg_latency_ms} ms</span>
                    <span className="text-dbzs-muted">Runden</span>
                    <span>{benchmarkResult.rounds}</span>
                    {benchmarkResult.error && (
                      <span className="col-span-2 text-dbzs-red">{benchmarkResult.error}</span>
                    )}
                  </div>
                )}
              </>
            )}
          </MissionCard>

          <MissionCard title="Jobs">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Offen</span>
              <span>{props.openJobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Running</span>
              <span>{props.runningJobCount}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dbzs-muted">Failed</span>
              <span>{props.failedJobCount}</span>
            </div>
            <p className="text-xs leading-5 text-dbzs-muted">
              Job Monitor: im AI-Panel unter Job-Spooler verfügbar.
            </p>
          </MissionCard>

          <MissionCard title="GPU">
            {gpuInfo ? (
              <>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-dbzs-muted">Erkannt</span>
                  <StatusBadge label={gpuInfo.detected ? "ja" : "nein"} tone={gpuInfo.detected ? "green" : "muted"} />
                </div>
                {gpuInfo.detected && (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dbzs-muted">Hersteller</span>
                      <span>{gpuInfo.vendor ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dbzs-muted">Name</span>
                      <span className="truncate">{gpuInfo.name ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dbzs-muted">VRAM (MB)</span>
                      <span>{gpuInfo.vram_mb ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dbzs-muted">Empf. GPU-Layer</span>
                      <span>{gpuInfo.recommended_gpu_layers ?? "—"}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="text-xs leading-5 text-dbzs-muted">{gpuLoading ? "Erkennung läuft…" : "Noch nicht erkannt."}</p>
            )}
            {props.onLoadGpu && (
              <button
                className="mt-2 w-full border border-dbzs-border bg-dbzs-panelSoft px-3 py-2 text-left text-xs text-dbzs-text hover:border-dbzs-cyan/40 disabled:opacity-40"
                disabled={gpuLoading}
                onClick={() => {
                  setGpuLoading(true);
                  props.onLoadGpu!()
                    .then((info) => setGpuInfo(info))
                    .catch(() => setGpuInfo(null))
                    .finally(() => setGpuLoading(false));
                }}
                type="button"
              >
                GPU erkennen
              </button>
            )}
          </MissionCard>

          <MissionCard title="Nächste sinnvolle Aktion">
            <p className="text-sm leading-6 text-dbzs-text">{nextAction}</p>
            <p className="text-xs leading-5 text-dbzs-muted">
              Bereit: {props.readyModelCount} startbare Modelle · Backend{" "}
              {props.backendOnline ? "erreichbar" : "offline"}
            </p>
          </MissionCard>
        </div>

        <RuntimeDoctorSection backendOnline={props.backendOnline} />
      </div>
    </div>
    </>
  );
}
