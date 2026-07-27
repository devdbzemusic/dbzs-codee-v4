import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IndexedModel, ModelIndex, RuntimeSlotStatus } from "@dbzs/shared";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import { handleResidentFallback } from "./fallbackHandler";
import { runtimeSlotManager, type WarmupResult } from "./runtimeSlotManager";
import { useModelIndexStore } from "@/stores/modelIndexStore";

// Mock der Abhängigkeiten
vi.mock("./runtimeSlotManager", () => ({
  runtimeSlotManager: {
    warmupInference: vi.fn()
  }
}));

vi.mock("@/stores/modelIndexStore", () => ({
  useModelIndexStore: {
    getState: vi.fn()
  }
}));

describe("handleResidentFallback", () => {
  const mockAppendRunEvent = vi.fn((run) => run);
  const mockUpdateActiveRun = vi.fn((updater) => updater({} as never));
  const abortController = new AbortController();

  const initialRoute: RuntimeChatRoutingInfo = {
    targetAgent: "coder",
    modelId: "primary-model",
    modelName: "Primary Model",
    providerId: "llama.cpp",
    slotId: "fast_gpu",
    selectionSource: "automatic"
  };

  const residentModelStatus: RuntimeSlotStatus = {
    slot_id: "quality_cpu",
    state: "running",
    provider: "llama.cpp",
    model_id: "resident-model",
    model_name: "Resident Model",
    port: 8081,
    pid: 123,
    endpoint: "http://127.0.0.1:8081",
    message: "Ready",
    chat_ready: true,
    gpu_layers: 0,
    context_size: 4096,
    device_policy: "cpu"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelIndexStore.getState).mockReturnValue({
      index: {
        models: [
          { id: "primary-model", name: "Primary Model", capabilities: ["chat"] },
          { id: "resident-model", name: "Resident Model", capabilities: ["chat", "code"] }
        ] as unknown as IndexedModel[]
      } as ModelIndex,
      isLoading: false,
      error: null,
      primaryCodingModel: null,
      loadModelIndex: vi.fn()
    });
  });

  const baseInput = {
    initialModelToStart: "primary-model",
    initialRoute,
    requiresVision: false,
    requiresTools: false,
    signal: abortController.signal,
    updateActiveRun: mockUpdateActiveRun,
    appendRunEvent: mockAppendRunEvent
  };

  it("sollte keinen Fallback durchführen, wenn der initiale Warm-up erfolgreich ist", async () => {
    const initialWarmupResult: WarmupResult = { ok: true, detail: "Ready" };

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: null
    });

    expect(result.fallbackInitiated).toBe(false);
    expect(result.finalRoute).toBe(initialRoute);
    expect(runtimeSlotManager.warmupInference).not.toHaveBeenCalled();
  });

  it("sollte keinen Fallback bei einem Timeout durchführen", async () => {
    const initialWarmupResult: WarmupResult = { ok: false, error: "warmup_timeout", detail: "Timeout" };

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: residentModelStatus
    });

    expect(result.fallbackInitiated).toBe(false);
    expect(result.finalRoute).toBe(initialRoute);
  });

  it("sollte keinen Fallback durchführen, wenn kein residentes Modell verfügbar ist", async () => {
    const initialWarmupResult: WarmupResult = { ok: false, error: "warmup_failed", detail: "Failed" };

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: null
    });

    expect(result.fallbackInitiated).toBe(false);
  });

  it("sollte einen Fallback ablehnen, wenn das residente Modell nicht kompatibel ist", async () => {
    const initialWarmupResult: WarmupResult = { ok: false, error: "warmup_failed", detail: "Failed" };

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: residentModelStatus,
      requiresVision: true // Residentes Modell hat kein Vision
    });

    expect(result.fallbackInitiated).toBe(false);
    expect(result.fallbackRejection).toBeDefined();
    expect(result.fallbackRejection?.reason).toContain("Vision-Fähigkeit");
    expect(runtimeSlotManager.warmupInference).not.toHaveBeenCalled();
  });

  it("sollte einen erfolgreichen Fallback auf ein kompatibles residentes Modell durchführen", async () => {
    const initialWarmupResult: WarmupResult = { ok: false, error: "warmup_failed", detail: "Failed" };
    vi.mocked(runtimeSlotManager.warmupInference).mockResolvedValue({ ok: true, detail: "Fallback Ready" });

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: residentModelStatus,
      requiresTools: true // Residentes Modell hat 'code'
    });

    expect(result.fallbackInitiated).toBe(true);
    expect(result.finalRoute.modelId).toBe("resident-model");
    expect(result.finalRoute.selectionSource).toBe("explicit_fallback");
    expect(result.degradedReason).toContain("Residenter Fallback aktiv");
    expect(result.warmupResult.ok).toBe(true);
    expect(mockAppendRunEvent).toHaveBeenCalledWith(expect.anything(), "runtime.fallback.initiated", expect.any(String), expect.any(Object));
    expect(runtimeSlotManager.warmupInference).toHaveBeenCalledWith("quality_cpu", "resident-model", 15000, expect.any(Object));
  });

  it("sollte den ursprünglichen Fehler zurückgeben, wenn der Fallback-Warm-up fehlschlägt", async () => {
    const initialWarmupResult: WarmupResult = { ok: false, error: "warmup_failed", detail: "Primary Failed" };
    const fallbackWarmupResult: WarmupResult = { ok: false, error: "warmup_failed", detail: "Fallback Failed" };
    vi.mocked(runtimeSlotManager.warmupInference).mockResolvedValue(fallbackWarmupResult);

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: residentModelStatus,
      requiresTools: true
    });

    expect(result.fallbackInitiated).toBe(true);
    expect(result.warmupResult.ok).toBe(false);
    expect(result.warmupResult.detail).toBe("Fallback Failed");
    expect(result.finalRoute.modelId).toBe("resident-model");
  });

  it("sollte keinen Fallback durchführen, wenn das residente Modell dasselbe ist wie das fehlgeschlagene", async () => {
    const initialWarmupResult: WarmupResult = { ok: false, error: "warmup_failed", detail: "Failed" };
    const sameModelStatus: RuntimeSlotStatus = {
      ...residentModelStatus,
      model_id: "primary-model"
    };

    const result = await handleResidentFallback({
      ...baseInput,
      initialWarmupResult,
      currentStatus: sameModelStatus
    });

    expect(result.fallbackInitiated).toBe(false);
    expect(runtimeSlotManager.warmupInference).not.toHaveBeenCalled();
  });
});
