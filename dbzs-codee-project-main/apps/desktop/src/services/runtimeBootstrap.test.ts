import { beforeEach, describe, expect, it, vi } from "vitest";

const startSlotMock = vi.fn();
const stopSlotMock = vi.fn();
const getSlotStatusMock = vi.fn();
const waitForSlotReadyMock = vi.fn();
const resolveModelIdMock = vi.fn();
const isSlotReadyMock = vi.fn();

vi.mock("@/services/runtimeSlotManager", () => ({
  runtimeSlotManager: {
    startSlot: (...args: unknown[]) => startSlotMock(...args),
    stopSlot: (...args: unknown[]) => stopSlotMock(...args),
    getSlotStatus: (...args: unknown[]) => getSlotStatusMock(...args),
    waitForSlotReady: (...args: unknown[]) => waitForSlotReadyMock(...args),
    resolveModelId: (...args: unknown[]) => resolveModelIdMock(...args),
    isSlotReady: (...args: unknown[]) => isSlotReadyMock(...args)
  }
}));

vi.mock("@/services/approvalHub", () => ({
  approvalHub: { requestToolApproval: vi.fn() }
}));

vi.mock("@/services/mcp/mcpClient", () => ({
  createDefaultMcpClient: () => ({}),
  bootstrapMockMcpTools: vi.fn()
}));

vi.mock("@/services/runtimeKernelService", () => ({
  ensureRuntimeKernelInitialized: vi.fn(),
  registerRuntimeToolProvider: vi.fn(),
  setRuntimeToolApprovalCallback: vi.fn()
}));

describe("RuntimeBootstrapService lazy defaults", () => {
  beforeEach(() => {
    startSlotMock.mockReset();
    stopSlotMock.mockReset();
    getSlotStatusMock.mockReset();
    waitForSlotReadyMock.mockReset();
    resolveModelIdMock.mockReset();
    isSlotReadyMock.mockReset();
    resolveModelIdMock.mockImplementation(async (id: string) => id);
    vi.resetModules();
  });

  it("defaults autoStartOnBoot to false and startAll is a no-op", async () => {
    const { RuntimeBootstrapService, DEFAULT_BOOTSTRAP_CONFIG } = await import("./runtimeBootstrap");
    expect(DEFAULT_BOOTSTRAP_CONFIG.autoStartOnBoot).toBe(false);

    const service = new RuntimeBootstrapService();
    const status = await service.startAll();
    expect(status.state).toBe("idle");
    expect(status.error).toMatch(/Lazy Runtime Loading/i);
    expect(startSlotMock).not.toHaveBeenCalled();
  });

  it("preloadSelectedRuntime starts exactly one slot on demand", async () => {
    const { RuntimeBootstrapService } = await import("./runtimeBootstrap");
    getSlotStatusMock.mockResolvedValue({ state: "stopped", model_id: null });
    isSlotReadyMock.mockReturnValue(false);
    startSlotMock.mockResolvedValue({ success: true, slotId: "quality_cpu" });
    waitForSlotReadyMock.mockResolvedValue({
      state: "running",
      model_id: "chat-model",
      port: 8081
    });

    const service = new RuntimeBootstrapService();
    const result = await service.preloadSelectedRuntime("quality_cpu", "chat-model");

    expect(startSlotMock).toHaveBeenCalledTimes(1);
    expect(startSlotMock).toHaveBeenCalledWith("quality_cpu", "chat-model");
    expect(result.ready).toBe(true);
    expect(result.modelId).toBe("chat-model");
  });
});
