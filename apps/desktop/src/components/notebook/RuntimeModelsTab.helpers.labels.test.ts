import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair } from "@dbzs/shared";
import {
  capabilityTone,
  compatibilityTone,
  describeModelCapabilities,
  formatCapabilityLabel,
  formatCompatibilityLabel,
  formatLauncherLabel,
  formatModelRoleLabel,
  formatMultimodalPairConfidence,
  formatMultimodalPairModalities,
  formatMultimodalPairSource,
  formatSupportArtifactTypeLabel,
  launcherTone,
  modelRoleTone,
  multimodalConfidenceTone,
  multimodalPairSourceTone,
  shouldDisplaySupportArtifact,
  supportArtifactTypeTone
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

describe("shouldDisplaySupportArtifact", () => {
  const mmprojArtifact: IndexedModel = {
    ...baseModel,
    id: "mmproj-1",
    name: "mmproj-gemma-vision-f16",
    path: "/models/mmproj-gemma-vision-f16.gguf",
    artifact_type: "mmproj",
    capabilities: ["vision"],
    modality: ["image"],
    compatibility: "support_artifact",
    recommended_use: "vision_candidate"
  };

  it("hides paired mmproj artifacts from the support artifact list", () => {
    const pair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1"]
    };

    expect(shouldDisplaySupportArtifact(mmprojArtifact, pair)).toBe(false);
  });

  it("keeps unpaired or non-mmproj support artifacts visible", () => {
    expect(shouldDisplaySupportArtifact(mmprojArtifact, undefined)).toBe(true);
    expect(shouldDisplaySupportArtifact({ ...mmprojArtifact, artifact_type: "clip" }, undefined)).toBe(true);
  });
});

describe("formatMultimodalPairConfidence", () => {
  it("formats pair confidence as a compact percentage", () => {
    expect(formatMultimodalPairConfidence(0.92)).toBe("92%");
    expect(formatMultimodalPairConfidence(0.405)).toBe("41%");
  });
});

describe("formatMultimodalPairModalities", () => {
  it("joins multimodal capability labels for display", () => {
    const pair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1"]
    };

    expect(formatMultimodalPairModalities(pair)).toBe("text + image");
  });

  it("falls back to a dash when no modality metadata is present", () => {
    const pair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: [],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1"]
    };

    expect(formatMultimodalPairModalities(pair)).toBe("-");
  });
});

describe("formatMultimodalPairSource", () => {
  it("returns stable readable source labels", () => {
    expect(formatMultimodalPairSource("same_folder")).toBe("Gleicher Ordner");
    expect(formatMultimodalPairSource("manual")).toBe("Manuell");
    expect(formatMultimodalPairSource("catalog")).toBe("Katalog");
    expect(formatMultimodalPairSource("custom")).toBe("custom");
  });
});

describe("multimodalPairSourceTone", () => {
  it("maps pair sources to stable badge tones", () => {
    expect(multimodalPairSourceTone("manual")).toBe("ok");
    expect(multimodalPairSourceTone("catalog")).toBe("ok");
    expect(multimodalPairSourceTone("same_folder")).toBe("warn");
    expect(multimodalPairSourceTone("custom")).toBe("info");
  });
});

describe("multimodalConfidenceTone", () => {
  it("maps confidence values to stable badge tones", () => {
    expect(multimodalConfidenceTone(0.95)).toBe("ok");
    expect(multimodalConfidenceTone(0.6)).toBe("warn");
    expect(multimodalConfidenceTone(0.2)).toBe("error");
  });
});

describe("describeModelCapabilities", () => {
  it("returns compact capability badges in stable order", () => {
    expect(
      describeModelCapabilities({
        ...baseModel,
        capabilities: ["vision", "chat", "code", "reasoning"]
      })
    ).toEqual(["chat", "code", "vision", "reasoning"]);
  });

  it("falls back to a dash when no capabilities are present", () => {
    expect(describeModelCapabilities({ ...baseModel, capabilities: [] })).toEqual(["-"]);
  });
});

describe("formatCapabilityLabel", () => {
  it("formats capability labels for the UI", () => {
    expect(formatCapabilityLabel("chat")).toBe("Chat");
    expect(formatCapabilityLabel("code")).toBe("Code");
    expect(formatCapabilityLabel("vision")).toBe("Vision");
    expect(formatCapabilityLabel("reasoning")).toBe("Reasoning");
    expect(formatCapabilityLabel("-")).toBe("-");
  });
});

describe("capabilityTone", () => {
  it("maps capabilities to stable badge tones", () => {
    expect(capabilityTone("code")).toBe("ok");
    expect(capabilityTone("reasoning")).toBe("ok");
    expect(capabilityTone("vision")).toBe("warn");
    expect(capabilityTone("chat")).toBe("info");
  });
});

describe("formatModelRoleLabel", () => {
  it("formats known and fallback role labels for the UI", () => {
    expect(formatModelRoleLabel("primary_coding")).toBe("Primary Coding");
    expect(formatModelRoleLabel("vision_candidate")).toBe("Vision");
    expect(formatModelRoleLabel("embedding")).toBe("embedding");
    expect(formatModelRoleLabel(undefined)).toBe("-");
  });
});

describe("modelRoleTone", () => {
  it("maps recommended_use values to stable badge tones", () => {
    expect(modelRoleTone("primary_coding")).toBe("ok");
    expect(modelRoleTone("orchestrator")).toBe("ok");
    expect(modelRoleTone("vision_candidate")).toBe("warn");
    expect(modelRoleTone("chat_candidate")).toBe("info");
  });
});

describe("formatCompatibilityLabel", () => {
  it("formats compatibility values for the UI", () => {
    expect(formatCompatibilityLabel("llama_server_ready")).toBe("llama-server bereit");
    expect(formatCompatibilityLabel("ollama_ready")).toBe("Ollama bereit");
    expect(formatCompatibilityLabel("support_artifact")).toBe("Hilfsartefakt");
    expect(formatCompatibilityLabel("custom_value")).toBe("custom value");
    expect(formatCompatibilityLabel(null)).toBe("-");
  });
});

describe("compatibilityTone", () => {
  it("maps compatibility values to stable badge tones", () => {
    expect(compatibilityTone("llama_server_ready")).toBe("ok");
    expect(compatibilityTone("ollama_ready")).toBe("ok");
    expect(compatibilityTone("support_artifact")).toBe("warn");
    expect(compatibilityTone("unknown")).toBe("info");
  });
});

describe("formatLauncherLabel", () => {
  it("formats runtime launcher values for the UI", () => {
    expect(formatLauncherLabel("llama_server")).toBe("llama-server");
    expect(formatLauncherLabel("ollama")).toBe("Ollama");
    expect(formatLauncherLabel("custom_launcher")).toBe("custom launcher");
    expect(formatLauncherLabel(null)).toBe("-");
  });
});

describe("launcherTone", () => {
  it("maps runtime launchers to stable badge tones", () => {
    expect(launcherTone("llama_server")).toBe("ok");
    expect(launcherTone("ollama")).toBe("ok");
    expect(launcherTone("custom")).toBe("info");
  });
});

describe("formatSupportArtifactTypeLabel", () => {
  it("formats support artifact types for the UI", () => {
    expect(formatSupportArtifactTypeLabel("mmproj")).toBe("MMProj");
    expect(formatSupportArtifactTypeLabel("lora")).toBe("LoRA");
    expect(formatSupportArtifactTypeLabel("adapter")).toBe("Adapter");
    expect(formatSupportArtifactTypeLabel("clip")).toBe("clip");
  });
});

describe("supportArtifactTypeTone", () => {
  it("maps support artifact types to stable badge tones", () => {
    expect(supportArtifactTypeTone("mmproj")).toBe("warn");
    expect(supportArtifactTypeTone("adapter")).toBe("info");
    expect(supportArtifactTypeTone("lora")).toBe("info");
    expect(supportArtifactTypeTone("clip")).toBe("info");
  });
});
