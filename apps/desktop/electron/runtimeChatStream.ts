import type { RuntimeChatRequest, RuntimeChatResponse } from "@dbzs/shared";

type StreamEvent =
  | { type: "delta"; content: string }
  | {
      type: "done";
      model_id: string | null;
      model_name: string | null;
      finish_reason?: string | null;
      prompt_tokens?: number | null;
      completion_tokens?: number | null;
    }
  | { type: "error"; message: string };

export function parseSseEvents(buffer: string): { events: StreamEvent[]; remainder: string } {
  const events: StreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    const dataLines = part
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
      continue;
    }

    try {
      events.push(JSON.parse(dataLines.join("\n")) as StreamEvent);
    } catch {
      // Ignore malformed SSE chunks.
    }
  }

  return { events, remainder };
}

export async function streamRuntimeChatViaBackend(
  backendUrl: string,
  request: RuntimeChatRequest,
  onChunk: (payload: { delta: string; totalLength: number }) => void,
  signal?: AbortSignal
): Promise<RuntimeChatResponse> {
  const response = await fetch(`${backendUrl}/runtime/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok) {
    let detail = `Streaming-Anfrage fehlgeschlagen (${response.status}).`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      try {
        const text = await response.text();
        if (text.trim()) {
          detail = text.trim();
        }
      } catch {
        // Keep default message.
      }
    }
    throw new Error(detail);
  }

  if (!response.body) {
    throw new Error("Streaming-Antwort ohne Body erhalten.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let modelId: string | null = null;
  let modelName: string | null = null;
  let finishReason: string | null = null;
  let sawDoneEvent = false;
  const abortReader = () => {
    void reader.cancel().catch(() => undefined);
  };

  if (signal?.aborted) {
    abortReader();
    throw new Error("aborted");
  }

  signal?.addEventListener("abort", abortReader, { once: true });

  try {
    streamLoop: while (true) {
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.remainder;

      for (const event of parsed.events) {
        if (signal?.aborted) {
          throw new Error("aborted");
        }

        if (event.type === "delta") {
          fullContent += event.content;
          onChunk({ delta: event.content, totalLength: fullContent.length });
        } else if (event.type === "done") {
          modelId = event.model_id;
          modelName = event.model_name;
          finishReason = event.finish_reason ?? "stop";
          sawDoneEvent = true;
          await reader.cancel().catch(() => undefined);
          break streamLoop;
        } else if (event.type === "error") {
          const error = new Error(event.message);
          error.name = "RuntimeStreamProviderError";
          throw error;
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }

  if (!sawDoneEvent) {
    if (!fullContent) {
      throw new Error("partial_output_stream_incomplete: Stream endete ohne Inhalt und Finish-Event.");
    }
    finishReason = "eof";
  }

  return {
    message: { id: `msg-${Date.now().toString(36)}-stream`, role: "assistant", content: fullContent },
    model_id: modelId,
    model_name: modelName,
    finish_reason: finishReason
  };
}

