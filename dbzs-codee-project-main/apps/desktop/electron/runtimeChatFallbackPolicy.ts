export interface RuntimeStreamErrorMeta {
  isAbort: boolean;
  isTimeout: boolean;
  isContextOverflow: boolean;
  isTransport: boolean;
  isToolError: boolean;
  isProviderStreamError: boolean;
}

export function classifyRuntimeStreamError(error: unknown): RuntimeStreamErrorMeta {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  const name = error instanceof Error ? error.name : "";

  return {
    isAbort: name === "AbortError" || lower.includes("aborted"),
    isTimeout: lower.includes("timeout"),
    isContextOverflow:
      lower.includes("exceeds the available context size") ||
      lower.includes("context size") ||
      lower.includes("n_ctx") ||
      lower.includes("too many tokens"),
    isTransport:
      lower.includes("fetch failed") ||
      lower.includes("econnrefused") ||
      lower.includes("econnreset"),
    isToolError:
      message.includes("HTTP Error 400") ||
      message.includes("llama-server request failed"),
    isProviderStreamError: name === "RuntimeStreamProviderError",
  };
}

export function shouldAttemptNonStreamFallback(meta: RuntimeStreamErrorMeta): boolean {
  if (meta.isAbort || meta.isTimeout || meta.isContextOverflow || meta.isProviderStreamError) {
    return false;
  }

  return meta.isTransport || meta.isToolError;
}
