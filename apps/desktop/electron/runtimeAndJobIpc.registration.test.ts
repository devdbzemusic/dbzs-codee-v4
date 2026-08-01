import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { IPC_CHANNEL } from "@dbzs/shared";
import { registerRuntimeAndJobIpcHandlers } from "./runtimeAndJobIpc";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn()
  }
}));

const runtimeBridgeHandlerChannels = [
  IPC_CHANNEL.modelsIndex,
  IPC_CHANNEL.runtimeStatus,
  IPC_CHANNEL.runtimeStart,
  IPC_CHANNEL.runtimeStop,
  IPC_CHANNEL.runtimeChat,
  IPC_CHANNEL.runtimeChatCancel,
  IPC_CHANNEL.runtimeChatStream,
  IPC_CHANNEL.runtimeChatStreamCancel
] as const;

function registerHandlers(): void {
  registerRuntimeAndJobIpcHandlers({
    backendUrl: "http://127.0.0.1:8876",
    requestBackend: vi.fn(),
    isAbortError: () => false,
    isRuntimeContextOverflowError: () => false,
    isRuntimeToolPayloadError: () => false,
    buildRuntimeContextOverflowResponse: () => ({
      message: { id: "fallback", role: "assistant", content: "" },
      model_id: null,
      model_name: null,
      safe_fallback: true,
      provider_error: {
        kind: "provider_error",
        code: "context_overflow",
        stage: "runtime",
        userMessage: "",
        retryable: false,
        correlationId: "test"
      }
    }),
    buildRuntimeChatSafeResponse: () => ({
      message: { id: "safe", role: "assistant", content: "" },
      model_id: null,
      model_name: null,
      safe_fallback: true,
      provider_error: {
        kind: "provider_error",
        code: "provider_internal_error",
        stage: "runtime",
        userMessage: "",
        retryable: true,
        correlationId: "test"
      }
    })
  });
}

describe("registerRuntimeAndJobIpcHandlers", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it("registers every runtime bridge request channel exactly once", () => {
    registerHandlers();

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);

    for (const channel of runtimeBridgeHandlerChannels) {
      expect(channels.filter((registered) => registered === channel)).toHaveLength(1);
    }
  });

  it("does not register the stream chunk event as invoke handler", () => {
    registerHandlers();

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);

    expect(channels).not.toContain(IPC_CHANNEL.runtimeChatStreamChunk);
  });
});
