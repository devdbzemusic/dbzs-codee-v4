/**
 * P0 Phase 3: Explicit Error Classification and Retry Policy
 *
 * Replaces implicit retry cascade with explicit error types and retry decisions.
 */

export type ChatErrorClass =
  | "transport"        // Connection/fetch errors (retryable)
  | "timeout"          // Timeout errors (not retryable)
  | "abort"            // User abort/cancel (not retryable)
  | "http_400_tools"   // HTTP 400 with tools (fallback to no tools)
  | "tool_protocol_incompatible"
  | "provider_context_rejected"
  | "vision_transport_unavailable"
  | "provider_request_rejected"
  | "http_4xx"         // Other HTTP 4xx (not retryable)
  | "http_5xx"         // HTTP 5xx (might be retryable, but circuit break instead)
  | "runtime_error"    // Runtime-specific errors (not retryable)
  | "unknown";         // Unknown errors (not retryable)

export interface ClassifiedError {
  class: ChatErrorClass;
  errorType: ChatErrorClass;
  message: string;
  shouldRetry: boolean;
  isRetryable: boolean;
  maxRetries: number;
  isAborted: boolean;
  isTimeout: boolean;
  httpStatus?: number | null;
  runtimeCode?: string | null;
  diagnosticId?: string | null;
  layer?: string | null;
  stage?: string | null;
  recommendedAction?: string | null;
}

export interface RuntimeBackendErrorDetail {
  code: string | null;
  message: string;
  recommendedAction: string | null;
  diagnosticId: string | null;
  layer: string | null;
  stage: string | null;
}

function classifiedError(
  errorClass: ChatErrorClass,
  message: string,
  shouldRetry: boolean,
  maxRetries: number,
  flags: {
    isAborted?: boolean;
    isTimeout?: boolean;
    httpStatus?: number | null;
    runtimeCode?: string | null;
    diagnosticId?: string | null;
    layer?: string | null;
    stage?: string | null;
    recommendedAction?: string | null;
  } = {}
): ClassifiedError {
  return {
    class: errorClass,
    errorType: errorClass,
    message,
    shouldRetry,
    isRetryable: shouldRetry,
    maxRetries,
    isAborted: flags.isAborted ?? false,
    isTimeout: flags.isTimeout ?? false,
    httpStatus: flags.httpStatus,
    runtimeCode: flags.runtimeCode ?? null,
    diagnosticId: flags.diagnosticId ?? null,
    layer: flags.layer ?? null,
    stage: flags.stage ?? null,
    recommendedAction: flags.recommendedAction ?? null
  };
}

function errorMessageFromUnknown(error: unknown): string {
  const errorLike = error as { message?: unknown };
  return typeof errorLike?.message === "string" ? errorLike.message : String(error);
}

function firstRegexGroup(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match?.[1]?.trim() || null;
}

function normalizeBackendDetailMessage(raw: string): string {
  return raw
    .replace(/\s*\[[a-z0-9_:-]+\]\s*/i, " ")
    .replace(/\s+Diagnose-ID:\s*\S+/i, " ")
    .replace(/\s+Layer:\s*[^|]+?(?=\s+Stage:|\s+Empfehlung:|$)/i, " ")
    .replace(/\s+Stage:\s*[^|]+?(?=\s+Empfehlung:|$)/i, " ")
    .replace(/\s+Empfehlung:\s*.+$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractRuntimeBackendErrorDetail(error: unknown): RuntimeBackendErrorDetail | null {
  const errorMessage = errorMessageFromUnknown(error);
  const payloadStart = errorMessage.indexOf("| {");
  if (payloadStart >= 0) {
    try {
      const parsed = JSON.parse(errorMessage.slice(payloadStart + 2).trim()) as {
        detail?: string | {
          code?: unknown;
          message?: unknown;
          recommendedAction?: unknown;
          diagnosticContext?: Record<string, unknown>;
        };
      };
      if (parsed.detail && typeof parsed.detail === "object") {
        const diagnostics = parsed.detail.diagnosticContext ?? {};
        return {
          code: typeof parsed.detail.code === "string" ? parsed.detail.code : null,
          message: typeof parsed.detail.message === "string" ? parsed.detail.message : errorMessage,
          recommendedAction:
            typeof parsed.detail.recommendedAction === "string" ? parsed.detail.recommendedAction : null,
          diagnosticId:
            typeof diagnostics.requestId === "string"
              ? diagnostics.requestId
              : typeof diagnostics.correlationId === "string"
                ? diagnostics.correlationId
                : null,
          layer: typeof diagnostics.source === "string" ? diagnostics.source : null,
          stage: typeof diagnostics.stage === "string" ? diagnostics.stage : null
        };
      }
    } catch {
      // Fall through to the compact Electron error format below.
    }
  }

  if (!errorMessage.includes("Backend request failed:")) {
    return null;
  }

  const compactDetail = errorMessage.split(" | ").slice(1).join(" | ").trim();
  if (!compactDetail) {
    return null;
  }

  return {
    code: firstRegexGroup(compactDetail, /\[([a-z0-9_:-]+)\]/i),
    message: normalizeBackendDetailMessage(compactDetail) || compactDetail,
    recommendedAction: firstRegexGroup(compactDetail, /Empfehlung:\s*(.+)$/i),
    diagnosticId: firstRegexGroup(compactDetail, /Diagnose-ID:\s*(\S+)/i),
    layer: firstRegexGroup(compactDetail, /Layer:\s*([^|]+?)(?=\s+Stage:|\s+Empfehlung:|$)/i),
    stage: firstRegexGroup(compactDetail, /Stage:\s*([^|]+?)(?=\s+Empfehlung:|$)/i)
  };
}

/**
 * Classify a runtime chat error
 */
export function classifyRuntimeChatError(error: unknown): ClassifiedError {
  if (!error) {
    return classifiedError("unknown", "Unbekannter Fehler", false, 0);
  }

  const errorLike = error as { message?: unknown; name?: unknown };
  const errorMessage = typeof errorLike.message === "string" ? errorLike.message : String(error);
  const errorName = typeof errorLike.name === "string" ? errorLike.name : "";
  const backendDetail = extractRuntimeBackendErrorDetail(error);
  if (backendDetail?.code) {
    const flags = {
      runtimeCode: backendDetail.code,
      diagnosticId: backendDetail.diagnosticId,
      layer: backendDetail.layer,
      stage: backendDetail.stage,
      recommendedAction: backendDetail.recommendedAction
    };
    switch (backendDetail.code) {
      case "request_cancelled":
        return classifiedError("abort", backendDetail.message, false, 0, { ...flags, isAborted: true });
      case "request_timeout":
      case "provider_timeout":
        return classifiedError("timeout", backendDetail.message, false, 0, { ...flags, isTimeout: true });
      case "backend_unavailable":
        return classifiedError("transport", backendDetail.message, true, 1, flags);
      case "provider_template_error":
      case "model_not_ready":
      case "invalid_response":
      case "provider_request_failed":
      default:
        return classifiedError("runtime_error", backendDetail.message, false, 0, flags);
    }
  }

  // Abort errors: user cancelled or timeout via AbortSignal
  if (errorName === "AbortError" || errorMessage === "aborted" || /\baborted\b/i.test(errorMessage)) {
    return classifiedError("abort", "Anfrage abgebrochen", false, 0, { isAborted: true });
  }

  // Timeout errors (explicit First-Token-Timeout or Gesamt-Timeout)
  if (
    errorMessage.includes("First-Token-Timeout") ||
    errorMessage.includes("Timeout") ||
    errorMessage.includes("timeout")
  ) {
    return classifiedError("timeout", errorMessage, false, 0, { isTimeout: true });
  }

  if (
    errorMessage.includes("tool_protocol_incompatible") ||
    /tools? .*nicht unterst[üu]tzt/i.test(errorMessage)
  ) {
    return classifiedError(
      "tool_protocol_incompatible",
      "Tool-Protokoll ist mit diesem Runtime-Modell nicht kompatibel.",
      false,
      0,
      { httpStatus: 400 }
    );
  }

  if (
    errorMessage.includes("provider_context_rejected") ||
    errorMessage.includes("context_budget_exceeded") ||
    /ohne tools oder mit weniger kontext/i.test(errorMessage)
  ) {
    return classifiedError(
      "provider_context_rejected",
      "Runtime hat den Request wegen Kontext-/Toolbudget abgelehnt.",
      false,
      0,
      { httpStatus: 400 }
    );
  }

  if (errorMessage.includes("vision_transport_unavailable")) {
    return classifiedError(
      "vision_transport_unavailable",
      "Der aktuelle Runtime-Chat-Transport kann Bildpayloads fuer diesen Turn noch nicht senden.",
      false,
      0,
      { httpStatus: 400 }
    );
  }

  if (errorMessage.includes("provider_request_rejected") || errorMessage.includes("request_body_too_large")) {
    return classifiedError(
      "provider_request_rejected",
      "Runtime hat den Request wegen Requestgröße oder Protokollform abgelehnt.",
      false,
      0,
      { httpStatus: 400 }
    );
  }

  // HTTP 400 with tools (can retry without tools)
  if (errorMessage.includes("HTTP Error 400") || errorMessage.includes("400")) {
    return classifiedError("http_400_tools", "HTTP 400: Tools nicht unterstützt", true, 1, { httpStatus: 400 });
  }

  // HTTP 4xx (not retryable)
  if (errorMessage.includes("HTTP Error 4")) {
    return classifiedError("http_4xx", errorMessage, false, 0);
  }

  // HTTP 5xx (not retryable via cascade; circuit breaker instead)
  if (errorMessage.includes("HTTP Error 5") || /^HTTP 5\d\d\b/.test(errorMessage)) {
    const status = Number(errorMessage.match(/5\d\d/)?.[0] ?? 500);
    return classifiedError("http_5xx", errorMessage, false, 0, { httpStatus: status });
  }

  if (errorMessage.includes("Server error")) {
    return classifiedError("http_5xx", errorMessage, true, 1, { httpStatus: 503 });
  }

  // Transport errors: ECONNREFUSED, ECONNRESET, fetch failed, etc.
  if (
    errorMessage.includes("fetch failed") ||
    errorMessage.includes("Failed to fetch") ||
    errorMessage.includes("Network error") ||
    errorMessage.includes("ECONNREFUSED") ||
    errorMessage.includes("ECONNRESET") ||
    errorMessage.includes("EPIPE") ||
    errorMessage.includes("Connection") ||
    errorMessage.includes("connection")
  ) {
    return classifiedError("transport", errorMessage, true, 1);
  }

  // Runtime-specific errors
  if (
    errorMessage.includes("Runtime") ||
    errorMessage.includes("runtime") ||
    errorMessage.includes("Model") ||
    errorMessage.includes("model")
  ) {
    return classifiedError("runtime_error", errorMessage, false, 0);
  }

  // Default: unknown, not retryable
  return classifiedError("unknown", errorMessage, false, 0);
}

/**
 * Determine if an error is likely a transport error (for old code compatibility)
 */
export function isTransientChatTransportError(error: unknown): boolean {
  const classified = classifyRuntimeChatError(error);
  return classified.class === "transport";
}

/**
 * Determine if a signal was aborted
 */
export function wasSignalAborted(signal: AbortSignal, error: unknown): boolean {
  const classified = classifyRuntimeChatError(error);
  return classified.isAborted || signal.aborted;
}

/**
 * Format error for user display
 */
export function formatChatErrorForUser(error: unknown): string {
  const classified = classifyRuntimeChatError(error);
  if (classified.runtimeCode) {
    const parts = [`Runtime-Fehler [${classified.runtimeCode}]: ${classified.message}`];
    if (classified.diagnosticId) {
      parts.push(`Diagnose-ID: ${classified.diagnosticId}`);
    }
    if (classified.layer || classified.stage) {
      parts.push(`Layer: ${[classified.layer, classified.stage].filter(Boolean).join(" / ")}`);
    }
    if (classified.recommendedAction) {
      parts.push(`Nächster Schritt: ${classified.recommendedAction}`);
    }
    return parts.join(" · ");
  }

  switch (classified.class) {
    case "transport":
      return "Verbindung zum Backend war unterbrochen. Bitte Nachricht erneut senden.";
    case "timeout":
      return "Die Anfrage hat zu lange gedauert. Bitte kürzer formulieren oder erneut versuchen.";
    case "abort":
      return "Anfrage wurde abgebrochen.";
    case "http_400_tools":
      return "Die Tools werden vom Runtime nicht unterstützt. Bitte ohne Tools erneut versuchen.";
    case "tool_protocol_incompatible":
      return "Das aktuelle Modell passt nicht zum Tool-Protokoll. Bitte kompatibles Modell oder weniger Tools verwenden.";
    case "provider_context_rejected":
      return "Die Anfrage war für das aktuelle Kontextfenster zu groß. Bitte weniger Kontext oder weniger Tools verwenden.";
    case "provider_request_rejected":
      return "Die Anfrage wurde vor der Ausführung wegen Größe oder Protokollform abgelehnt.";
    case "http_4xx":
      return `Anfrage abgelehnt: ${classified.message}`;
    case "http_5xx":
      return "Runtime antwortet nicht stabil. Bitte später erneut versuchen.";
    case "runtime_error":
      return `Runtime-Fehler: ${classified.message}`;
    default:
      return `Fehler: ${classified.message}`;
  }
}
