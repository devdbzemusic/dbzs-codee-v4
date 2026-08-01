import { describe, expect, it } from "vitest";
import {
  BRIDGE_REQUEST_IPC_CHANNELS,
  IPC_CHANNEL,
  IPC_CHANNELS,
  isIpcChannel
} from "./bridgeContracts";

describe("bridgeContracts", () => {
  it("keeps IPC channel registry unique and searchable", () => {
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
    expect(isIpcChannel(IPC_CHANNEL.runtimeChat)).toBe(true);
    expect(isIpcChannel("dbzs:runtime:missing")).toBe(false);
  });

  it("keeps request channels separate from one-way stream events", () => {
    expect(BRIDGE_REQUEST_IPC_CHANNELS).toContain(IPC_CHANNEL.runtimeChatStream);
    expect(BRIDGE_REQUEST_IPC_CHANNELS).toContain(IPC_CHANNEL.runtimeChatStreamCancel);
    expect(BRIDGE_REQUEST_IPC_CHANNELS).not.toContain(IPC_CHANNEL.runtimeChatStreamChunk);
  });
});
