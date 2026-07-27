import { describe, it, expect } from "vitest";
import type { IndexedModel, RuntimeSlotStatus, RuntimeStatus } from "@dbzs/shared";
import { isResidentModelCompatible, residentModelFromStatus, type ResidentModelInfo } from "./residentModelHelpers";

describe("residentModelFromStatus", () => {
  it("sollte null zurückgeben, wenn der Status null ist", () => {
    expect(residentModelFromStatus(null)).toBeNull();
  });

  it("sollte null zurückgeben, wenn der Status nicht 'running' ist", () => {
    const status: RuntimeStatus = {
      state: "stopped",
      provider: null,
      model_id: null,
      model_name: null,
      port: null,
      pid: null,
      endpoint: null,
      message: ""
    };
    expect(residentModelFromStatus(status)).toBeNull();
  });

  it("sollte null zurückgeben, wenn keine Modell-ID vorhanden ist", () => {
    const status: RuntimeStatus = {
      state: "running",
      provider: "llama.cpp",
      model_id: null,
      model_name: null,
      port: 8081,
      pid: 123,
      endpoint: "http://127.0.0.1:8081",
      message: ""
    };
    expect(residentModelFromStatus(status)).toBeNull();
  });

  it("sollte null für ein Orchestrator-Modell zurückgeben", () => {
    const status: RuntimeStatus = {
      state: "running",
      provider: "llama.cpp",
      model_id: "functiongemma-270m-it.Q8_0.gguf",
      model_name: "FunctionGemma",
      port: 8084,
      pid: 456,
      endpoint: "http://127.0.0.1:8084",
      message: "",
      slot_id: "orchestrator_cpu"
    };
    expect(residentModelFromStatus(status)).toBeNull();
  });

  it("sollte null für einen Slot zurückgeben, der kein Arbeits-Slot ist", () => {
    const status: RuntimeStatus = {
      state: "running",
      provider: "llama.cpp",
      model_id: "some-model.gguf",
      model_name: "Some Model",
      port: 8081,
      pid: 123,
      endpoint: "http://127.0.0.1:8081",
      message: "",
      slot_id: "orchestrator_cpu" // Kein Arbeits-Slot
    };
    expect(residentModelFromStatus(status)).toBeNull();
  });

  it("sollte ein residentes Modell erkennen, das bereit ist", () => {
    const status: RuntimeSlotStatus = {
      slot_id: "fast_gpu",
      state: "running",
      provider: "llama.cpp",
      model_id: "deepseek-coder-v2-lite-instruct.Q4_K_M.gguf",
      model_name: "DeepSeek Coder V2 Lite",
      port: 8082,
      pid: 789,
      endpoint: "http://127.0.0.1:8082",
      message: "Ready",
      chat_ready: true,
      gpu_layers: 33,
      context_size: 16384,
      device_policy: "gpu"
    };

    const result = residentModelFromStatus(status);
    expect(result).not.toBeNull();
    expect(result?.isReady).toBe(true);
    expect(result?.modelId).toBe("deepseek-coder-v2-lite-instruct.Q4_K_M.gguf");
    expect(result?.modelName).toBe("DeepSeek Coder V2 Lite");
    expect(result?.slotId).toBe("fast_gpu");
    expect(result?.providerId).toBe("llama.cpp");
  });

  it("sollte ein residentes Modell erkennen, das läuft, aber nicht bereit ist", () => {
    const status: RuntimeSlotStatus = {
      slot_id: "quality_cpu",
      state: "running",
      provider: "ollama",
      model_id: "llama3.1:8b",
      model_name: "Llama 3.1 8B",
      port: 11434,
      pid: 111,
      endpoint: "http://127.0.0.1:11434",
      message: "Warming up",
      chat_ready: false,
      gpu_layers: 0,
      context_size: 8192,
      device_policy: "cpu"
    };

    const result = residentModelFromStatus(status);
    expect(result).not.toBeNull();
    expect(result?.isReady).toBe(false);
    expect(result?.modelId).toBe("llama3.1:8b");
  });
});

describe("isResidentModelCompatible", () => {
  const visionModelInfo: ResidentModelInfo = {
    isReady: true,
    modelId: "llava-model",
    modelName: "Llava",
    slotId: "fast_gpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "vision"]
  };

  const textModelInfo: ResidentModelInfo = {
    isReady: true,
    modelId: "text-model",
    modelName: "Text Only",
    slotId: "quality_cpu",
    providerId: "llama.cpp",
    capabilities: ["chat"]
  };

  const codeModelInfo: ResidentModelInfo = {
    isReady: true,
    modelId: "code-model",
    modelName: "Code Model",
    slotId: "fast_gpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "code"]
  };

  const toolModelInfo: ResidentModelInfo = {
    isReady: true,
    modelId: "tool-model",
    modelName: "Tool Model",
    slotId: "fast_gpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "tools"]
  };

  const notReadyModelInfo: ResidentModelInfo = {
    isReady: false,
    modelId: "not-ready-model",
    modelName: "Not Ready",
    slotId: "fast_gpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "vision", "tools"]
  };

  it("sollte false für ein nicht bereites Modell zurückgeben", () => {
    expect(isResidentModelCompatible(notReadyModelInfo, { requiresVision: true })).toBe(false);
    expect(isResidentModelCompatible(notReadyModelInfo, { requiresTools: true })).toBe(false);
  });

  it("sollte false für ein null-Modell zurückgeben", () => {
    expect(isResidentModelCompatible(null, { requiresVision: true })).toBe(false);
  });

  it("sollte Vision-Anforderungen korrekt prüfen", () => {
    expect(isResidentModelCompatible(visionModelInfo, { requiresVision: true })).toBe(true);
    expect(isResidentModelCompatible(textModelInfo, { requiresVision: true })).toBe(false);
  });

  it("sollte Tool-Anforderungen korrekt prüfen", () => {
    expect(isResidentModelCompatible(toolModelInfo, { requiresTools: true })).toBe(true);
    expect(isResidentModelCompatible(codeModelInfo, { requiresTools: true })).toBe(true);
    expect(isResidentModelCompatible(visionModelInfo, { requiresTools: true })).toBe(false);
    expect(isResidentModelCompatible(textModelInfo, { requiresTools: true })).toBe(false);
  });

  it("sollte true zurückgeben, wenn keine speziellen Anforderungen bestehen", () => {
    expect(isResidentModelCompatible(textModelInfo, {})).toBe(true);
    expect(isResidentModelCompatible(visionModelInfo, {})).toBe(true);
    expect(isResidentModelCompatible(toolModelInfo, {})).toBe(true);
  });
});

describe("isResidentModelCompatible", () => {
  const visionModelInfo: ResidentModelInfo = {
    isReady: true,
    modelId: "llava-model",
    modelName: "Llava",
    slotId: "fast_gpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "vision"]
  };

  const textModelInfo: ResidentModelInfo = {
    isReady: true,
    modelId: "text-model",
    modelName: "Text Only",
    slotId: "quality_cpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "code"]
  };

  const notReadyModelInfo: ResidentModelInfo = {
    isReady: false,
    modelId: "not-ready-model",
    modelName: "Not Ready",
    slotId: "fast_gpu",
    providerId: "llama.cpp",
    capabilities: ["chat", "vision"]
  };

  it("sollte false für ein nicht bereites Modell zurückgeben", () => {
    expect(isResidentModelCompatible(notReadyModelInfo, { requiresVision: true })).toBe(false);
    expect(isResidentModelCompatible(notReadyModelInfo, { requiresVision: false })).toBe(false);
  });

  it("sollte false für ein null-Modell zurückgeben", () => {
    expect(isResidentModelCompatible(null, { requiresVision: true })).toBe(false);
  });

  it("sollte true für ein Vision-Modell zurückgeben, wenn Vision benötigt wird", () => {
    expect(isResidentModelCompatible(visionModelInfo, { requiresVision: true })).toBe(true);
  });

  it("sollte false für ein Text-Modell zurückgeben, wenn Vision benötigt wird", () => {
    expect(isResidentModelCompatible(textModelInfo, { requiresVision: true })).toBe(false);
  });

  it("sollte true für ein Vision-Modell zurückgeben, wenn Vision nicht benötigt wird", () => {
    expect(isResidentModelCompatible(visionModelInfo, { requiresVision: false })).toBe(true);
    expect(isResidentModelCompatible(visionModelInfo, {})).toBe(true);
  });

  it("sollte true für ein Text-Modell zurückgeben, wenn Vision nicht benötigt wird", () => {
    expect(isResidentModelCompatible(textModelInfo, { requiresVision: false })).toBe(true);
    expect(isResidentModelCompatible(textModelInfo, {})).toBe(true);
  });
});
