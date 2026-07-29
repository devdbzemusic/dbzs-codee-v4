/**
 * DBZS – Division By Zeros
 * Datei: runtimeSlotManager.test.ts
 * Bereich: Desktop Services / Runtime Slot Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, type IndexedModel } from "@dbzs/shared";
import { runtimeSlotManager, scoreModelForSlot, type RuntimeSlotStatus } from "./runtimeSlotManager";
import { useSettingsStore } from "@/stores/settingsStore";

function makeIndexedModel(overrides: Partial<IndexedModel> = {}): IndexedModel {
  return {
    id: "model-a",
    name: "model-a",
    path: "D:/Models/model-a.gguf",
    format: "gguf",
    artifact_type: "model",
    size_bytes: 1_000_000,
    size_gb: 1,
    quantization: "Q4_K_M",
    backend: "llama.cpp",
    runtime_launcher: "llama-server",
    capabilities: [],
    modality: ["text"],
    role: null,
    recommended_use: "coding_candidate",
    compatibility: "llama_server_ready",
    runtime: {
      ctx: null,
      gpu_layers: null,
      server_enabled: true,
      preferred_port: null,
      health_status: "unknown",
      provider: "llama.cpp"
    },
    ...overrides
  };
}

// Mock fetch
global.fetch = vi.fn();

describe("runtimeSlotManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      backendHealth: null,
      backendStartupStatus: null,
      isLoading: false,
      error: null
    });
  });

  describe("getSlotStatus", () => {
    it("sollte Slot-Status laden", async () => {
      const mockStatus: RuntimeSlotStatus = {
        slot_id: "quality_cpu",
        state: "running",
        provider: "llama.cpp",
        model_id: "qwen2.5-coder-7b",
        model_name: "Qwen2.5-Coder-7B-Instruct",
        port: 8081,
        pid: 12345,
        endpoint: "http://127.0.0.1:8081",
        message: "",
        device_policy: "cpu",
        gpu_layers: 0,
        context_size: 16384,
        chat_ready: true
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus
      });

      const status = await runtimeSlotManager.getSlotStatus("quality_cpu");

      expect(status).toEqual(mockStatus);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/runtime/slots/quality_cpu/status"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("sollte null zurückgeben bei Fehler", async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const status = await runtimeSlotManager.getSlotStatus("fast_gpu");

      expect(status).toBeNull();
    });
  });

  describe("startSlot", () => {
    it("sollte Slot starten", async () => {
      const mockStatus: RuntimeSlotStatus = {
        slot_id: "quality_cpu",
        state: "starting",
        provider: "llama.cpp",
        model_id: "qwen2.5-coder-7b",
        model_name: "Qwen2.5-Coder-7B-Instruct",
        port: 8081,
        pid: 12346,
        endpoint: "http://127.0.0.1:8081",
        message: "",
        device_policy: "cpu",
        gpu_layers: 0,
        context_size: 16384,
        chat_ready: false
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus
      });

      const result = await runtimeSlotManager.startSlot("quality_cpu", "qwen2.5-coder-7b");

      expect(result.success).toBe(true);
      expect(result.status).toEqual(mockStatus);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/runtime/slots/quality_cpu/start"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ model_id: "qwen2.5-coder-7b" })
        })
      );
    });

    it("sollte Fehler zurückgeben bei Misserfolg", async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Model not found"
      });

      const result = await runtimeSlotManager.startSlot("fast_gpu", "invalid-model");

      expect(result.success).toBe(false);
      expect(result.error).toContain("400");
    });
  });

  describe("stopSlot", () => {
    it("sollte Slot stoppen", async () => {
      const mockStatus: RuntimeSlotStatus = {
        slot_id: "quality_cpu",
        state: "stopped",
        provider: null,
        model_id: null,
        model_name: null,
        port: null,
        pid: null,
        endpoint: null,
        message: "",
        device_policy: "cpu",
        gpu_layers: null,
        context_size: null,
        chat_ready: false
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus
      });

      const result = await runtimeSlotManager.stopSlot("quality_cpu");

      expect(result.success).toBe(true);
      expect(result.status?.state).toBe("stopped");
    });
  });

  describe("getAllSlotsStatus", () => {
    it("sollte alle fünf Slots inklusive orchestrator_cpu und vision_gpu abfragen", async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ state: "stopped" })
      });

      await runtimeSlotManager.getAllSlotsStatus();

      expect(fetch).toHaveBeenCalledTimes(5);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/runtime/slots/orchestrator_cpu/status"),
        expect.objectContaining({ method: "GET" })
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/runtime/slots/vision_gpu/status"),
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("getRecommendedSlot", () => {
    it("sollte GPU für Code-Tasks empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("large_code_change");
      expect(rec.slotId).toBe("fast_gpu");
      expect(rec.reason).toContain("GPU");
    });

    it("sollte GPU für Debug-Tasks empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("debugging");
      expect(rec.slotId).toBe("fast_gpu");
    });

    it("sollte CPU für Chat empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("casual_chat");
      expect(rec.slotId).toBe("quality_cpu");
      expect(rec.reason).toContain("CPU");
    });

    it("sollte GPU für Review empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("review");
      expect(rec.slotId).toBe("fast_gpu");
    });

    it("sollte Utility für Embedding-Aufgaben empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("embedding");
      expect(rec.slotId).toBe("utility");
      expect(rec.alternativeSlotId).toBe("quality_cpu");
    });

    it("sollte CPU als Default empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("unknown");
      expect(rec.slotId).toBe("quality_cpu");
    });

    it("sollte Orchestrator-Slot für Function-Calling-Tasks empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("function_calling");
      expect(rec.slotId).toBe("orchestrator_cpu");
    });

    it("sollte Orchestrator-Slot für Intent-Routing-Tasks empfehlen", () => {
      const rec = runtimeSlotManager.getRecommendedSlot("intent_routing");
      expect(rec.slotId).toBe("orchestrator_cpu");
    });
  });

  describe("isSlotReady", () => {
    it("sollte ready Slot erkennen", () => {
      const status: RuntimeSlotStatus = {
        slot_id: "quality_cpu",
        state: "running",
        provider: "llama.cpp",
        model_id: "model-1",
        model_name: "Model 1",
        port: 8081,
        pid: 12345,
        endpoint: "http://127.0.0.1:8081",
        message: "",
        device_policy: "cpu",
        gpu_layers: 0,
        context_size: 16384,
        chat_ready: true
      };

      expect(runtimeSlotManager.isSlotReady(status)).toBe(true);
    });

    it("sollte nicht-ready Slot erkennen", () => {
      const status: RuntimeSlotStatus = {
        slot_id: "quality_cpu",
        state: "starting",
        provider: null,
        model_id: null,
        model_name: null,
        port: null,
        pid: null,
        endpoint: null,
        message: "",
        device_policy: "cpu",
        gpu_layers: null,
        context_size: null,
        chat_ready: false
      };

      expect(runtimeSlotManager.isSlotReady(status)).toBe(false);
    });

    it("sollte null nicht als ready erkennen", () => {
      expect(runtimeSlotManager.isSlotReady(null)).toBe(false);
    });
  });

  describe("getDefaultModelForSlot", () => {
    it("sollte Default-Modelle zurückgeben", () => {
      expect(runtimeSlotManager.getDefaultModelForSlot("fast_gpu")).toContain("CodeReactor");
      expect(runtimeSlotManager.getDefaultModelForSlot("quality_cpu")).toContain("Llama");
      expect(runtimeSlotManager.getDefaultModelForSlot("utility")).toContain("embedding");
      expect(runtimeSlotManager.getDefaultModelForSlot("orchestrator_cpu")).toContain("functiongemma");
      expect(runtimeSlotManager.getDefaultModelForSlot("vision_gpu")).toContain("VL");
    });

    it("sollte gespeichertes Vision-Modell aus den Settings verwenden", () => {
      useSettingsStore.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          defaultVisionModelId: "vision-model-id"
        }
      });

      expect(runtimeSlotManager.getDefaultModelForSlot("vision_gpu")).toBe("vision-model-id");
    });

    it("sollte gespeicherte Settings-Modelle für Chat- und Quality-Slots verwenden", () => {
      useSettingsStore.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          defaultChatModelId: "chat-model-id",
          defaultModelId: "chat-model-id",
          defaultCoderModelId: "coder-model-id",
          defaultReviewerModelId: "reviewer-model-id",
          defaultDebugModelId: "debug-model-id"
        }
      });

      expect(runtimeSlotManager.getDefaultModelForSlot("fast_gpu")).toBe("coder-model-id");
      expect(runtimeSlotManager.getDefaultModelForSlot("quality_cpu")).toBe("chat-model-id");
    });

    it("sollte gespeichertes Orchestrator-Modell aus den Settings verwenden", () => {
      useSettingsStore.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          defaultOrchestratorModelId: "orchestrator-model-id"
        }
      });

      expect(runtimeSlotManager.getDefaultModelForSlot("orchestrator_cpu")).toBe("orchestrator-model-id");
    });

    it("sollte gespeichertes Utility-Modell aus den Settings verwenden", () => {
      useSettingsStore.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          defaultUtilityModelId: "utility-model-id"
        }
      });

      expect(runtimeSlotManager.getDefaultModelForSlot("utility")).toBe("utility-model-id");
    });
  });

  describe("scoreModelForSlot for vision_gpu", () => {
    it("bevorzugt ein Vision-Modell für vision_gpu", () => {
      const visionModel = makeIndexedModel({
        id: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
        name: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
        recommended_use: "vision_candidate",
        capabilities: ["vision"]
      });
      const codingModel = makeIndexedModel({
        id: "qwen2.5-coder-3b-instruct-q8_0",
        name: "qwen2.5-coder-3b-instruct-q8_0",
        recommended_use: "primary_coding",
        capabilities: ["code"]
      });

      expect(scoreModelForSlot(visionModel, "vision_gpu")).toBeGreaterThan(
        scoreModelForSlot(codingModel, "vision_gpu")
      );
    });

    it("bestraft ein Nicht-Vision-Modell stark für vision_gpu", () => {
      const codingModel = makeIndexedModel({ recommended_use: "primary_coding", capabilities: ["code"] });
      expect(scoreModelForSlot(codingModel, "vision_gpu")).toBeLessThan(0);
    });
  });

  describe("warmupInference", () => {
    it("ruft Backend-Warm-up auf und nicht llama-server direkt", async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          outcome: "inference_ready",
          detail: "OK",
          model_id: "planner-model",
          model_name: "Planner",
          slot_id: "fast_gpu",
          elapsed_ms: 12
        })
      });

      const result = await runtimeSlotManager.warmupInference("fast_gpu", "planner-model", 5_000);

      expect(result).toMatchObject({
        ok: true,
        status: "ready",
        detail: "OK",
        readinessStage: "inference_ready"
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toContain("/runtime/slots/fast_gpu/warmup");
      expect(url).not.toContain("/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toMatchObject({
        model_id: "planner-model",
        timeout_ms: 5_000
      });
    });

    it("meldet binding_mismatch vom Backend differenziert", async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          outcome: "binding_mismatch",
          detail: "Slot model 'a' does not match requested 'b'",
          model_id: "b",
          slot_id: "fast_gpu",
          elapsed_ms: 3
        })
      });

      const result = await runtimeSlotManager.warmupInference("fast_gpu", "b");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("binding_mismatch");
      expect(result.detail).toContain("Outcome: binding_mismatch");
    });
  });
});
