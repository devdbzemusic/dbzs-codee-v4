import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSlotStatus } from "@dbzs/shared";

const { getAllSlotsStatusMock, restartSlotMock } = vi.hoisted(() => ({
  getAllSlotsStatusMock: vi.fn(),
  restartSlotMock: vi.fn()
}));

vi.mock("@/services/runtimeSlotManager", () => ({
  runtimeSlotManager: {
    getAllSlotsStatus: getAllSlotsStatusMock,
    restartSlot: restartSlotMock
  }
}));

import {
  checkAndRecoverSlots,
  getAllSlotHealthStates,
  getSlotHealthState,
  resetRestartBudget,
  stopRuntimeProcessSupervisorForTests
} from "@/services/runtimeProcessSupervisor";

function status(overrides: Partial<RuntimeSlotStatus>): RuntimeSlotStatus {
  return {
    state: "stopped",
    provider: null,
    model_id: null,
    model_name: null,
    port: null,
    pid: null,
    endpoint: null,
    message: "",
    slot_id: "fast_gpu",
    device_policy: "auto",
    gpu_layers: null,
    context_size: null,
    chat_ready: false,
    ...overrides
  };
}

describe("runtimeProcessSupervisor", () => {
  beforeEach(() => {
    getAllSlotsStatusMock.mockReset();
    restartSlotMock.mockReset();
    restartSlotMock.mockResolvedValue({ success: true, slotId: "fast_gpu" });
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    stopRuntimeProcessSupervisorForTests();
    vi.useRealTimers();
  });

  it("does nothing for a slot that has never been observed running", async () => {
    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "error" })]);

    await checkAndRecoverSlots();

    expect(restartSlotMock).not.toHaveBeenCalled();
  });

  it("restarts a slot that crashed from a previously-running state", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" })
    ]);
    await checkAndRecoverSlots();

    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "error" })]);
    await checkAndRecoverSlots();

    expect(restartSlotMock).toHaveBeenCalledWith("fast_gpu", "coder.gguf");
    expect(getSlotHealthState("fast_gpu").lastKnownModelId).toBe("coder.gguf");
    expect(getSlotHealthState("fast_gpu").restartAttempts).toBe(1);
  });

  it("does not treat a deliberate stop (idle-eviction, manual stop) as a crash", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" })
    ]);
    await checkAndRecoverSlots();

    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "stopped" })]);
    await checkAndRecoverSlots();

    expect(restartSlotMock).not.toHaveBeenCalled();
    expect(getSlotHealthState("fast_gpu").lastKnownModelId).toBeNull();
  });

  it("stops attempting restarts once the budget is exhausted within the window", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" })
    ]);
    await checkAndRecoverSlots(0);

    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "error" })]);
    await checkAndRecoverSlots(1_000);
    await checkAndRecoverSlots(2_000);
    await checkAndRecoverSlots(3_000);
    await checkAndRecoverSlots(4_000);

    vi.setSystemTime(4_000);
    expect(restartSlotMock).toHaveBeenCalledTimes(3);
    expect(getSlotHealthState("fast_gpu").budgetExhausted).toBe(true);
  });

  it("resets the restart budget after the window elapses", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" })
    ]);
    await checkAndRecoverSlots(0);

    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "error" })]);
    await checkAndRecoverSlots(1_000);
    await checkAndRecoverSlots(2_000);
    await checkAndRecoverSlots(3_000);
    vi.setSystemTime(3_000);
    expect(getSlotHealthState("fast_gpu").budgetExhausted).toBe(true);

    const afterWindow = 1_000 + 6 * 60_000;
    await checkAndRecoverSlots(afterWindow);

    vi.setSystemTime(afterWindow);
    expect(restartSlotMock).toHaveBeenCalledTimes(4);
    expect(getSlotHealthState("fast_gpu").budgetExhausted).toBe(false);
  });

  it("allows resetRestartBudget to manually clear an exhausted budget", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" })
    ]);
    await checkAndRecoverSlots(0);

    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "error" })]);
    await checkAndRecoverSlots(1_000);
    await checkAndRecoverSlots(2_000);
    await checkAndRecoverSlots(3_000);
    vi.setSystemTime(3_000);
    expect(getSlotHealthState("fast_gpu").budgetExhausted).toBe(true);

    resetRestartBudget("fast_gpu");
    await checkAndRecoverSlots(3_500);

    expect(restartSlotMock).toHaveBeenCalledTimes(4);
  });

  it("tracks health state independently per slot", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" }),
      status({ slot_id: "vision_gpu", state: "error" })
    ]);
    await checkAndRecoverSlots();

    const states = getAllSlotHealthStates();
    const fastGpu = states.find((s) => s.slotId === "fast_gpu");
    const visionGpu = states.find((s) => s.slotId === "vision_gpu");
    expect(fastGpu?.lastKnownModelId).toBe("coder.gguf");
    expect(visionGpu?.lastKnownModelId).toBeNull();
  });

  it("swallows a failed restart attempt without throwing", async () => {
    getAllSlotsStatusMock.mockResolvedValue([
      status({ slot_id: "fast_gpu", state: "running", model_id: "coder.gguf" })
    ]);
    await checkAndRecoverSlots();

    restartSlotMock.mockRejectedValue(new Error("backend unreachable"));
    getAllSlotsStatusMock.mockResolvedValue([status({ slot_id: "fast_gpu", state: "error" })]);

    await expect(checkAndRecoverSlots()).resolves.toBeUndefined();
  });
});
