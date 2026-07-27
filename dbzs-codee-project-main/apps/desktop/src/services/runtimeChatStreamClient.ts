import type { RuntimeChatMessage, RuntimeChatRequest, RuntimeChatResponse } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

export interface RuntimeChatStreamCallbacks {
  onDelta: (content: string, totalLength: number) => void;
  onDone?: (meta: { model_id: string | null; model_name: string | null }) => void;
}

export async function streamRuntimeChat(
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
): Promise<RuntimeChatResponse> {
  return backendClient.streamRuntimeChat(request, (payload: { delta: string; totalLength: number }) => {
    callbacks.onDelta(payload.delta, payload.totalLength);
  }, signal).then((response) => {
    callbacks.onDone?.({
      model_id: response.model_id,
      model_name: response.model_name
    });
    return response;
  });
}

export async function streamOllamaChat(
  baseUrl: string,
  modelName: string,
  request: RuntimeChatRequest,
  callbacks: RuntimeChatStreamCallbacks,
  signal?: AbortSignal
): Promise<RuntimeChatResponse> {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  let lastToolCalls: unknown[] | undefined;
  const response = await fetch(`${normalizedBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      messages: request.messages,
      stream: true,
      tools: request.tools?.definitions ?? undefined,
      options: { temperature: request.temperature ?? 0.2 }
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Ollama-Streaming fehlgeschlagen (${response.status}).`);
  }

  if (!response.body) {
    throw new Error("Ollama-Streaming ohne Body erhalten.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const payload = JSON.parse(trimmed) as {
          message?: { content?: string; tool_calls?: unknown[] };
          done?: boolean;
          model?: string;
        };
        const chunk = payload.message?.content;
        if (payload.message?.tool_calls) {
          lastToolCalls = payload.message.tool_calls;
        }
        if (chunk) {
          fullContent += chunk;
          callbacks.onDelta(chunk, fullContent.length);
        }
        if (payload.done) {
          callbacks.onDone?.({ model_id: `ollama:${modelName}`, model_name: payload.model ?? modelName });
        }
      } catch {
        // Ignore malformed NDJSON lines.
      }
    }
  }

  return {
    message: { role: "assistant", content: fullContent, toolCalls: lastToolCalls } as RuntimeChatMessage,
    model_id: `ollama:${modelName}`,
    model_name: modelName
  };
}
