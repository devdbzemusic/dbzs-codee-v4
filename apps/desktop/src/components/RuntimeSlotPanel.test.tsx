import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeSlotPanel } from "./RuntimeSlotPanel";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getAllSlotsStatusMock = vi.fn();
const isSlotReadyMock = vi.fn((status: any) => status?.state === "running" && status?.chat_ready === true);
const startSlotMock = vi.fn().mockResolvedValue({ success: true, slotId: "fast_gpu" });
const stopSlotMock = vi.fn().mockResolvedValue({ success: true, slotId: "fast_gpu" });
const resolveDefaultModelForSlotMock = vi.fn().mockResolvedValue("coder");
const previewResourcePlanMock = vi.fn().mockResolvedValue({
  gpu_layers: 24,
  context_size: 8192,
  estimated_total_vram_bytes: 3_000_000_000
});
const autoStartSlotsMock = vi.fn();
const clearCacheMock = vi.fn().mockResolvedValue(true);
const getRecentRoutingEventsMock = vi.fn().mockReturnValue([
  {
    timestamp: "2026-07-12T20:00:00.000Z",
    level: "info",
    event: "slot_recommended",
    detail: { slotId: "utility", reason: "embedding" }
  }
]);

vi.mock("@/services/runtimeSlotManager", () => ({
  runtimeSlotManager: {
    getAllSlotsStatus: (...args: unknown[]) => getAllSlotsStatusMock(...args),
    isSlotReady: (status: unknown) => isSlotReadyMock(status),
    startSlot: (...args: unknown[]) => startSlotMock(...args),
    stopSlot: (...args: unknown[]) => stopSlotMock(...args),
    resolveDefaultModelForSlot: (...args: unknown[]) => resolveDefaultModelForSlotMock(...args),
    previewResourcePlan: (...args: unknown[]) => previewResourcePlanMock(...args),
    autoStartSlots: (...args: unknown[]) => autoStartSlotsMock(...args)
  },
  getRecentRoutingEvents: (...args: unknown[]) => getRecentRoutingEventsMock(...args)
}));

vi.mock("@/services/modelContextCacheClient", () => ({
  modelContextCacheClient: {
    clear: (...args: unknown[]) => clearCacheMock(...args)
  }
}));

vi.mock("@/utils/platformDiagnosticsWindow", () => ({
  openPlatformDiagnosticsWindow: vi.fn()
}));

function findByText(container: HTMLElement, selector: string, text: string): HTMLElement | null {
  const elements = Array.from(container.querySelectorAll(selector));
  return (elements.find((el) => el.textContent?.includes(text)) as HTMLElement | undefined) ?? null;
}

const runningSlot = {
  slot_id: "fast_gpu",
  state: "running" as const,
  provider: "llama.cpp" as const,
  model_id: "coder",
  model_name: "Coder Q4",
  port: 8081,
  pid: 42,
  endpoint: "http://127.0.0.1:8081",
  message: "",
  device_policy: "gpu" as const,
  gpu_layers: 24,
  context_size: 8192,
  chat_ready: true,
  vram_total_bytes: 8_000_000_000,
  vram_used_bytes: 4_000_000_000,
  reserved_output_tokens: 900,
  batch_size: 512,
  micro_batch_size: 128,
  cache_type_k: "f16",
  cache_type_v: "f16",
  residency_state: "idle",
  active_requests: 0
};

describe("RuntimeSlotPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    getAllSlotsStatusMock.mockResolvedValue([runningSlot]);
    startSlotMock.mockResolvedValue({ success: true, slotId: "fast_gpu" });
    stopSlotMock.mockResolvedValue({ success: true, slotId: "fast_gpu" });
    previewResourcePlanMock.mockResolvedValue({
      gpu_layers: 24,
      context_size: 8192,
      estimated_total_vram_bytes: 3_000_000_000
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("acceptance: shows real gpu_layers/context/batch/cache values from the backend, not placeholders", async () => {
    await act(async () => {
      root.render(<RuntimeSlotPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("GPU-Layer: 24");
    expect(container.textContent).toContain("Kontext: 8192");
    expect(container.textContent).toContain("Antwortreserve: 900");
    expect(container.textContent).toContain("Batch: 512");
    expect(container.textContent).toContain("UBatch: 128");
    expect(container.textContent).toContain("KV-Cache: K f16 / V f16");
    expect(container.textContent).toContain("Runtime-Cache: idle");
  });

  it("acceptance: Cache leeren button calls the context cache client and reports success", async () => {
    await act(async () => {
      root.render(<RuntimeSlotPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const clearButton = findByText(container, "button", "Cache leeren");
    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton!.click();
      await Promise.resolve();
    });

    expect(clearCacheMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Cache geleert.");
  });

  it("shows recent hardening events in the panel", async () => {
    await act(async () => {
      root.render(<RuntimeSlotPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Hardening-Events");
    expect(container.textContent).toContain("slot_recommended");
    expect(container.textContent).toContain("utility");
  });

  it("Neu vermessen calls previewResourcePlan and displays the resulting plan", async () => {
    await act(async () => {
      root.render(<RuntimeSlotPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const remeasureButton = container.querySelector('button[title="Neu vermessen"]') as HTMLButtonElement | null;
    expect(remeasureButton).not.toBeNull();

    await act(async () => {
      remeasureButton!.click();
      await Promise.resolve();
    });

    expect(previewResourcePlanMock).toHaveBeenCalledWith("fast_gpu", "coder", "balanced");
    expect(container.textContent).toContain("Vermessung:");
  });

  it("Runtime neu starten stops then restarts the slot", async () => {
    await act(async () => {
      root.render(<RuntimeSlotPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const restartButton = container.querySelector('button[title="Runtime neu starten"]') as HTMLButtonElement | null;
    expect(restartButton).not.toBeNull();

    await act(async () => {
      restartButton!.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });

    expect(stopSlotMock).toHaveBeenCalledWith("fast_gpu");
    expect(startSlotMock).toHaveBeenCalled();
  });
});
