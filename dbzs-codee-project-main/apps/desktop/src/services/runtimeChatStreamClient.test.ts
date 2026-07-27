import { describe, expect, it, vi } from "vitest";
import { streamRuntimeChat } from "./runtimeChatStreamClient";

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    streamRuntimeChat: vi.fn(async (_request, onChunk) => {
      onChunk({ delta: "Hallo", totalLength: 5 });
      onChunk({ delta: " Welt", totalLength: 11 });
      return {
        message: { role: "assistant", content: "Hallo Welt" },
        model_id: "coder",
        model_name: "Coder"
      };
    })
  }
}));

describe("streamRuntimeChat", () => {
  it("delegates streaming to the backend bridge", async () => {
    const deltas: string[] = [];
    const response = await streamRuntimeChat(
      { messages: [{ id: "msg-test", role: "user", content: "Hi" }] },
      {
        onDelta: (chunk) => {
          deltas.push(chunk);
        }
      }
    );

    expect(deltas).toEqual(["Hallo", " Welt"]);
    expect(response.message.content).toBe("Hallo Welt");
  });
});

