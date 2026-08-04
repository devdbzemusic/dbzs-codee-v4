import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MultimodalPair, RuntimeSlotStatus } from "@dbzs/shared";
import type { BrokerModelCatalogEntry, ModelSelectionDecision } from "@/services/modelSelectionBroker";

const { getSlotStatusMock, startSlotMock, waitForSlotReadyMock, isSlotReadyMock, sendChatMock, brokerDecisionMock } =
  vi.hoisted(() => ({
    getSlotStatusMock: vi.fn(),
    startSlotMock: vi.fn(),
    waitForSlotReadyMock: vi.fn(),
    isSlotReadyMock: vi.fn(),
    sendChatMock: vi.fn(),
    brokerDecisionMock: vi.fn()
  }));

vi.mock("@/services/runtimeSlotManager", () => ({
  runtimeSlotManager: {
    getSlotStatus: getSlotStatusMock,
    startSlot: startSlotMock,
    waitForSlotReady: waitForSlotReadyMock,
    isSlotReady: isSlotReadyMock
  }
}));

vi.mock("@/services/agentRunService", () => ({
  agentRunService: {
    sendChat: sendChatMock
  }
}));

vi.mock("@/services/modelSelectionBroker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/modelSelectionBroker")>();
  return {
    ...actual,
    brokerDecision: brokerDecisionMock
  };
});

import { BindingModelError } from "@/services/modelSelectionBroker";
import {
  buildVisionContextPackUserPrompt,
  formatVisionContextPackBlock,
  runVisionContextPackPreStep,
  type VisionContextPackBrokerSettings
} from "@/services/visionContextPackService";

function baseDecision(overrides: Partial<ModelSelectionDecision> = {}): ModelSelectionDecision {
  return {
    taskType: "image_analysis",
    targetAgent: "default",
    slotId: "vision_gpu",
    modelId: "vision-model-1",
    modelName: "Vision Model 1",
    configuredModelId: "vision-model-1",
    resolvedModelId: "vision-model-1",
    resolvedModelName: "Vision Model 1",
    selectionSource: "role_setting",
    capabilities: ["vision"],
    hasImageInput: true,
    requiresVision: true,
    providerId: "llama-cpp",
    reason: ["test fixture"],
    fallbackPolicy: "strict",
    decisionId: "decision-1",
    decidedAt: new Date("2026-08-03T00:00:00Z"),
    decisionSettingsRevision: 1,
    ...overrides
  };
}

function baseSettings(overrides: Partial<VisionContextPackBrokerSettings> = {}): VisionContextPackBrokerSettings {
  return {
    defaultModelId: "chat-model",
    defaultModelName: "Chat Model",
    ...overrides
  };
}

function slotStatus(overrides: Partial<RuntimeSlotStatus> = {}): RuntimeSlotStatus {
  return {
    state: "running",
    provider: "llama.cpp",
    model_id: "vision-model-1",
    model_name: "Vision Model 1",
    port: 8085,
    pid: 123,
    endpoint: "http://127.0.0.1:8085",
    message: "",
    slot_id: "vision_gpu",
    device_policy: "auto",
    gpu_layers: 20,
    context_size: 4096,
    chat_ready: true,
    ...overrides
  };
}

const visionCatalog: BrokerModelCatalogEntry[] = [
  {
    id: "vision-model-1",
    name: "Vision Model 1",
    artifact_type: "model",
    capabilities: ["vision"],
    requiresVisionProjector: true
  }
];

const verifiedPair: MultimodalPair[] = [
  {
    id: "vision-model-1:mmproj-1",
    base_model_id: "vision-model-1",
    projector_artifact_id: "mmproj-1",
    modalities: ["text", "image"],
    source: "manual",
    confidence: 1,
    status: "candidate",
    routing_allowed: true,
    candidate_base_model_ids: ["vision-model-1"]
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  isSlotReadyMock.mockImplementation(
    (status: RuntimeSlotStatus | null) => status !== null && status.state === "running" && status.chat_ready === true
  );
});

describe("buildVisionContextPackUserPrompt", () => {
  it("wraps the user's goal for the vision analysis call", () => {
    expect(buildVisionContextPackUserPrompt("Warum ist der Button rot?")).toBe(
      "Nutzeranfrage: Warum ist der Button rot?\n\nAnalysiere das angehaengte Bild im Kontext dieser Anfrage."
    );
  });
});

describe("formatVisionContextPackBlock", () => {
  it("labels the block with the vision model's display name when available", () => {
    expect(
      formatVisionContextPackBlock({
        contextPack: "Ein roter Button mit Text 'Submit'.",
        visionModelName: "Qwen2.5-VL",
        visionModelId: "qwen2.5-vl-7b"
      })
    ).toBe("[VISION CONTEXT PACK - Bildanalyse von Qwen2.5-VL]\nEin roter Button mit Text 'Submit'.");
  });

  it("falls back to the model id when no display name is known", () => {
    expect(
      formatVisionContextPackBlock({
        contextPack: "Ein roter Button.",
        visionModelName: null,
        visionModelId: "qwen2.5-vl-7b"
      })
    ).toBe("[VISION CONTEXT PACK - Bildanalyse von qwen2.5-vl-7b]\nEin roter Button.");
  });
});

describe("runVisionContextPackPreStep", () => {
  it("returns no_images without calling any service when there are no images", async () => {
    const result = await runVisionContextPackPreStep({
      goal: "Fixe den Bug im Screenshot",
      images: [],
      settings: baseSettings(),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result).toEqual({ ok: false, reason: "no_images" });
    expect(getSlotStatusMock).not.toHaveBeenCalled();
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it("reports vision_routing_failed when no vision model can be resolved", async () => {
    brokerDecisionMock.mockRejectedValue(new BindingModelError("no vision model available", "no_model"));

    const result = await runVisionContextPackPreStep({
      goal: "Fixe den Bug im Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultModelId: "" }),
      catalog: [],
      multimodalPairs: [],
      runningModels: []
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain("vision_routing_failed");
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it("analyzes the image with the already-running verified vision model", async () => {
    brokerDecisionMock.mockResolvedValue(baseDecision());
    getSlotStatusMock.mockResolvedValue(slotStatus());
    sendChatMock.mockResolvedValue({
      message: { id: "resp-1", role: "assistant", content: "Ein rotes Fehler-Badge neben dem Speichern-Button." },
      model_id: "vision-model-1",
      model_name: "Vision Model 1"
    });

    const result = await runVisionContextPackPreStep({
      goal: "Fixe den Bug im Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultVisionModelId: "vision-model-1" }),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result).toEqual({
      ok: true,
      contextPack: "Ein rotes Fehler-Badge neben dem Speichern-Button.",
      visionModelId: "vision-model-1",
      visionModelName: "Vision Model 1",
      slotId: "vision_gpu"
    });
    expect(startSlotMock).not.toHaveBeenCalled();
    expect(sendChatMock).toHaveBeenCalledTimes(1);
    const [request] = sendChatMock.mock.calls[0];
    expect(request.model_id).toBe("vision-model-1");
    expect(request.slot_id).toBe("vision_gpu");
    expect(request.messages[1].role).toBe("user");
    expect(request.messages[1].images).toEqual(["data:image/png;base64,AAAA"]);
  });

  it("starts and waits for the slot when the vision model isn't already serving", async () => {
    brokerDecisionMock.mockResolvedValue(baseDecision());
    getSlotStatusMock.mockResolvedValue(slotStatus({ state: "stopped", chat_ready: false, model_id: null }));
    startSlotMock.mockResolvedValue({ success: true, slotId: "vision_gpu" });
    waitForSlotReadyMock.mockResolvedValue(slotStatus());
    sendChatMock.mockResolvedValue({
      message: { id: "resp-1", role: "assistant", content: "Beschreibung." },
      model_id: "vision-model-1",
      model_name: "Vision Model 1"
    });

    const result = await runVisionContextPackPreStep({
      goal: "Review den Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultVisionModelId: "vision-model-1" }),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result.ok).toBe(true);
    expect(startSlotMock).toHaveBeenCalledWith("vision_gpu", "vision-model-1");
    expect(waitForSlotReadyMock).toHaveBeenCalledWith("vision_gpu", 60_000);
  });

  it("reports vision_slot_start_failed when the slot fails to start", async () => {
    brokerDecisionMock.mockResolvedValue(baseDecision());
    getSlotStatusMock.mockResolvedValue(slotStatus({ state: "stopped", chat_ready: false, model_id: null }));
    startSlotMock.mockResolvedValue({ success: false, slotId: "vision_gpu", error: "port in use" });

    const result = await runVisionContextPackPreStep({
      goal: "Review den Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultVisionModelId: "vision-model-1" }),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result).toEqual({ ok: false, reason: "vision_slot_start_failed: port in use" });
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it("reports vision_slot_not_ready when the slot never becomes ready", async () => {
    brokerDecisionMock.mockResolvedValue(baseDecision());
    getSlotStatusMock.mockResolvedValue(slotStatus({ state: "stopped", chat_ready: false, model_id: null }));
    startSlotMock.mockResolvedValue({ success: true, slotId: "vision_gpu" });
    waitForSlotReadyMock.mockResolvedValue(null);

    const result = await runVisionContextPackPreStep({
      goal: "Review den Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultVisionModelId: "vision-model-1" }),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result).toEqual({ ok: false, reason: "vision_slot_not_ready" });
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it("reports vision_empty_response when the model returns nothing usable", async () => {
    brokerDecisionMock.mockResolvedValue(baseDecision());
    getSlotStatusMock.mockResolvedValue(slotStatus());
    sendChatMock.mockResolvedValue({
      message: { id: "resp-1", role: "assistant", content: "   " },
      model_id: "vision-model-1",
      model_name: "Vision Model 1"
    });

    const result = await runVisionContextPackPreStep({
      goal: "Review den Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultVisionModelId: "vision-model-1" }),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result).toEqual({ ok: false, reason: "vision_empty_response" });
  });

  it("reports vision_context_pack_failed when the chat call throws", async () => {
    brokerDecisionMock.mockResolvedValue(baseDecision());
    getSlotStatusMock.mockResolvedValue(slotStatus());
    sendChatMock.mockRejectedValue(new Error("network unreachable"));

    const result = await runVisionContextPackPreStep({
      goal: "Review den Screenshot",
      images: ["data:image/png;base64,AAAA"],
      settings: baseSettings({ defaultVisionModelId: "vision-model-1" }),
      catalog: visionCatalog,
      multimodalPairs: verifiedPair,
      runningModels: undefined
    });

    expect(result).toEqual({ ok: false, reason: "vision_context_pack_failed: network unreachable" });
  });
});
