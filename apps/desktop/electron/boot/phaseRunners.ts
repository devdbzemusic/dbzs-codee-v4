import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import type { BootReadinessComponent } from "@dbzs/shared";
import type { BackendStartupService } from "../backendStartupService.js";
import type { BackendReadinessProbe } from "./backendReadinessProbe.js";
import type { PhaseRunner, PhaseRunnerResult } from "./bootOrchestrator.js";
import { waitForFrontendPhase } from "./frontendPhaseReporter.js";

export interface PhaseRunnerDeps {
  backendStartup: BackendStartupService;
  probe: BackendReadinessProbe;
  userDataDir: string;
  /** Wraps the existing loadWorkspaceState() call (main.ts) as a tracked boot phase. */
  loadLocalConfig: () => Promise<void>;
  onBackendPid: (pid: number | null) => void;
  onDetectedModelCount: (count: number | null) => void;
  onResidentModelId: (id: string | null) => void;
}

function componentResult(
  component: BootReadinessComponent | undefined,
  reportProgress: (progress: number, message?: string) => void,
  readyLabel: string
): PhaseRunnerResult {
  if (!component) {
    return { outcome: "failed", message: "Backend hat noch keinen Status gemeldet." };
  }
  if (component.progress != null && component.total != null && component.total > 0) {
    reportProgress(Math.round((component.progress / component.total) * 100), component.message);
  } else if (component.message) {
    reportProgress(component.progress ?? 0, component.message);
  }
  if (component.state === "success") {
    return { outcome: "success", message: component.message ?? readyLabel };
  }
  if (component.state === "warning") {
    return { outcome: "warning", message: component.message ?? readyLabel };
  }
  if (component.state === "failed") {
    return {
      outcome: "failed",
      message: component.message ?? "Fehlgeschlagen.",
      error: { code: "component-failed", message: component.message ?? "Fehlgeschlagen.", technicalDetail: component.error ?? undefined }
    };
  }
  // pending/running/waiting/skipped -> not terminal yet, ask orchestrator to retry
  return { outcome: "failed", message: component.message ?? "Wird verarbeitet..." };
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
      await mkdir(deps.userDataDir, { recursive: true });
      await access(deps.userDataDir, fsConstants.W_OK);
      return { outcome: "success", message: `Schreibrechte bestätigt: ${deps.userDataDir}` };
    },

    "backend-process-started": async () => {
      const status = await deps.backendStartup.ensureStarted({ waitUntilReady: false });
      if (status.state === "failed") {
        return { outcome: "failed", message: status.message ?? "Backend-Start fehlgeschlagen.", error: { code: "spawn-failed", message: status.message ?? "" } };
      }
      return { outcome: "success", message: "Backend-Prozess gestartet." };
    },

    "backend-process-alive": async () => {
      const pid = deps.backendStartup.getPid();
      const status = deps.backendStartup.getStatus();
      if (status.state === "failed") {
        return { outcome: "failed", message: status.message ?? "Backend-Prozess beendet.", error: { code: "process-exited", message: status.message ?? "" } };
      }
      if (pid == null) {
        return { outcome: "failed", message: "Warte auf Backend-Prozess-PID..." };
      }
      deps.onBackendPid(pid);
      return { outcome: "success", message: `Backend-Prozess lebt (PID ${pid}).` };
    },

    "backend-health-live": async (ctx) => {
      const result = await deps.probe.probeLive(ctx.signal);
      if (!result.ok) {
        return { outcome: "failed", message: "Backend-Health-Endpunkt noch nicht erreichbar." };
      }
      if (result.pid != null) deps.onBackendPid(result.pid);
      return { outcome: "success", message: "Backend-Health-Endpunkt erreichbar." };
    },

    "backend-ready": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      if (!readiness || typeof readiness.status !== "string") {
        return { outcome: "failed", message: "Backend-Readiness-Endpunkt noch nicht bereit." };
      }
      return { outcome: "success", message: "Backend-Readiness-Subsystem bereit." };
    },

    "database-init": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      return componentResult(readiness?.components.database, ctx.reportProgress, "Datenbank bereit.");
    },

    "model-index": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      const component = readiness?.components.modelRegistry;
      if (component?.total != null) deps.onDetectedModelCount(component.total);
      return componentResult(component, ctx.reportProgress, "Modellkatalog geladen.");
    },

    "runtime-manager-init": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      return componentResult(readiness?.components.runtimeManager, ctx.reportProgress, "Runtime Manager bereit.");
    },

    "resident-model": async (ctx) => {
      const readiness = await deps.probe.probeReady(ctx.signal);
      const component = readiness?.components.residentModel;
      if (component?.state === "success" && component.message) {
        deps.onResidentModelId(component.message);
      }
      const result = componentResult(component, ctx.reportProgress, "Residentes Modell bereit.");
      if (component?.state === "skipped") {
        return { outcome: "success", message: component.message ?? "Autostart deaktiviert." };
      }
      return result;
    },

    "frontend-bridge": (ctx) => waitFrontend("frontend-bridge", ctx.signal, "Frontend-Bridge verbunden."),
    "frontend-config-sync": (ctx) => waitFrontend("frontend-config-sync", ctx.signal, "Frontend-Konfiguration synchronisiert."),
    "workspace-restore": (ctx) => waitFrontend("workspace-restore", ctx.signal, "Workspace wiederhergestellt."),
    "agents-roles-models": (ctx) => waitFrontend("agents-roles-models", ctx.signal, "Agenten und Modelle geladen."),

    "main-app-released": async () => ({ outcome: "success", message: "Hauptanwendung freigegeben." })
  };
}
