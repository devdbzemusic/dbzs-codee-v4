/**
 * Boot orchestrator contracts shared between the Electron desktop process,
 * the renderer (splash + main window), and mirrored by the backend's
 * `/health/ready` payload shape. This is the single source of truth for
 * boot/startup status — no parallel independent booleans elsewhere.
 */

export type BootPhaseState =
  | "pending"
  | "waiting"
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "retrying"
  | "blocked"
  | "skipped";

export type BootLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type BootLogSource =
  | "desktop"
  | "frontend"
  | "backend"
  | "database"
  | "model-index"
  | "runtime"
  | "llama-cpp"
  | "workspace"
  | "agent-system";

export interface BootError {
  code: string;
  message: string;
  technicalDetail?: string;
  exitCode?: number | null;
  stderrTail?: string;
  endpoint?: string;
  port?: number;
  timeoutMs?: number;
  retryAttempts: number;
}

export interface BootLogEntry {
  timestamp: number;
  level: BootLogLevel;
  source: BootLogSource;
  phaseId: string | null;
  event: string;
  message: string;
  durationMs?: number;
  retryNumber?: number;
  metadata?: Record<string, unknown>;
}

export interface BootTimeoutPolicy {
  softTimeoutMs: number;
  hardTimeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
}

export interface BootPhase {
  id: string;
  label: string;
  description?: string;
  state: BootPhaseState;
  progress: number;
  message: string;
  dependencies: string[];
  optional: boolean;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  retryCount: number;
  error?: BootError;
  details: BootLogEntry[];
}

export type BootRunStatus = "starting" | "ready" | "degraded" | "failed";

export interface BootState {
  runId: string;
  status: BootRunStatus;
  currentPhaseId: string | null;
  overallProgress: number;
  phases: BootPhase[];
  startedAt: number;
  finishedAt?: number;
  /**
   * Additive HUD fields the splash header needs (spec §4) that don't belong
   * to any single phase. Still part of the one BootState source of truth.
   */
  backendPid: number | null;
  backendPort: number | null;
  activeRuntimeSlot: string | null;
  residentModelId: string | null;
  detectedModelCount: number | null;
  lastErrorMessage: string | null;
}

export type ModelRuntimeStatus =
  | "unknown"
  | "available"
  | "starting"
  | "loading"
  | "warming"
  | "ready"
  | "failed"
  | "stopped";

/** Mirrors `backend/app/core/boot_state.py`'s component snapshot shape. */
export interface BootReadinessComponent {
  state: BootPhaseState;
  progress?: number;
  total?: number;
  message?: string;
  error?: string | null;
}

export interface BootReadinessResponse {
  status: BootRunStatus;
  ready: boolean;
  progress: number;
  components: {
    database: BootReadinessComponent;
    modelRegistry: BootReadinessComponent;
    runtimeManager: BootReadinessComponent;
    residentModel: BootReadinessComponent;
  };
}

export interface BootDiagnosticExport {
  runId: string;
  appVersion: string;
  os: string;
  arch: string;
  startedAt: number;
  finishedAt: number | null;
  phases: BootPhase[];
  logs: BootLogEntry[];
  warnings: string[];
  errors: string[];
  backendPid: number | null;
  backendPort: number | null;
  runtime: string | null;
  residentModelId: string | null;
  residentModelSlot: string | null;
  retryAttempts: Record<string, number>;
  exitCodes: Record<string, number | null>;
  stderr: Record<string, string>;
  readinessResponses: BootReadinessResponse[];
}
