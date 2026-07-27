import { ResidentModelDataSchema, type BootReadinessComponent } from "@dbzs/shared";
import type { BackendStartupService } from "../backendStartupService.js";
import type { BackendReadinessProbe } from "./backendReadinessProbe.js";
import type { PhaseRunner, PhaseRunnerResult } from "./bootOrchestrator.js";
import { MIN_FREE_SPACE_BYTES, runFilesystemCheck, type FilesystemCheckInput } from "./filesystemCheck.js";
import { waitForFrontendPhase } from "./frontendPhaseReporter.js";

export interface PhaseRunnerDeps {
  backendStartup: BackendStartupService;
  probe: BackendReadinessProbe;
  userDataDir: string;
  filesystemCheck: FilesystemCheckInput;
  /** Wraps the existing loadWorkspaceState() call (main.ts) as a tracked boot phase. */
  loadLocalConfig: () => Promise<void>;
  onBackendPid: (pid: number | null) => void;
  onDetectedModelCount: (count: number | null) => void;
  onResidentModelId: (id: string | null) => void;
}

/** Normalizes a component's progress/total pair (or bare progress) to 0-100. */
function normalizeProgress(progress?: number | null, total?: number | null): number {
  if (
    typeof progress === "number" &&
    typeof total === "number" &&
    Number.isFinite(progress) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    return Math.min(100, Math.max(0, Math.round((progress / total) * 100)));
  }
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return Math.min(100, Math.max(0, progress));
  }
  return 0;
}

/**
 * Maps a backend readiness component onto a PhaseRunnerResult. Non-terminal
 * component states (pending/waiting/running) map to outcome:"pending" — not
 * "failed" — so the orchestrator's pollCount (not retryCount) advances while
 * waiting for a component to finish initializing. Treating "still working"
 * as a failure was the root cause of a real production bug (see
 * bootPhaseDefinitions.ts's history): the retry-count ceiling, not the
 * intended hard timeout, silently ended phases early.
 */
function componentResult(
  component: BootReadinessComponent | undefined,
  reportProgress: (progress: number, message?: string | null) => void,
  readyLabel: string
): PhaseRunnerResult {
  if (!component) {
    return { outcome: "pending", message: "Backend hat noch keinen Komponentenstatus gemeldet.", pollAfterMs: 500 };
  }

  const progress = normalizeProgress(component.progress, component.total);
  reportProgress(progress, component.message);

  switch (component.state) {
    case "success":
      return { outcome: "success", message: component.message ?? readyLabel, metadata: component.data };

    case "warning":
      return { outcome: "warning", message: component.message ?? readyLabel, metadata: component.data };

    case "skipped":
      return { outcome: "skipped", message: component.message ?? "Übersprungen.", metadata: component.data };

    case "failed":
      return {
        outcome: "failed",
        message: component.message ?? "Komponente fehlgeschlagen.",
        error: {
          code: component.error?.code ?? "component-failed",
          message: component.message ?? "Komponente fehlgeschlagen.",
          technicalDetail: component.error?.technicalDetail ?? undefined,
          exitCode: component.error?.exitCode,
          stderrTail: component.error?.stderrTail ?? undefined
        },
        metadata: component.data
      };

    case "pending":
    case "waiting":
    case "running":
      return {
        outcome: "pending",
        message: component.message ?? "Komponente wird initialisiert.",
        progress,
        pollAfterMs: 500,
        metadata: component.data
      };

    default:
      return {
        outcome: "failed",
        message: `Unbekannter Komponentenstatus: ${String(component.state)}`,
        error: { code: "unknown-component-state", message: `Unbekannter Komponentenstatus: ${String(component.state)}` }
      };
  }
}

async function waitFrontend(phaseId: string, signal: AbortSignal, label: string): Promise<PhaseRunnerResult> {
  try {
    const message = await waitForFrontendPhase(phaseId, signal);
    return { outcome: "success", message: message || label };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: "failed", message, error: { code: "frontend-phase-failed", message } };
  }
}

export function createPhaseRunners(deps: PhaseRunnerDeps): Record<string, PhaseRunner> {
  return {
    "desktop-process": async () => ({ outcome: "success", message: "Desktop-Prozess läuft." }),

    "local-config": async () => {
      await deps.loadLocalConfig();
      return { outcome: "success", message: "Lokale Konfiguration geladen." };
    },

    "filesystem-check": async () => {
      const result = await runFilesystemCheck(deps.filesystemCheck);

      if (!result.userDataWritable) {
        const message = `Benutzerdatenverzeichnis nicht beschreibbar: ${deps.filesystemCheck.userDataDir}`;
        return { outcome: "failed", message, error: { code: "userdata-not-writable", message }, metadata: { ...result } };
      }
      if (!result.databaseDirWritable) {
        const message = `Datenbankverzeichnis nicht beschreibbar: ${deps.filesystemCheck.databaseDir}`;
        return { outcome: "failed", message, error: { code: "database-dir-not-writable", message }, metadata: { ...result } };
      }
      if (!result.backendLaunchAvailable) {
        const message = "Backend-Executable oder uv/python wurde nicht gefunden.";
        return { outcome: "failed", message, error: { code: "backend-launch-unavailable", message }, metadata: { ...result } };
      }
      // Runtime-executable check is best-effort (see filesystemCheck.ts's
      // docstring) -- only fails when we actually had candidates to check
      // and none of them existed; runtime-manager-init is the real gate.
      if (deps.filesystemCheck.runtimeExecutableCandidates.length > 0 && !result.runtimeExecutableAvailable) {
        const message = "Runtime-Executable wurde an keinem der bekannten Pfade gefunden.";
        return { outcome: "failed", message, error: { code: "runtime-executable-unavailable", message }, metadata: { ...result } };
      }
      if (result.freeSpaceBytes < MIN_FREE_SPACE_BYTES) {
        const freeMb = Math.round(result.freeSpaceBytes / (1024 * 1024));
        const message = `Zu wenig freier Speicherplatz (${freeMb} MB verfügbar, mindestens 500 MB erforderlich).`;
        return { outcome: "failed", message, error: { code: "insufficient-disk-space", message }, metadata: { ...result } };
      }

      const unavailableModelRoots = result.modelRoots.filter((root) => !root.exists || !root.readable);
      if (unavailableModelRoots.length > 0) {
        const message = `Modellpfad(e) nicht verfügbar: ${unavailableModelRoots.map((root) => root.path).join(", ")}`;
        return { outcome: "warning", message, metadata: { ...result } };
      }
      if (!result.logDirWritable) {
        return {
          outcome: "warning",
          message: `Log-Verzeichnis nicht beschreibbar: ${deps.filesystemCheck.logDir}`,
          metadata: { ...result }
        };
      }

      return { outcome: "success", message: `Schreibrechte bestätigt: ${deps.filesystemCheck.userDataDir}`, metadata: { ...result } };
    },

    // Merges the former "backend-process-started" + "backend-process-alive"
    // phases: spawning and confirming the PID are one fast local action, not
    // two separately-timed-out steps.
    "backend-spawn": async () => {
      const status = await deps.backendStartup.ensureStarted({ waitUntilReady: false });
      if (status.state === "failed") {
        return { outcome: "failed", message: status.message ?? "Backend-Start fehlgeschlagen.", error: { code: "spawn-failed", message: status.message ?? "" } };
      }
      const pid = deps.backendStartup.getPid();
      if (pid == null) {
        return { outcome: "pending", message: "Warte auf Backend-Prozess-PID...", pollAfterMs: 500 };
      }
      deps.onBackendPid(pid);
      return { outcome: "success", message: `Backend-Prozess gestartet (PID ${pid}).` };
    },

    "backend-live": async (ctx) => {
      const result = await deps.probe.probeLive(ctx.signal);
      if (!result.ok) {
        return { outcome: "pending", message: "Backend-Health-Endpunkt noch nicht erreichbar.", pollAfterMs: 500 };
      }
      if (result.pid != null) deps.onBackendPid(result.pid);
      return { outcome: "success", message: "Backend-Health-Endpunkt erreichbar." };
    },

    "backend-startup-api": async (ctx) => {
      // Checks that the readiness subsystem itself is reachable and
      // structurally valid -- NOT the terminal GET /health/ready gate (that
      // endpoint stays 503 until database/modelRegistry/runtimeManager all
      // succeed, which happens much later in this dependency order).
      const startup = await deps.probe.probeStartup(ctx.signal);
      if (!startup || typeof startup.status !== "string") {
        return { outcome: "pending", message: "Backend-Readiness-Endpunkt noch nicht bereit.", pollAfterMs: 500 };
      }
      return { outcome: "success", message: "Backend-Readiness-Subsystem bereit." };
    },

    "database-init": async (ctx) => {
      const startup = await deps.probe.probeStartup(ctx.signal);
      return componentResult(startup?.components.database, ctx.reportProgress, "Datenbank bereit.");
    },

    "model-index": async (ctx) => {
      const startup = await deps.probe.probeStartup(ctx.signal);
      const component = startup?.components.modelRegistry;
      if (component?.total != null) deps.onDetectedModelCount(component.total);
      return componentResult(component, ctx.reportProgress, "Modellkatalog geladen.");
    },

    "runtime-manager-init": async (ctx) => {
      const startup = await deps.probe.probeStartup(ctx.signal);
      return componentResult(startup?.components.runtimeManager, ctx.reportProgress, "Runtime Manager bereit.");
    },

    "resident-model": async (ctx) => {
      const startup = await deps.probe.probeStartup(ctx.signal);
      const component = startup?.components.residentModel;
      // Structured id extraction only -- never parsed out of the free-text
      // message. A successful fallback (outcome "warning") also carries a
      // real modelId, so this checks for the data shape, not just "success".
      if (component?.data) {
        const parsed = ResidentModelDataSchema.safeParse(component.data);
        if (parsed.success) {
          deps.onResidentModelId(parsed.data.modelId);
        }
      }
      return componentResult(component, ctx.reportProgress, "Residentes Modell bereit.");
    },

    // The real terminal aggregate: GET /health/ready only reports
    // ready:true once database/modelRegistry/runtimeManager have all
    // succeeded and resident-model has reached some terminal state.
    "backend-ready": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      if (!readiness) {
        return { outcome: "pending", message: "Warte auf vollständige Backend-Readiness...", pollAfterMs: 500 };
      }
      if (!readiness.ready) {
        return { outcome: "pending", message: `Backend noch nicht vollständig bereit (${readiness.status}).`, pollAfterMs: 500 };
      }
      const message =
        readiness.status === "degraded"
          ? "Backend bereit (residentes Modell eingeschränkt oder nicht verfügbar)."
          : "Backend vollständig bereit.";
      return { outcome: "success", message };
    },

    "frontend-bridge": (ctx) => waitFrontend("frontend-bridge", ctx.signal, "Frontend-Bridge verbunden."),
    "frontend-config-sync": (ctx) => waitFrontend("frontend-config-sync", ctx.signal, "Frontend-Konfiguration synchronisiert."),
    "workspace-restore": (ctx) => waitFrontend("workspace-restore", ctx.signal, "Workspace wiederhergestellt."),
    "agents-roles-models": (ctx) => waitFrontend("agents-roles-models", ctx.signal, "Agenten und Modelle geladen."),

    // Gated on the renderer's real double-requestAnimationFrame paint
    // acknowledgement (main.tsx), not just Electron's "ready-to-show" event
    // -- see waitFrontend()'s docstring for why this needs a real signal
    // from the renderer rather than an OS-level "presentable" hint.
    "main-window-rendered": (ctx) => waitFrontend("main-window-rendered", ctx.signal, "Hauptfenster gerendert."),

    "main-app-released": async () => ({ outcome: "success", message: "Hauptanwendung freigegeben." })
  };
}
