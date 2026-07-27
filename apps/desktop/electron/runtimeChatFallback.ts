import type { RuntimeChatRequest } from "@dbzs/shared";

export function buildToolFreeRuntimeChatFallbackRequest(
  request: RuntimeChatRequest
): RuntimeChatRequest {
  return {
    ...request,
    tools: null,
  };
}

export function shouldDisableNonStreamFallbackForRequest(
  request: RuntimeChatRequest
): boolean {
  const tools = request.tools;
  if (!tools) {
    return true;
  }

  const definitions = "definitions" in tools && Array.isArray(tools.definitions)
    ? tools.definitions
    : [];

  return definitions.length === 0;
}
