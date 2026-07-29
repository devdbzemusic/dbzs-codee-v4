import { describe, expect, it } from "vitest";
import type { IndexedModel, RuntimeStatus } from "@dbzs/shared";
import {
  describeModelRoutingReadiness,
  modelRoutingTone,
  sortStartableModels,
  summarizeModelRoles,
  summarizeModelRoutingReadiness
} from "./RuntimeModelsTab.helpers";

const baseModel: IndexedModel = {
  id: "m1",
  name: "test.gguf",
  path: "/models/test.gguf",
  format: "gguf",
  artifact_type: "model",
  size_bytes: 1024,
  size_gb: 0.001,
  quantization: "Q4_K_M",
  backend: "llama_server",
  runtime_launcher: "llama_server",
  capabilities: ["chat"],
  modality: ["text"],
  role: null,
  recommended_use: "coding_candidate",
  compatibility: "llama_server_ready",
  runtime: {
    ctx: 4096,
    gpu_layers: 0,
    server_enabled: true,
    preferred_port: 8080,
    health_status: "unknown",
    provider: "llama_server"
  }
};

describe("describeModelRoutingReadiness", () => {
  it("flags projector-based vision models without verified pair as blocked", () => {
    expect(
      describeModelRoutingReadiness(
        {
          ...baseModel,
          id: "vision-model",
          name: "Qwen2.5-VL-3B",
          capabilities: ["chat", "vision"],
          recommended_use: "vision_candidate"
        },
        [
          {
            id: "pair-candidate",
            base_model_id: "vision-model",
            projector_artifact_id: "mmproj-vision-model",
            modalities: ["text", "image"],
            source: "catalog",
            confidence: 0.85,
            status: "candidate",
            routing_allowed: false,
            candidate_base_model_ids: ["vision-model"]
          }
        ]
      )
    ).toEqual({
      label: "MM-Pair fehlt",
      hint: "Bildinput bleibt gesperrt, bis ein verifiziertes Projektor-Pair vorliegt"
    });
  });

  it("marks verified vision+code models as screenshot-ready", () => {
    expect(
      describeModelRoutingReadiness(
        {
          ...baseModel,
          id: "vision-model",
          name: "Qwen2.5-VL-3B",
          capabilities: ["chat", "vision", "code"],
          recommended_use: "vision_candidate"
        },
        [
          {
            id: "pair-1",
            base_model_id: "vision-model",
            projector_artifact_id: "mmproj-vision-model",
            modalities: ["text", "image"],
            source: "manual",
            confidence: 1,
            status: "candidate",
            routing_allowed: true,
            candidate_base_model_ids: ["vision-model"]
          }
        ]
      )
    ).toEqual({
      label: "Vision + Code",
      hint: "Verifiziertes MM-Pair vorhanden; fuer Screenshot-Coding/-Review geeignet"
    });
  });

  it("keeps text coding models on text-only routing", () => {
    expect(
      describeModelRoutingReadiness(
        {
          ...baseModel,
          capabilities: ["chat", "code"],
          recommended_use: "primary_coding"
        },
        []
      )
    ).toEqual({
      label: "Text + Code",
      hint: "Geeignet fuer textbasierte Coding-, Review- und Debugging-Turns"
    });
  });
});

describe("modelRoutingTone", () => {
  it("maps routing labels to stable badge tones", () => {
    expect(modelRoutingTone("Vision + Code")).toBe("ok");
    expect(modelRoutingTone("Text + Code")).toBe("ok");
    expect(modelRoutingTone("Vision direkt")).toBe("warn");
    expect(modelRoutingTone("Vision-Chat")).toBe("warn");
    expect(modelRoutingTone("MM-Pair fehlt")).toBe("error");
    expect(modelRoutingTone("Text")).toBe("info");
  });
});

describe("summarizeModelRoutingReadiness", () => {
  it("counts text, coding, direct vision, vision chat, blocked vision and screenshot-ready models", () => {
    expect(
      summarizeModelRoutingReadiness(
        [
          {
            ...baseModel,
            id: "text-model",
            name: "chat-only.gguf",
            capabilities: ["chat"],
            recommended_use: "chat_candidate"
          },
          {
            ...baseModel,
            id: "code-model",
            name: "coder.gguf",
            capabilities: ["chat", "code"],
            recommended_use: "primary_coding"
          },
          {
            ...baseModel,
            id: "blocked-vision-model",
            name: "Qwen2.5-VL-3B",
            capabilities: ["chat", "vision"],
            recommended_use: "vision_candidate"
          },
          {
            ...baseModel,
            id: "direct-vision-model",
            name: "Gemma-vision-instruct",
            capabilities: ["chat", "vision", "code"],
            recommended_use: "vision_candidate"
          },
          {
            ...baseModel,
            id: "vision-chat-model",
            name: "Vision-chat-only",
            capabilities: ["chat", "vision"],
            recommended_use: "vision_candidate"
          },
          {
            ...baseModel,
            id: "ready-vision-model",
            name: "Qwen2.5-VL-7B",
            capabilities: ["chat", "vision", "code"],
            recommended_use: "vision_candidate"
          }
        ],
        [
          {
            id: "pair-blocked",
            base_model_id: "blocked-vision-model",
            projector_artifact_id: "mmproj-blocked",
            modalities: ["text", "image"],
            source: "catalog",
            confidence: 0.8,
            status: "candidate",
            routing_allowed: false,
            candidate_base_model_ids: ["blocked-vision-model"]
          },
          {
            id: "pair-ready",
            base_model_id: "ready-vision-model",
            projector_artifact_id: "mmproj-ready",
            modalities: ["text", "image"],
            source: "manual",
            confidence: 1,
            status: "candidate",
            routing_allowed: true,
            candidate_base_model_ids: ["ready-vision-model"]
          }
        ]
      )
    ).toEqual({
      text: 1,
      textCode: 1,
      visionDirect: 1,
      visionChat: 1,
      visionBlocked: 1,
      screenshotReady: 1
    });
  });
});

describe("summarizeModelRoles", () => {
  it("counts coding, chat, vision, orchestrator and other role buckets", () => {
    expect(
      summarizeModelRoles([
        {
          ...baseModel,
          id: "coding-primary",
          recommended_use: "primary_coding"
        },
        {
          ...baseModel,
          id: "coding-candidate",
          recommended_use: "coding_candidate"
        },
        {
          ...baseModel,
          id: "chat-candidate",
          recommended_use: "chat_candidate"
        },
        {
          ...baseModel,
          id: "vision-candidate",
          recommended_use: "vision_candidate"
        },
        {
          ...baseModel,
          id: "orchestrator-model",
          recommended_use: "orchestrator"
        },
        {
          ...baseModel,
          id: "other-model",
          recommended_use: "embedding"
        }
      ])
    ).toEqual({
      coding: 2,
      chat: 1,
      vision: 1,
      orchestrator: 1,
      other: 1
    });
  });
});

describe("sortStartableModels", () => {
  it("prioritizes the active model and strongest routing candidates first", () => {
    const models: IndexedModel[] = [
      {
        ...baseModel,
        id: "text-only",
        name: "text-only.gguf",
        capabilities: ["chat"],
        modality: ["text"],
        recommended_use: "chat_candidate"
      },
      {
        ...baseModel,
        id: "vision-direct",
        name: "vision-direct.gguf",
        capabilities: ["chat", "vision"],
        modality: ["text", "image"],
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "text-code-active",
        name: "text-code-active.gguf",
        capabilities: ["chat", "code"],
        modality: ["text"],
        recommended_use: "primary_coding"
      }
    ];

    const runningStatus: RuntimeStatus = {
      state: "running",
      model_id: "text-code-active",
      model_name: "text-code-active.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };

    expect(sortStartableModels(models, [], runningStatus).map((model) => model.id)).toEqual([
      "text-code-active",
      "vision-direct",
      "text-only"
    ]);
  });
});
