import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, isIpcChannel } from "./bridgeContracts";

describe("bridgeContracts", () => {
  it("keeps IPC channel registry unique and searchable", () => {
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
    expect(isIpcChannel("dbzs:runtime:chat")).toBe(true);
    expect(isIpcChannel("dbzs:runtime:missing")).toBe(false);
  });
});
