import { randomUUID } from "node:crypto";
import type { BootError, BootLogEntry, BootPhase, BootState, BootRunStatus } from "@dbzs/shared";
import { PHASE_WEIGHTS, type BootPhaseDefinition } from "./bootPhaseDefinitions.js";
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
  reportProgress: (progress: number, message?: string | null) => void;
  log: (entry: Omit<BootLogEntry, "timestamp" | "phaseId">) => void;
}

export type PhaseRunnerOutcome = "success" | "warning" | "pending" | "failed" | "skipped";

export interface PhaseRunnerResult {
  outcome: PhaseRunnerOutcome;
  message: string;
  /** Only meaningful for outcome:"pending" — current progress (0-100). */
  progress?: number;
  /** Only meaningful for outcome:"pending" — overrides the phase's default pollIntervalMs for this one poll. */
  pollAfterMs?: number;
  error?: Partial<BootError>;
  metadata?: Record<string, unknown> | null;
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

/**
 * Per-phase and global in-memory log caps (repair spec §18) -- an
 * unbounded `phase.details`/global log stream would grow for the entire
 * process lifetime otherwise (previously true: no cap existed at all).
 */
export const MAX_PHASE_LOG_ENTRIES = 500;
export const MAX_GLOBAL_LOG_ENTRIES = 5_000;

export class BootOrchestrator {
  private readonly definitions: Map<string, BootPhaseDefinition>;
  private readonly runners: Record<string, PhaseRunner>;
  private readonly clock: BootOrchestratorClock;
  private readonly listeners = new Set<(state: BootState) => void>();
  private readonly logListeners = new Set<(entry: BootLogEntry) => void>();
  private readonly active = new Map<string, Promise<void>>();
  /** Flat, global insertion-order view of every log entry still retained by some phase -- backs the MAX_GLOBAL_LOG_ENTRIES cap. */
  private readonly globalLogEntries: BootLogEntry[] = [];
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
   * Fires once per log entry as it's appended (both from internal phase
   * execution and ingestExternalLog()), independent of the in-memory caps
   * below -- an external subscriber (e.g. JSONL persistence) needs the full
   * stream even once old entries start getting evicted from `phase.details`.
   */
  onLogEntry(listener: (entry: BootLogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
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
    this.appendLog(phaseId, entry, entry.timestamp);
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

  /**
   * An optional dependency's "failed" outcome still counts as satisfied
   * (not just success/warning/skipped) -- an optional phase (e.g.
   * resident-model) blocks the splash only until it reaches SOME terminal
   * state, then the boot must proceed regardless of which one. Only a
   * mandatory dependency's failure withholds satisfaction (handled instead
   * by applyBlocking(), which turns the dependent "blocked").
   */
  private dependenciesSatisfied(phase: BootPhase): boolean {
    return phase.dependencies.every((depId) => {
      const dep = this.getPhaseOrThrow(depId);
      if (dep.optional) {
        return dep.state === "success" || dep.state === "warning" || dep.state === "skipped" || dep.state === "failed";
      }
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
          // An optional dependency's failure must never cascade-block --
          // only a genuinely stuck (already-blocked) optional dependency
          // does, since that means IT can never become terminal either.
          if (dep.optional) {
            return dep.state === "blocked";
          }
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
    // hardTimeoutMs, which defeats the point of a "hard" timeout. `deadline`
    // is mutable (not const) so a "pending" result with genuine progress can
    // extend it, bounded by originalDeadline + maxDeadlineExtensionMs.
    const originalDeadline = phase.startedAt + def.timeouts.hardTimeoutMs;
    let deadline = originalDeadline;
    let previousProgress = phase.progress;

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

      if (result && result.outcome === "pending") {
        // Not a failure -- the component is still initializing. pollCount is
        // tracked entirely separately from retryCount, so a slow-but-healthy
        // backend can never be cut short by a retry-count ceiling reached
        // long before its own hard timeout (the exact bug this replaces).
        phase.pollCount += 1;
        phase.state = "waiting";
        phase.message = result.message;

        if (typeof result.progress === "number" && Number.isFinite(result.progress)) {
          const clamped = Math.min(100, Math.max(0, Math.round(result.progress)));
          if (def.timeouts.extendDeadlineOnProgress && clamped > previousProgress) {
            deadline = Math.min(originalDeadline + def.timeouts.maxDeadlineExtensionMs, deadline + def.timeouts.pollIntervalMs);
          }
          previousProgress = clamped;
          phase.progress = clamped;
        }

        this.publish();
        await this.clock.sleep(result.pollAfterMs ?? def.timeouts.pollIntervalMs);
        phase.state = "running";
        this.publish();
        continue;
      }

      if (result && (result.outcome === "success" || result.outcome === "warning" || result.outcome === "skipped")) {
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

  /**
   * Weighted, not a flat average (spec §19) -- an instant phase like
   * desktop-process would otherwise count as much toward the bar as a
   * genuinely slow one like model-index or resident-model, making the
   * splash's progress jump unevenly relative to actual wall-clock time.
   */
  private computeOverallProgress(): number {
    if (this.state.phases.length === 0) return 100;
    let weightedSum = 0;
    let totalWeight = 0;
    for (const phase of this.state.phases) {
      const weight = PHASE_WEIGHTS[phase.id] ?? 1;
      totalWeight += weight;
      const isTerminalDone = ["success", "warning", "skipped", "failed", "blocked"].includes(phase.state);
      weightedSum += weight * (isTerminalDone ? 100 : phase.progress);
    }
    if (totalWeight === 0) return 100;
    return Math.round(weightedSum / totalWeight);
  }

  private appendLog(phaseId: string, entry: Omit<BootLogEntry, "timestamp" | "phaseId">, timestamp?: number): void {
    const phase = this.state.phases.find((p) => p.id === phaseId);
    if (!phase) return;
    const logEntry: BootLogEntry = { ...entry, phaseId, timestamp: timestamp ?? this.clock.now() };

    phase.details.push(logEntry);
    if (phase.details.length > MAX_PHASE_LOG_ENTRIES) {
      phase.details.splice(0, phase.details.length - MAX_PHASE_LOG_ENTRIES);
    }

    this.globalLogEntries.push(logEntry);
    if (this.globalLogEntries.length > MAX_GLOBAL_LOG_ENTRIES) {
      const dropped = this.globalLogEntries.splice(0, this.globalLogEntries.length - MAX_GLOBAL_LOG_ENTRIES);
      for (const droppedEntry of dropped) {
        const owner = this.state.phases.find((p) => p.id === droppedEntry.phaseId);
        if (!owner) continue;
        const idx = owner.details.indexOf(droppedEntry);
        if (idx !== -1) owner.details.splice(idx, 1);
      }
    }

    for (const listener of this.logListeners) {
      listener(logEntry);
    }
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
