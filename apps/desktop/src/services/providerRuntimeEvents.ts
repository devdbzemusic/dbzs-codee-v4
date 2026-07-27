/**
 * Normalized provider stream events + content-delta gate for first-token honesty.
 */

import {
  isGenericRuntimeErrorSentinel,
  looksLikeContextOverflowMessage
} from "@/services/runtimeRunFinalization";

export type ProviderErrorCode =
  | "context_overflow"
  | "model_unavailable"
  | "slot_busy"
  | "invalid_request"
  | "connection_failed"
  | "provider_internal_error"
  | "timeout";

export type ProviderErrorStage =
  | "request_validation"
  | "request_send"
  | "provider_processing"
  | "stream_open"
  | "stream_read";

export interface ProviderRuntimeError {
  kind: "provider_error";
  code: ProviderErrorCode;
  stage: ProviderErrorStage;
  userMessage: string;
  technicalDetail?: string;
  retryable: boolean;
  correlationId: string;
}

export type NormalizedProviderEvent =
  | { type: "content_delta"; text: string }
  | { type: "tool_call_delta"; payload: unknown }
  | { type: "finish"; finishReason?: string }
  | { type: "provider_error"; error: ProviderRuntimeError };

export function isModelContentDelta(
  text: string | null | undefined,
  meta?: { safeFallback?: boolean; providerError?: boolean | ProviderRuntimeError | null }
): boolean {
  if (meta?.safeFallback === true) return false;
  if (meta?.providerError) return false;
  const value = (text ?? "").trim();
  if (!value) return false;
  if (looksLikeContextOverflowMessage(value)) return false;
  if (isGenericRuntimeErrorSentinel(value)) return false;
  return true;
}

export function normalizeProviderStreamDelta(
  delta: string,
  meta?: { safeFallback?: boolean; providerError?: ProviderRuntimeError | null }
): NormalizedProviderEvent {
  if (meta?.providerError) {
    return { type: "provider_error", error: meta.providerError };
  }
  if (meta?.safeFallback || !isModelContentDelta(delta, meta)) {
    return {
      type: "provider_error",
      error: {
        kind: "provider_error",
        code: looksLikeContextOverflowMessage(delta) ? "context_overflow" : "provider_internal_error",
        stage: "stream_read",
        userMessage: delta.trim() || "Providerfehler ohne Modelldelta.",
        retryable: false,
        correlationId: "stream"
      }
    };
  }
  return { type: "content_delta", text: delta };
}

export function buildProviderRuntimeError(input: {
  code: ProviderErrorCode;
  stage?: ProviderErrorStage;
  userMessage: string;
  technicalDetail?: string;
  retryable?: boolean;
  correlationId: string;
}): ProviderRuntimeError {
  return {
    kind: "provider_error",
    code: input.code,
    stage: input.stage ?? "provider_processing",
    userMessage: input.userMessage,
    technicalDetail: input.technicalDetail,
    retryable: input.retryable ?? false,
    correlationId: input.correlationId
  };
}
