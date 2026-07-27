import type { ToolError } from "@/runtime/tool/toolContracts";

export function normalizeToolError(error: unknown): ToolError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "TOOL_CANCELLED",
      message: "Tool execution was cancelled.",
      retryable: false
    };
  }

  if (error instanceof Error) {
    const message = error.message || "Tool execution failed.";
    if (/timed out|timeout/i.test(message)) {
      return {
        code: "TOOL_TIMEOUT",
        message,
        retryable: true
      };
    }

    if (/permission|denied|forbidden/i.test(message)) {
      return {
        code: "TOOL_PERMISSION_DENIED",
        message,
        retryable: false
      };
    }

    return {
      code: "TOOL_EXECUTION_ERROR",
      message,
      retryable: true
    };
  }

  return {
    code: "TOOL_UNKNOWN_ERROR",
    message: "Unknown tool error.",
    retryable: false
  };
}
