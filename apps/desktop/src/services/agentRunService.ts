import type {
  RuntimeChatRequest,
  RuntimeChatResponse
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { streamRuntimeChat } from "@/services/runtimeChatStreamClient";

class AgentRunService {
  async sendChat(request: RuntimeChatRequest, signal?: AbortSignal): Promise<RuntimeChatResponse>;
  async sendChat(
    _agentId: string,
    request: RuntimeChatRequest,
    signal?: AbortSignal
  ): Promise<RuntimeChatResponse>;
  async sendChat(
    requestOrAgentId: RuntimeChatRequest | string,
    requestOrSignal?: RuntimeChatRequest | AbortSignal,
    maybeSignal?: AbortSignal
  ): Promise<RuntimeChatResponse> {
    const request =
      typeof requestOrAgentId === "string"
        ? (requestOrSignal as RuntimeChatRequest)
        : requestOrAgentId;
    const signal =
      typeof requestOrAgentId === "string"
        ? maybeSignal
        : (requestOrSignal as AbortSignal | undefined);
    return backendClient.sendRuntimeChat(request, signal);
  }

  async sendChatStream(
    request: RuntimeChatRequest,
    callbacks: import("@/services/runtimeChatStreamClient").RuntimeChatStreamCallbacks,
    signal?: AbortSignal
  ): Promise<RuntimeChatResponse> {
    // Use model_id from request (set by broker decision in store)
    // No legacy routing logic - rely on broker decision
    return streamRuntimeChat(request, callbacks, signal);
  }
}

export const agentRunService = new AgentRunService();
