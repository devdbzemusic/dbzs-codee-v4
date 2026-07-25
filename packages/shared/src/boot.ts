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

/**
 * Replaces the earlier BootTimeoutPolicy (softTimeoutMs/hardTimeoutMs/
 * retryCount/retryDelayMs). pollIntervalMs governs "not ready yet" polling
 * (a non-terminal component status), while maxRetries/retryDelayMs govern
 * retries after a *genuine* failure — the two must stay independent, since
 * conflating them (the old design) let a retry-count ceiling silently cut a
 * poll loop short before its own hard timeout was reached.
 */
export interface BootPhasePolicy {
  softTimeoutMs: number;
  hardTimeoutMs: number;
  pollIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  extendDeadlineOnProgress: boolean;
  maxDeadlineExtensionMs: number;
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
  /** Whether the main window's release must wait for this phase to reach a terminal state. */
  blocksWindowRelease: boolean;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  /** Counts non-terminal "still working" polls (component state pending/waiting/running). */
  pollCount: number;
  /** Counts retries after a genuine failure outcome. Kept separate from pollCount. */
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

export interface BootComponentError {
  code: string;
  technicalDetail?: string;
  exitCode?: number | null;
  stderrTail?: string;
}

/** Mirrors `backend/app/core/boot_state.py`'s component snapshot shape. */
export interface BootReadinessComponent {
  state: BootPhaseState;
  progress?: number;
  total?: number;
  message?: string;
  error?: BootComponentError | null;
  /** Structured payload (e.g. model-index counts, resident-model identity) beyond a free-text message. */
  data?: Record<string, unknown>;
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
