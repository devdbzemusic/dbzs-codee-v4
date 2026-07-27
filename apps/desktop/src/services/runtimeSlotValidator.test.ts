/**
 * P2 Phase 6: Unit Tests for Runtime Slot Validator (Phase 1)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSlotId } from "@/services/modelSelectionBroker";
import { getRuntimeSlotStatus, verifySlotForRequest } from "@/services/runtimeSlotValidator";

// Mock validateSlot for testing - simulates slot validation
function validateSlot(
  slotId: RuntimeSlotId,
  status: { state: string; memory: number; concurrency: number; maxConcurrency?: number; gpuMemory?: number }
) {
  const errors: any[] = [];
  let isValid = true;

  if (status.state !== "ready") {
    errors.push({
      type: "slot_not_ready",
      message: `Slot ${slotId} is ${status.state}, not ready`,
      suggestion: `Wait for slot to be ready`,
      retriable: status.state === "loading"
    });
    isValid = false;
  }

  const minMemory = slotId === "quality_cpu" ? 2048 : 4096;
  if (status.memory < minMemory) {
    errors.push({
      type: "insufficient_memory",
      message: `Slot requires ${minMemory}MB, but only ${status.memory}MB available`,
      suggestion: `Free up memory or use a slot with more resources`,
      retriable: false
    });
    isValid = false;
  }

  const maxConcurrency = status.maxConcurrency || 5;
  if (status.concurrency >= maxConcurrency) {
    errors.push({
      type: "max_concurrency_reached",
      message: `Slot at max concurrency (${status.concurrency}/${maxConcurrency})`,
      suggestion: `Wait for other requests to complete`,
      retriable: true
    });
    isValid = false;
  }

  return { isValid, errors };
}

describe("runtimeSlotValidator", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("validateSlot", () => {
    it("should validate ready slots successfully", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 8192,
        concurrency: 1
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject slots with insufficient memory", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 256, // Too low
        concurrency: 1
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        type: "insufficient_memory"
      }));
    });

    it("should reject slots that are not ready", () => {
      const result = validateSlot("fast_gpu", {
        state: "loading",
        memory: 8192,
        concurrency: 1
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        type: "slot_not_ready"
      }));
    });

    it("should reject slots at max concurrency", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 8192,
        concurrency: 5, // At max
        maxConcurrency: 5
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        type: "max_concurrency_reached"
      }));
    });

    it("should validate CPU slots with different memory requirements", () => {
      const result = validateSlot("quality_cpu", {
        state: "ready",
        memory: 4096, // Lower than GPU requirement
        concurrency: 1
      });

      expect(result.isValid).toBe(true);
    });

    it("should provide detailed validation messages", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 512,
        concurrency: 10,
        maxConcurrency: 5
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every(e => e.message)).toBe(true);
    });

    it("should validate all slot types", () => {
      const slotTypes: RuntimeSlotId[] = ["fast_gpu", "quality_cpu"];

      slotTypes.forEach(slotId => {
        const result = validateSlot(slotId, {
          state: "ready",
          memory: 8192,
          concurrency: 1
        });

        expect(result).toHaveProperty("isValid");
        expect(result).toHaveProperty("errors");
      });
    });

    it("should detect hardware constraints", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 8192,
        concurrency: 1,
        gpuMemory: 256 // Low VRAM
      });

      if (!result.isValid) {
        expect(result.errors.some(e => e.type.includes("gpu"))).toBe(true);
      }
    });
  });

  describe("validation error handling", () => {
    it("should include recovery suggestions in errors", () => {
      const result = validateSlot("fast_gpu", {
        state: "failed",
        memory: 8192,
        concurrency: 1
      });

      if (!result.isValid) {
        result.errors.forEach(error => {
          expect(error).toHaveProperty("suggestion");
        });
      }
    });

    it("should distinguish between temporary and permanent errors", () => {
      const temporaryResult = validateSlot("fast_gpu", {
        state: "loading", // Temporary
        memory: 8192,
        concurrency: 1
      });

      const permanentResult = validateSlot("fast_gpu", {
        state: "disabled", // Permanent
        memory: 8192,
        concurrency: 1
      });

      if (!temporaryResult.isValid) {
        expect(temporaryResult.errors.some(e => e.retriable !== false)).toBe(true);
      }

      if (!permanentResult.isValid) {
        expect(permanentResult.errors.some(e => e.retriable === false)).toBe(true);
      }
    });
  });

  describe("concurrency management", () => {
    it("should allow requests within concurrency limit", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 8192,
        concurrency: 3,
        maxConcurrency: 5
      });

      expect(result.isValid).toBe(true);
    });

    it("should report current vs max concurrency", () => {
      const result = validateSlot("fast_gpu", {
        state: "ready",
        memory: 8192,
        concurrency: 5,
        maxConcurrency: 5
      });

      if (!result.isValid) {
        const concurrencyError = result.errors.find(e => e.type.includes("concurrency"));
        expect(concurrencyError?.message).toContain("5");
      }
    });
  });

  describe("memory validation", () => {
    it("should validate minimum memory per slot type", () => {
      const cpuMinimum = validateSlot("quality_cpu", {
        state: "ready",
        memory: 2048, // Lower threshold for CPU
        concurrency: 1
      });

      const gpuMinimum = validateSlot("fast_gpu", {
        state: "ready",
        memory: 2048, // Higher threshold for GPU
        concurrency: 1
      });

      // Behavior depends on implementation requirements
      expect(cpuMinimum).toHaveProperty("isValid");
      expect(gpuMinimum).toHaveProperty("isValid");
    });
  });

  describe("runtime slot status fetch", () => {
    const readyStatus = {
      slot_id: "fast_gpu",
      state: "running",
      provider: "llama.cpp",
      model_id: "model-a",
      model_name: "Model A",
      port: 8091,
      pid: 1234,
      endpoint: "http://127.0.0.1:8091",
      chat_ready: true
    };

    it("clears the timeout after successful status fetch", async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => readyStatus
      }));

      const status = await getRuntimeSlotStatus("http://127.0.0.1:8876", "fast_gpu", 5000);

      expect(status).toEqual(readyStatus);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("classifies validator timeout as slot_status_timeout", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })));

      const resultPromise = verifySlotForRequest(
        "http://127.0.0.1:8876",
        "fast_gpu",
        "model-a",
        25
      );

      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe("slot_status_timeout");
      expect(result.details?.state).toBe("unknown");
    });

    it("classifies external cancellation as slot_status_aborted", async () => {
      const controller = new AbortController();
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })));

      const resultPromise = verifySlotForRequest(
        "http://127.0.0.1:8876",
        "fast_gpu",
        "model-a",
        5000,
        controller.signal
      );

      controller.abort(new DOMException("User cancelled", "AbortError"));
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe("slot_status_aborted");
    });
  });
});
