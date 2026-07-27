/**
 * P0 Phase 2: Stage-Specific Timeouts
 *
 * Separates cold-start, prompt evaluation, first token, stream idle, and generation.
 */

import type { RuntimeTimeoutPolicy } from "@dbzs/shared";

export interface TimeoutConfig {
  routing: number;      // Broker decision phase (local only)
  bootstrap: number;    // Runtime kernel bootstrap / process start
  context: number;      // Context building + orchestration
  transport: number;    // HTTP request send + first byte
  processStart: number;
  endpointReady: number;
  modelLoad: number;
  promptEval: number;
  firstToken: number;   // Time from HTTP send to first model token
  streamIdle: number;
  generation: number;
  warmup: number;       // Mini inference warm-up after endpoint ready
  total: number;        // Absolute cap
}

/**
 * Default timeouts for normal inference (local conservative defaults).
 */
export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  routing: 5_000,
  bootstrap: 30_000,
  context: 15_000,
  transport: 10_000,
  processStart: 30_000,
  endpointReady: 30_000,
  modelLoad: 180_000,
  promptEval: 90_000,
  firstToken: 90_000,
  streamIdle: 30_000,
  generation: 300_000,
  warmup: 90_000,
  total: 1_800_000
};

/**
 * Aggressive timeouts for quick turnarounds (e.g., completions)
 */
export const AGGRESSIVE_TIMEOUTS: TimeoutConfig = {
  routing: 3_000,
  bootstrap: 15_000,
  context: 5_000,
  transport: 5_000,
  processStart: 15_000,
  endpointReady: 15_000,
  modelLoad: 60_000,
  promptEval: 45_000,
  firstToken: 45_000,
  streamIdle: 15_000,
  generation: 120_000,
  warmup: 45_000,
  total: 300_000
};

/**
 * Extended timeouts for heavy workloads (e.g., code analysis)
 */
export const EXTENDED_TIMEOUTS: TimeoutConfig = {
  routing: 25_000,
  bootstrap: 45_000,
  context: 180_000,
  transport: 60_000,
  processStart: 60_000,
  endpointReady: 60_000,
  modelLoad: 300_000,
  promptEval: 180_000,
  firstToken: 180_000,
  streamIdle: 180_000,
  generation: 900_000,
  warmup: 180_000,
  total: 4_500_000
};

/**
 * Resident-slot profile: model already loaded — skip model-load budget only.
 * Do NOT clamp first-token / prompt-eval downward: large hybrid/F16 prompts
 * still need the user/settings budgets even when the process is warm.
 */
export function residentSlotTimeoutOverrides(): Partial<TimeoutConfig> {
  return {
    modelLoad: 0
  };
}

/**
 * Select timeout profile based on context
 */
export function selectTimeoutProfile(
  taskType?: string | null,
  contextSize?: number | null
): TimeoutConfig {
  if (
    taskType === "code_analysis" ||
    taskType === "refactor" ||
    taskType === "debug" ||
    taskType === "review" ||
    taskType === "debugging"
  ) {
    return { ...EXTENDED_TIMEOUTS };
  }

  if (taskType === "completion" || taskType === "quick_question") {
    return { ...AGGRESSIVE_TIMEOUTS };
  }

  if (contextSize && contextSize > 10_000) {
    return { ...EXTENDED_TIMEOUTS };
  }

  return { ...DEFAULT_TIMEOUTS };
}

/** Settings keys that override inference timeouts (values in seconds). */
export interface TimeoutSettingsOverrides {
  timeoutStreamIdleSeconds?: number | null;
  timeoutFirstTokenSeconds?: number | null;
  timeoutGenerationSeconds?: number | null;
  timeoutPromptEvalSeconds?: number | null;
  timeoutCpuSafeStreamIdleSeconds?: number | null;
  timeoutCpuSafeFirstTokenSeconds?: number | null;
  timeoutCpuSafeGenerationSeconds?: number | null;
}

const DEFAULT_CPU_SAFE_STREAM_IDLE_S = 270;
const DEFAULT_CPU_SAFE_FIRST_TOKEN_S = 270;
const DEFAULT_CPU_SAFE_GENERATION_S = 900;
const DEFAULT_CPU_SAFE_PROMPT_EVAL_S = 270;

function secondsToMs(seconds: number | null | undefined, fallbackSeconds: number): number {
  const value = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : fallbackSeconds;
  return Math.round(value * 1000);
}

/**
 * Apply user-editable base timeouts from AppSettings onto a profile config.
 */
export function applySettingsTimeoutOverrides(
  config: TimeoutConfig,
  settings?: TimeoutSettingsOverrides | null
): TimeoutConfig {
  if (!settings) {
    return { ...config };
  }
  const next = { ...config };
  if (typeof settings.timeoutStreamIdleSeconds === "number" && settings.timeoutStreamIdleSeconds > 0) {
    next.streamIdle = secondsToMs(settings.timeoutStreamIdleSeconds, next.streamIdle / 1000);
  }
  if (typeof settings.timeoutFirstTokenSeconds === "number" && settings.timeoutFirstTokenSeconds > 0) {
    next.firstToken = secondsToMs(settings.timeoutFirstTokenSeconds, next.firstToken / 1000);
  }
  if (typeof settings.timeoutGenerationSeconds === "number" && settings.timeoutGenerationSeconds > 0) {
    next.generation = secondsToMs(settings.timeoutGenerationSeconds, next.generation / 1000);
  }
  if (typeof settings.timeoutPromptEvalSeconds === "number" && settings.timeoutPromptEvalSeconds > 0) {
    next.promptEval = secondsToMs(settings.timeoutPromptEvalSeconds, next.promptEval / 1000);
  }
  return next;
}

/**
 * Raise timeouts for slow inference: cpu_safe (gpuLayers=0) or hybrid partial offload.
 */
export function applyCpuSafeTimeoutOverrides(
  config: TimeoutConfig,
  settings?: TimeoutSettingsOverrides | null
): TimeoutConfig {
  const next = { ...config };
  const streamIdle = secondsToMs(
    settings?.timeoutCpuSafeStreamIdleSeconds,
    DEFAULT_CPU_SAFE_STREAM_IDLE_S
  );
  const firstToken = secondsToMs(
    settings?.timeoutCpuSafeFirstTokenSeconds,
    DEFAULT_CPU_SAFE_FIRST_TOKEN_S
  );
  const generation = secondsToMs(
    settings?.timeoutCpuSafeGenerationSeconds,
    DEFAULT_CPU_SAFE_GENERATION_S
  );
  next.streamIdle = Math.max(next.streamIdle, streamIdle);
  next.firstToken = Math.max(next.firstToken, firstToken);
  next.generation = Math.max(next.generation, generation);
  // Slow backends need a long pre-token budget; never shrink via base prompt-eval settings.
  next.promptEval = Math.max(
    next.promptEval,
    secondsToMs(null, DEFAULT_CPU_SAFE_PROMPT_EVAL_S)
  );
  if (next.promptEval > next.firstToken) {
    next.firstToken = next.promptEval;
  }
  return next;
}

/** True when inference is expected to be slow (full CPU or thin GPU offload). */
export function shouldApplySlowInferenceTimeouts(gpuLayers: number | null | undefined): boolean {
  if (gpuLayers == null) {
    return false;
  }
  return gpuLayers <= 8;
}

export function toRuntimeTimeoutPolicy(config: TimeoutConfig): RuntimeTimeoutPolicy {
  return {
    processStartTimeoutMs: config.processStart,
    endpointReadyTimeoutMs: config.endpointReady,
    modelLoadTimeoutMs: config.modelLoad,
    promptEvalTimeoutMs: config.promptEval,
    firstTokenTimeoutMs: config.firstToken,
    streamIdleTimeoutMs: config.streamIdle,
    generationTimeoutMs: config.generation
  };
}

/**
 * Format timeout for error messages
 */
export function formatTimeout(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * Get timeout with logging/diagnostics
 */
export class TimeoutManager {
  config: TimeoutConfig;

  constructor(config?: Partial<TimeoutConfig>) {
    this.config = {
      ...DEFAULT_TIMEOUTS,
      ...config
    };
  }

  getRouting(): number {
    return this.config.routing;
  }

  getBootstrap(): number {
    return this.config.bootstrap;
  }

  getContext(): number {
    return this.config.context;
  }

  getTransport(): number {
    return this.config.transport;
  }

  getProcessStart(): number {
    return this.config.processStart;
  }

  getEndpointReady(): number {
    return this.config.endpointReady;
  }

  getModelLoad(): number {
    return this.config.modelLoad;
  }

  getPromptEval(): number {
    return this.config.promptEval;
  }

  getFirstToken(): number {
    return this.config.firstToken;
  }

  getStreamIdle(): number {
    return this.config.streamIdle;
  }

  getGeneration(): number {
    return this.config.generation;
  }

  getWarmup(): number {
    return this.config.warmup;
  }

  getTotal(): number {
    return this.config.total;
  }

  /**
   * Get summary for diagnostics
   */
  summary(): Record<string, string> {
    return {
      routing: formatTimeout(this.config.routing),
      bootstrap: formatTimeout(this.config.bootstrap),
      context: formatTimeout(this.config.context),
      transport: formatTimeout(this.config.transport),
      processStart: formatTimeout(this.config.processStart),
      endpointReady: formatTimeout(this.config.endpointReady),
      modelLoad: formatTimeout(this.config.modelLoad),
      promptEval: formatTimeout(this.config.promptEval),
      firstToken: formatTimeout(this.config.firstToken),
      streamIdle: formatTimeout(this.config.streamIdle),
      generation: formatTimeout(this.config.generation),
      warmup: formatTimeout(this.config.warmup),
      total: formatTimeout(this.config.total)
    };
  }
}
