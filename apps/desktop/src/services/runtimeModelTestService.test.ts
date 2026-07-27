import { beforeEach, describe, expect, it, vi } from "vitest";
import { runClientModelTest } from "./runtimeModelTestService";

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    getRuntimeStatus: vi.fn(),
    sendRuntimeChat: vi.fn()
  }
}));

vi.mock("@/services/runtimeChatStreamClient", () => ({
  streamRuntimeChat: vi.fn()
}));

import { backendClient } from "@/services/backendClient";
import { streamRuntimeChat } from "@/services/runtimeChatStreamClient";

describe("runClientModelTest", () => {
  beforeEach(() => {
    vi.mocked(backendClient.getRuntimeStatus).mockReset();
    vi.mocked(backendClient.sendRuntimeChat).mockReset();
    vi.mocked(streamRuntimeChat).mockReset();
  });

  it("fails when runtime is stopped", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue({
      state: "stopped",
      provider: null,
      model_id: null,
      model_name: null,
      port: null,
      pid: null,
      endpoint: null,
      message: "Runtime stopped."
    });

    const report = await runClientModelTest();

    expect(report.overall).toBe("fail");
    expect(report.steps[0]?.id).toBe("runtime-status");
  });

  it("runs chat and stream checks when runtime is active", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue({
      state: "running",
      provider: "llama.cpp",
      model_id: "coder",
      model_name: "Coder",
      port: 8091,
      pid: 42,
      endpoint: "http://127.0.0.1:8091",
      message: "ok"
    });
    vi.mocked(backendClient.sendRuntimeChat).mockResolvedValue({
      message: { id: "msg-test", role: "assistant", content: "OK" },
      model_id: "coder",
      model_name: "Coder"
    });
    vi.mocked(streamRuntimeChat).mockImplementation(async (_request, callbacks) => {
      callbacks.onDelta("OK", 2);
      return {
        message: { id: "msg-test", role: "assistant", content: "OK" },
        model_id: "coder",
        model_name: "Coder"
      };
    });

    const report = await runClientModelTest();

    expect(report.overall).toBe("pass");
    expect(report.steps.map((entry) => entry.id)).toEqual(["runtime-status", "chat-complete", "chat-stream"]);
  });
});

