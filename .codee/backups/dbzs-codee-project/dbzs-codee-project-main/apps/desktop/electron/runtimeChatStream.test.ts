import { afterEach, describe, expect, it, vi } from "vitest";
import { streamRuntimeChatViaBackend } from "./runtimeChatStream";

const request = {
  messages: [{ id: "user-1", role: "user" as const, content: "Hallo" }]
};

function responseFromChunks(chunks: string[], close = true): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (close) controller.close();
      }
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

describe("runtimeChatStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finalisiert beim done-Event sofort samt finish_reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      responseFromChunks([
        'data: {"type":"delta","content":"Hallo"}\n\n',
        'data: {"type":"done","model_id":"m","model_name":"M","finish_reason":"stop"}\n\n'
      ])
    ));
    await expect(streamRuntimeChatViaBackend("http://localhost", request, vi.fn()))
      .resolves.toMatchObject({
        message: { content: "Hallo" },
        finish_reason: "stop"
      });
  });

  it("behandelt sauberes EOF nach Content als Abschluss", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      responseFromChunks(['data: {"type":"delta","content":"Hallo"}\n\n'])
    ));
    await expect(streamRuntimeChatViaBackend("http://localhost", request, vi.fn()))
      .resolves.toMatchObject({ message: { content: "Hallo" }, finish_reason: "eof" });
  });

  it("weist EOF ohne Content und Finish zurück", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFromChunks([])));
    await expect(streamRuntimeChatViaBackend("http://localhost", request, vi.fn()))
      .rejects.toThrow("partial_output_stream_incomplete");
  });
});
