/**
 * P2 Phase 6: Runtime Routing Diagnostics
 * 
 * Tracks routing decision metadata for UI display and debugging.
 * Shows task_type → agent → slot → model decision flow.
 */

import type { ModelTargetAgent, RuntimeWarmupDiagnostics } from "@dbzs/shared";
export type { RuntimeWarmupDiagnostics } from "@dbzs/shared";

export type TimeoutStage = "routing" | "bootstrap" | "context" | "firstToken" | "total";

export interface RoutingDecision {
  /** When the decision was made (ISO timestamp) */
  decidedAt: string;
  
  /** Task classification (coding, chat, debug, etc.) */
  taskType: string;
  
  /** Selected agent target */
  targetAgent: ModelTargetAgent;
  
  /** Selected slot ID (fast_gpu, quality_cpu, etc.) */
  slotId: string;
  
  /** Selected model ID */
  modelId: string | null;
  
  /** Model display name */
  modelName: string | null;
  
  /** Why this routing was chosen */
  reason: string;

  /** How the model was selected */
  source: "role_setting" | "automatic" | "fallback" | "resident_continue" | "explicit_fallback";
  
  /** Currently active timeout stage */
  timeoutStage?: TimeoutStage;
  
  /** Timeout duration for current stage (ms) */
  timeoutDuration?: number;

  /** Active rollout stage label (legacy-0, canary-5, ...). */
  rolloutStage?: string;

  /** Effective routing path used for this run. */
  routingPath?: "broker" | "legacy";

  /** Configured canary percentage. */
  canaryPercent?: number;

  /** Shadow mode enabled for comparison logs. */
  shadowMode?: boolean;

  /** Shadow match state if available. */
  shadowMatch?: boolean | null;

  /** Whether mismatch should hard-stop current request. */
  stopOnShadowMismatch?: boolean;
}

export interface FallbackRejectionInfo {
  modelId: string;
  modelName: string;
  reason: string;
}

export interface RoutingDiagnostics {
  /** Current routing decision */
  decision: RoutingDecision | null;
  
  /** Pre-flight validation results */
  validation: {
    slotReady: boolean;
    slotMessage?: string;
    memoryAvailable: boolean;
    memoryMessage?: string;
    canStart: boolean;
  };
  
  /** Error classification if request failed */
  errorClassification?: {
    errorType: string;
    errorMessage: string;
    retryable: boolean;
    retryCount: number;
  };

  /** Detailed diagnostics if model warm-up failed. */
  warmup?: RuntimeWarmupDiagnostics;

  /** Set if a resident model was available but not used as a fallback. */
  fallbackRejection?: FallbackRejectionInfo;
}
