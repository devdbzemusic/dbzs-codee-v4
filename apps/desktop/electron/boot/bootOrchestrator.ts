import { randomUUID } from "node:crypto";
import type { BootError, BootLogEntry, BootPhase, BootState, BootRunStatus } from "@dbzs/shared";
import type { BootPhaseDefinition } from "./bootPhaseDefinitions.js";
import { validateBootGraph } from "./validateBootGraph.js";

/**
 * Central boot state machine (spec: "the single source of truth for boot
 * status"). Contains no I/O of its own — phase work is delegated to
 * injected PhaseRunner functions, which makes the whole scheduling/timeout/
 * retry/dependency-blocking logic unit-testable with fakes (no real
 * backend, no real timers needed — see bootOrchestrator.test.ts).
 */

export interface PhaseRunnerContext {
  phaseId: string;
  attempt: number;
  signal: AbortSignal;
  bootState: Readonly<BootState>;
  reportProgress: (progress: number, message?: string) => void;
  log: (entry: Omit<BootLogEntry, "timestamp" | "phaseId">) => void;
}

export type PhaseRunnerOutcome = "success" | "warning" | "pending" | "failed" | "skipped";

export interface PhaseRunnerResult {
  outcome: PhaseRunnerOutcome;
  message: string;
  error?: Partial<BootError>;
}

export type PhaseRunner = (ctx: PhaseRunnerContext) => Promise<PhaseRunnerResult>;

export interface BootOrchestratorClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultClock: BootOrchestratorClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

class BootHardTimeoutError extends Error {
  constructor() {
    super("hard-timeout");
    this.name = "BootHardTimeoutError";
  }
}

function createInitialPhase(def: BootPhaseDefinition): BootPhase {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    state: "pending",
    progress: 0,
    message: "",
    dependencies: [...def.dependencies],
    optional: def.optional,
    blocksWindowRelease: def.blocksWindowRelease,
    pollCount: 0,
    retryCount: 0,
    details: []
  };
}

export class BootOrchestrator {
  private readonly definitions: Map<string, BootPhaseDefinition>;
  private readonly runners: Record<string, PhaseRunner>;
  private readonly clock: BootOrchestratorClock;
  private readonly listeners = new Set<(state: BootState) => void>();
  private readonly active = new Map<string, Promise<void>>();
  private state: BootState;
  private resolveRun: (() => void) | null = null;

  constructor(
    phaseDefinitions: BootPhaseDefinition[],
    runners: Record<string, PhaseRunner>,
    options?: { clock?: BootOrchestratorClock; runId?: string }
  ) {
    const validation = validateBootGraph(phaseDefinitions, runners);
    if (!validation.valid) {
      throw new Error(`Invalid boot graph:\n${validation.errors.join("\n")}`);
    }

    this.definitions = new Map(phaseDefinitions.map((def) => [def.id, def]));
    this.runners = runners;
    this.clock = options?.clock ?? defaultClock;

    this.state = {
      runId: options?.runId ?? randomUUID(),
      status: "starting",
      currentPhaseId: null,
      overallProgress: 0,
      phases: phaseDefinitions.map(createInitialPhase),
      startedAt: this.clock.now(),
      backendPid: null,
      backendPort: null,
      activeRuntimeSlot: null,
      residentModelId: null,
      detectedModelCount: null,
      lastErrorMessage: null
    };
  }

  getState(): BootState {
    return this.cloneState();
  }

  onStateChange(listener: (state: BootState) => void): () => void {
    this.listeners.add(listener);
    listener(this.cloneState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Merges a log entry sourced from outside the orchestrator (backend
   * /boot/stream SSE, frontend phase reports) into the matching phase's
   * `details`, so the splash's log panel has one merged, structured feed
   * instead of separate desktop/backend/frontend streams.
   */
  ingestExternalLog(entry: Omit<BootLogEntry, "timestamp"> & { timestamp?: number }): void {
    const phaseId = entry.phaseId && this.state.phases.some((p) => p.id === entry.phaseId) ? entry.phaseId : this.state.currentPhaseId;
    if (!phaseId) return;
    const phase = this.state.phases.find((p) => p.id === phaseId);
    if (!phase) return;
    phase.details.push({ ...entry, phaseId, timestamp: entry.timestamp ?? this.clock.now() });
    this.publish();
  }

  /** Patches HUD fields (backendPid, residentModelId, ...) without touching phases. */
  patchHud(patch: Partial<Pick<BootState, "backendPid" | "backendPort" | "activeRuntimeSlot" | "residentModelId" | "detectedModelCount">>): void {
    Object.assign(this.state, patch);
    this.publish();
  }

  async run(): Promise<BootState> {
    const donePromise = new Promise<void>((resolve) => {
      this.resolveRun = resolve;
    });
    this.pump();
    await donePromise;
    this.finalizeRunStatus();
    return this.cloneState();
  }

  /** Re-runs a single failed/blocked phase (and anything it unblocks). Used by the "retry this phase" splash action. */
  async retryPhase(phaseId: string): Promise<void> {
    const phase = this.getPhaseOrThrow(phaseId);
    if (phase.state !== "failed" && phase.state !== "blocked") {
      return;
    }
    this.resetPhaseForRetry(phaseId);
    this.resetDependentsToPending(phaseId);
    if (!this.resolveRun) {
      // Orchestrator already completed a run() call; drive a fresh completion wait.
      await this.run();
      return;
    }
    this.pump();
  }

  private resetPhaseForRetry(phaseId: string): void {
    const phase = this.getPhaseOrThrow(phaseId);
    phase.state = "pending";
    phase.progress = 0;
    phase.message = "";
    phase.error = undefined;
    phase.startedAt = undefined;
    phase.finishedAt = undefined;
    phase.durationMs = undefined;
  }

  private resetDependentsToPending(phaseId: string): void {
    for (const phase of this.state.phases) {
      if (phase.dependencies.includes(phaseId) && phase.state === "blocked") {
        this.resetPhaseForRetry(phase.id);
        this.resetDependentsToPending(phase.id);
      }
    }
  }

  // --- scheduling ---

  /**
   * Exactly zero or one boot phase may be active at any point in time
   * (spec §5) -- earlier versions started every currently-runnable phase
   * concurrently, which both violated the "strictly sequential" boot
   * requirement and made currentPhaseId ambiguous when several phases
   * started in the same pump() call.
   */
  private pump(): void {
    this.applyBlocking();

    if (this.active.size > 0) {
      this.publish();
      return;
    }

    const next = this.findNextRunnablePhase();

    if (next) {
      const promise = this.executePhase(next.id).finally(() => {
        this.active.delete(next.id);
        this.pump();
      });
      this.active.set(next.id, promise);
      this.publish();
      return;
    }

    this.publish();

    if (this.isFullyTerminal()) {
      this.resolveRun?.();
      this.resolveRun = null;
    }
  }

  private findNextRunnablePhase(): BootPhase | undefined {
    return this.state.phases.find(
      (phase) => phase.state === "pending" && !this.active.has(phase.id) && this.dependenciesSatisfied(phase)
    );
  }

  private dependenciesSatisfied(phase: BootPhase): boolean {
    return phase.dependencies.every((depId) => {
      const dep = this.getPhaseOrThrow(depId);
      return dep.state === "success" || dep.state === "warning" || dep.state === "skipped";
    });
  }

  private applyBlocking(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const phase of this.state.phases) {
        if (phase.state !== "pending") continue;
        const blockedBy = phase.dependencies.find((depId) => {
          const dep = this.getPhaseOrThrow(depId);
          return dep.state === "failed" || dep.state === "blocked";
        });
        if (blockedBy) {
          phase.state = "blocked";
          phase.message = `Blockiert durch fehlgeschlagene Abhängigkeit: ${blockedBy}`;
          phase.finishedAt = this.clock.now();
          changed = true;
        }
      }
    }
  }

  private isFullyTerminal(): boolean {
    return this.state.phases.every((phase) =>
      ["success", "warning", "failed", "blocked", "skipped"].includes(phase.state)
    );
  }

  // --- phase execution ---

  private async executePhase(phaseId: string): Promise<void> {
    const def = this.definitions.get(phaseId);
    if (!def) throw new Error(`Unknown boot phase: ${phaseId}`);
    const runner = this.runners[phaseId];
    if (!runner) throw new Error(`No runner registered for boot phase: ${phaseId}`);

    const phase = this.getPhaseOrThrow(phaseId);
    phase.state = "running";
    phase.startedAt = this.clock.now();
    this.state.currentPhaseId = phaseId;
    this.publish();

    // hardTimeoutMs is the phase's overall deadline, not a per-attempt budget —
    // otherwise a phase with several retries could run for retryCount x
    // hardTimeoutMs, which defeats the point of a "hard" timeout.
    const deadline = phase.startedAt + def.timeouts.hardTimeoutMs;

    let attempt = 0;
    for (;;) {
      const remainingMs = Math.max(0, deadline - this.clock.now());
      if (remainingMs === 0) {
        this.finalizePhase(phaseId, "failed", "Zeitüberschreitung: Phase hat das harte Timeout überschritten.", {
          code: "hard-timeout",
          message: "Zeitüberschreitung: Phase hat das harte Timeout überschritten.",
          retryAttempts: attempt
        });
        return;
      }

      const controller = new AbortController();
      let softFired = false;
      const softTimer = setTimeout(() => {
        softFired = true;
        this.appendLog(phaseId, {
          level: "warn",
          source: "desktop",
          event: "soft-timeout",
          message: `${def.label}: dauert länger als erwartet...`
        });
        this.publish();
      }, Math.min(def.timeouts.softTimeoutMs, remainingMs));
      const hardTimer = setTimeout(() => controller.abort(), remainingMs);

      const ctx: PhaseRunnerContext = {
        phaseId,
        attempt,
        signal: controller.signal,
        bootState: this.cloneState(),
        reportProgress: (progress, message) => {
          phase.progress = progress;
          if (message) phase.message = message;
          this.publish();
        },
        log: (entry) => this.appendLog(phaseId, entry)
      };

      const hardTimeoutPromise = new Promise<PhaseRunnerResult>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new BootHardTimeoutError()));
      });

      let result: PhaseRunnerResult | null = null;
      let failure: unknown = null;
      try {
        const runnerPromise = runner(ctx).catch((err) => {
          throw err;
        });
        void runnerPromise.catch(() => {
          /* swallow late rejection after this attempt already moved on */
        });
        result = await Promise.race([runnerPromise, hardTimeoutPromise]);
      } catch (err) {
        failure = err;
      } finally {
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
      }
      void softFired;

      if (result && result.outcome !== "failed") {
        this.finalizePhase(phaseId, result.outcome, result.message);
        return;
      }

      const bootError = this.toBootError(failure, result, attempt);
      const canRetry = attempt < def.timeouts.maxRetries;

      if (canRetry) {
        attempt += 1;
        phase.retryCount = attempt;
        phase.state = "retrying";
        phase.error = bootError;
        phase.message = bootError.message;
        this.appendLog(phaseId, {
          level: "warn",
          source: "desktop",
          event: "retry",
          message: `Retry ${attempt}/${def.timeouts.maxRetries}: ${bootError.message}`,
          retryNumber: attempt
        });
        this.publish();
        await this.clock.sleep(def.timeouts.retryDelayMs);
        phase.state = "running";
        this.publish();
        continue;
      }

      this.finalizePhase(phaseId, "failed", bootError.message, bootError);
      return;
    }
  }

  private toBootError(failure: unknown, result: PhaseRunnerResult | null, attempt: number): BootError {
    if (failure instanceof BootHardTimeoutError) {
      return {
        code: "hard-timeout",
        message: "Zeitüberschreitung: Phase hat das harte Timeout überschritten.",
        retryAttempts: attempt
      };
    }
    if (result && result.outcome === "failed") {
      return {
        code: result.error?.code ?? "phase-failed",
        message: result.message,
        technicalDetail: result.error?.technicalDetail,
        exitCode: result.error?.exitCode,
        stderrTail: result.error?.stderrTail,
        endpoint: result.error?.endpoint,
        port: result.error?.port,
        timeoutMs: result.error?.timeoutMs,
        retryAttempts: attempt
      };
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    return { code: "runner-exception", message, retryAttempts: attempt };
  }

  private finalizePhase(phaseId: string, outcome: PhaseRunnerOutcome, message: string, error?: BootError): void {
    const phase = this.getPhaseOrThrow(phaseId);
    phase.state = outcome;
    phase.message = message;
    phase.error = error;
    phase.finishedAt = this.clock.now();
    phase.durationMs = phase.startedAt ? phase.finishedAt - phase.startedAt : undefined;
    if (outcome === "success") phase.progress = 100;
    if (outcome === "failed") {
      this.state.lastErrorMessage = message;
      this.appendLog(phaseId, { level: "error", source: "desktop", event: "phase-failed", message });
    } else {
      this.appendLog(phaseId, { level: "info", source: "desktop", event: `phase-${outcome}`, message });
    }
    this.publish();
  }

  private finalizeRunStatus(): void {
    const mandatoryPhases = this.state.phases.filter((p) => !p.optional);
    const mandatoryBlocking = mandatoryPhases.some((p) => p.state === "failed" || p.state === "blocked");
    const optionalFailed = this.state.phases.some((p) => p.optional && (p.state === "failed" || p.state === "blocked"));

    let status: BootRunStatus;
    if (mandatoryBlocking) {
      status = "failed";
    } else if (optionalFailed) {
      status = "degraded";
    } else {
      status = "ready";
    }

    this.state.status = status;
    this.state.finishedAt = this.clock.now();
    this.state.currentPhaseId = null;
    this.state.overallProgress = this.computeOverallProgress();
    this.publish();
  }

  private computeOverallProgress(): number {
    if (this.state.phases.length === 0) return 100;
    const sum = this.state.phases.reduce((acc, phase) => {
      if (["success", "warning", "skipped"].includes(phase.state)) return acc + 100;
      if (phase.state === "failed" || phase.state === "blocked") return acc + 100;
      return acc + phase.progress;
    }, 0);
    return Math.round(sum / this.state.phases.length);
  }

  private appendLog(phaseId: string, entry: Omit<BootLogEntry, "timestamp" | "phaseId">): void {
    const phase = this.getPhaseOrThrow(phaseId);
    const logEntry: BootLogEntry = { ...entry, phaseId, timestamp: this.clock.now() };
    phase.details.push(logEntry);
  }

  private getPhaseOrThrow(phaseId: string): BootPhase {
    const phase = this.state.phases.find((p) => p.id === phaseId);
    if (!phase) throw new Error(`Unknown boot phase: ${phaseId}`);
    return phase;
  }

  private publish(): void {
    this.state.overallProgress = this.computeOverallProgress();
    const snapshot = this.cloneState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private cloneState(): BootState {
    return {
      ...this.state,
      phases: this.state.phases.map((phase) => ({ ...phase, details: [...phase.details] }))
    };
  }
}
