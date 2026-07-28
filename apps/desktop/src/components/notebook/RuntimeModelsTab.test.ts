import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair, RuntimeProbeResponse, RuntimeStatus } from "@dbzs/shared";
import {
  canProbeSupportArtifactPair,
  collectProbeEvidenceItems,
  collectProbeEvidenceLines,
  defaultPairingSelection,
  describeModelCapabilities,
  describeModelRoutingReadiness,
  describeMultimodalPairCandidates,
  describeProbeOutcome,
  describeMultimodalPairStatus,
  describeProbeFailureCodes,
  describeSupportArtifact,
  formatMultimodalPairModalities,
  formatMultimodalPairSource,
  sortMultimodalPairs,
  formatMultimodalPairConfidence,
  formatProbeFeedback,
  modelRowActionState,
  shouldDisplaySupportArtifact,
  shouldManagePairInControlCenter,
  summarizeModelRoutingReadiness,
  summarizeMultimodalPairs
} from "./RuntimeModelsTab";

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

describe("modelRowActionState", () => {
  it("allows start only for runnable idle runtime", () => {
    const state = modelRowActionState(baseModel, { state: "stopped" } as RuntimeStatus, false);
    expect(state.canStart).toBe(true);
    expect(state.canStop).toBe(false);
  });

  it("enables stop only on the active running row", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "m1",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };
    const active = modelRowActionState(baseModel, running, false);
    const other = modelRowActionState({ ...baseModel, id: "m2", name: "other.gguf" }, running, false);

    expect(active.isActive).toBe(true);
    expect(active.canStop).toBe(true);
    expect(active.canStart).toBe(false);
    expect(other.canStart).toBe(false);
    expect(other.canStop).toBe(false);
  });

  it("matches active row by model name when ids differ", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "hash-abc",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };
    const state = modelRowActionState(baseModel, running, false);
    expect(state.isActive).toBe(true);
    expect(state.canStop).toBe(true);
  });

  it("blocks actions while runtime is busy", () => {
    const running: RuntimeStatus = {
      state: "running",
      model_id: "m1",
      model_name: "test.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };
    const state = modelRowActionState(baseModel, running, true);
    expect(state.canStart).toBe(false);
    expect(state.canStop).toBe(false);
  });
});

describe("describeSupportArtifact", () => {
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

  it("marks unpaired mmproj artifacts as orphan", () => {
    expect(describeSupportArtifact(mmprojArtifact, [])).toEqual({
      statusLabel: "orphan",
      hint: "Kein passendes Basismodell erkannt; Routing bleibt gesperrt"
    });
  });

  it("surfaces candidate pair state for mmproj artifacts", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-1",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.92,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      }
    ];

    expect(describeSupportArtifact(mmprojArtifact, pairs)).toEqual({
      statusLabel: "candidate",
      hint: "Same-Folder-Paar erkannt, aber noch nicht runtime-verifiziert"
    });
  });

  it("surfaces verified pair state when routing is allowed", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-1",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      }
    ];

    expect(describeSupportArtifact(mmprojArtifact, pairs)).toEqual({
      statusLabel: "verified",
      hint: "Runtime-Probe erfolgreich; multimodales Routing ist freigegeben"
    });
  });

  it("surfaces manual pair state for mmproj artifacts", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-1",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      }
    ];

    expect(describeSupportArtifact(mmprojArtifact, pairs)).toEqual({
      statusLabel: "candidate",
      hint: "Manuelle Zuordnung gespeichert; Runtime-Probe und Routing bleiben noch gesperrt"
    });
  });

  it("surfaces catalog pair state for mmproj artifacts", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-1",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 1,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      }
    ];

    expect(describeSupportArtifact(mmprojArtifact, pairs)).toEqual({
      statusLabel: "candidate",
      hint: "Katalog-Zuordnung erkannt, aber noch nicht runtime-verifiziert"
    });
  });
});

describe("canProbeSupportArtifactPair", () => {
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

  it("allows probing only for candidate pairs with a base model id", () => {
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

    expect(canProbeSupportArtifactPair(mmprojArtifact, pair)).toBe(true);
  });

  it("blocks probing for non-candidate pairs or non-mmproj artifacts", () => {
    const ambiguousPair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: null,
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "same_folder",
      confidence: 0.4,
      status: "ambiguous",
      routing_allowed: false,
      candidate_base_model_ids: ["m1", "m2"]
    };

    expect(canProbeSupportArtifactPair(mmprojArtifact, ambiguousPair)).toBe(false);
    expect(canProbeSupportArtifactPair({ ...mmprojArtifact, artifact_type: "clip" }, undefined)).toBe(false);
  });

  it("blocks probing again once routing is already allowed", () => {
    const verifiedPair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: true,
      candidate_base_model_ids: ["m1"]
    };

    expect(canProbeSupportArtifactPair(mmprojArtifact, verifiedPair)).toBe(false);
  });
});

describe("formatProbeFeedback", () => {
  it("includes endpoint verification details for successful probes", () => {
    const response: RuntimeProbeResponse = {
      allowed: true,
      message: "Controlled probe succeeded for vision-base on port 8091.",
      stderr_tail: "",
      stdout_tail: "",
      endpoint_verified: true,
      models_endpoint_verified: true,
      advertised_models: ["vision-base"],
      vision_chat_verified: true
    };

    expect(formatProbeFeedback(response)).toBe(
      "Controlled probe succeeded for vision-base on port 8091. (Endpoint ok | /v1/models ok | Modelle: vision-base | Bildtest ok)"
    );
  });

  it("includes missing verification details for partial probe failures", () => {
    const response: RuntimeProbeResponse = {
      allowed: false,
      message: "Controlled probe started, but verification failed for: /v1/models.",
      stderr_tail: "",
      stdout_tail: "",
      endpoint_verified: true,
      models_endpoint_verified: false,
      advertised_models: [],
      mmproj_path: "/models/mmproj-vision-base-f16.gguf",
      vision_chat_verified: false
    };

    expect(formatProbeFeedback(response)).toBe(
      "Controlled probe started, but verification failed for: /v1/models. (Endpoint ok | /v1/models fehlt | Bildtest fehlt)"
    );
  });
});

describe("collectProbeEvidenceLines", () => {
  it("collects structured probe evidence for successful multimodal probes", () => {
    const response: RuntimeProbeResponse = {
      allowed: true,
      message: "Controlled probe succeeded for vision-base on port 8091.",
      stderr_tail: "",
      stdout_tail: "",
      endpoint_verified: true,
      models_endpoint_verified: true,
      advertised_models: ["vision-base"],
      mmproj_path: "/models/mmproj-vision-base-f16.gguf",
      vision_chat_verified: true,
      vision_response_preview: "ok"
    };

    expect(collectProbeEvidenceLines(response)).toEqual([
      "Basis-Endpoint: ok",
      "/v1/models: ok",
      "Gemeldete Modelle: vision-base",
      "Bildtest: ok",
      "Vision-Antwort: ok",
      "MMProj: /models/mmproj-vision-base-f16.gguf"
    ]);
  });

  it("collects failure evidence including stream tails", () => {
    const response: RuntimeProbeResponse = {
      allowed: false,
      message: "Controlled probe failed.",
      stderr_tail: "port already in use",
      stdout_tail: "retrying",
      endpoint_verified: false,
      models_endpoint_verified: false,
      advertised_models: [],
      mmproj_path: "/models/mmproj-vision-base-f16.gguf",
      vision_chat_verified: false,
      verification_failures: ["endpoint", "models_endpoint", "vision_chat"]
    };

    expect(collectProbeEvidenceLines(response)).toEqual([
      "Basis-Endpoint: fehlt",
      "/v1/models: fehlt",
      "Bildtest: fehlt",
      "MMProj: /models/mmproj-vision-base-f16.gguf",
      "stderr: port already in use",
      "stdout: retrying",
      "Fehlgeschlagene Checks: endpoint, models_endpoint, vision_chat"
    ]);
  });
});

describe("collectProbeEvidenceItems", () => {
  it("assigns evidence tones for successful multimodal probes", () => {
    const response: RuntimeProbeResponse = {
      allowed: true,
      message: "Controlled probe succeeded for vision-base on port 8091.",
      stderr_tail: "",
      stdout_tail: "",
      endpoint_verified: true,
      models_endpoint_verified: true,
      advertised_models: ["vision-base"],
      mmproj_path: "/models/mmproj-vision-base-f16.gguf",
      vision_chat_verified: true,
      vision_response_preview: "ok"
    };

    expect(collectProbeEvidenceItems(response)).toEqual([
      { tone: "ok", text: "Basis-Endpoint: ok" },
      { tone: "ok", text: "/v1/models: ok" },
      { tone: "info", text: "Gemeldete Modelle: vision-base" },
      { tone: "ok", text: "Bildtest: ok" },
      { tone: "info", text: "Vision-Antwort: ok" },
      { tone: "info", text: "MMProj: /models/mmproj-vision-base-f16.gguf" }
    ]);
  });
});

describe("describeProbeFailureCodes", () => {
  it("formats structured probe failure codes for UI evidence", () => {
    expect(describeProbeFailureCodes(["pair_missing", "vision_chat"])).toBe("pairing, vision_chat");
  });

  it("returns an empty string when no structured failures are present", () => {
    expect(describeProbeFailureCodes([])).toBe("");
    expect(describeProbeFailureCodes(undefined)).toBe("");
  });
});

describe("describeProbeOutcome", () => {
  it("marks fully verified probes as successful", () => {
    expect(
      describeProbeOutcome({
        allowed: true,
        message: "ok",
        stderr_tail: "",
        stdout_tail: "",
        verification_failures: []
      })
    ).toEqual({
      label: "Probe verifiziert",
      tone: "ok"
    });
  });

  it("marks structured gate failures as blocked", () => {
    expect(
      describeProbeOutcome({
        allowed: false,
        message: "failed",
        stderr_tail: "",
        stdout_tail: "",
        verification_failures: ["models_endpoint"]
      })
    ).toEqual({
      label: "Probe blockiert",
      tone: "error"
    });
  });
});

describe("describeMultimodalPairStatus", () => {
  it("marks routing-allowed pairs as verified", () => {
    const pair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: true,
      candidate_base_model_ids: ["m1"]
    };

    expect(describeMultimodalPairStatus(pair)).toEqual({
      label: "verified",
      hint: "Routing freigegeben"
    });
  });

  it("surfaces unresolved pair states with focused hints", () => {
    const ambiguousPair: MultimodalPair = {
      id: "ambiguous:mmproj-1",
      base_model_id: null,
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "same_folder",
      confidence: 0.4,
      status: "ambiguous",
      routing_allowed: false,
      candidate_base_model_ids: ["m1", "m2"]
    };

    expect(describeMultimodalPairStatus(ambiguousPair)).toEqual({
      label: "ambiguous",
      hint: "Mehrdeutige Basismodell-Zuordnung"
    });
  });
});

describe("describeMultimodalPairCandidates", () => {
  it("lists resolved candidate names for ambiguous pairs", () => {
    const pair: MultimodalPair = {
      id: "ambiguous:mmproj-1",
      base_model_id: null,
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "same_folder",
      confidence: 0.4,
      status: "ambiguous",
      routing_allowed: false,
      candidate_base_model_ids: ["m1", "m2"]
    };
    const modelsById = new Map<string, IndexedModel>([
      ["m1", baseModel],
      ["m2", { ...baseModel, id: "m2", name: "other.gguf" }]
    ]);

    expect(describeMultimodalPairCandidates(pair, modelsById)).toBe("Kandidaten: test.gguf, other.gguf");
  });

  it("reports missing candidate information for missing-base pairs", () => {
    const pair: MultimodalPair = {
      id: "missing_base:mmproj-1",
      base_model_id: null,
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "same_folder",
      confidence: 0,
      status: "missing_base",
      routing_allowed: false,
      candidate_base_model_ids: []
    };

    expect(describeMultimodalPairCandidates(pair, new Map())).toBe("Keine Kandidaten erkannt");
  });
});

describe("defaultPairingSelection", () => {
  it("prefers explicit local selection over pair defaults", () => {
    const pair: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1", "m2"]
    };

    expect(defaultPairingSelection("mmproj-1", pair, { "mmproj-1": "m2" })).toBe("m2");
  });

  it("falls back to base model id and then first candidate", () => {
    const paired: MultimodalPair = {
      id: "m1:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "catalog",
      confidence: 1,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1", "m2"]
    };
    const ambiguous: MultimodalPair = {
      id: "ambiguous:mmproj-2",
      base_model_id: null,
      projector_artifact_id: "mmproj-2",
      modalities: ["text", "image"],
      source: "same_folder",
      confidence: 0.4,
      status: "ambiguous",
      routing_allowed: false,
      candidate_base_model_ids: ["m2", "m3"]
    };

    expect(defaultPairingSelection("mmproj-1", paired, {})).toBe("m1");
    expect(defaultPairingSelection("mmproj-2", ambiguous, {})).toBe("m2");
  });
});

describe("shouldManagePairInControlCenter", () => {
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

  it("routes paired mmproj artifacts into the pairing control center", () => {
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

    expect(shouldManagePairInControlCenter(mmprojArtifact, pair)).toBe(true);
  });

  it("keeps unpaired or non-mmproj artifacts out of the pairing control center", () => {
    expect(shouldManagePairInControlCenter(mmprojArtifact, undefined)).toBe(false);
    expect(shouldManagePairInControlCenter({ ...mmprojArtifact, artifact_type: "clip" }, undefined)).toBe(false);
  });
});

describe("summarizeMultimodalPairs", () => {
  it("counts verified and unresolved pair states for the control center header", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "verified:mmproj-1",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      },
      {
        id: "candidate:mmproj-2",
        base_model_id: "m2",
        projector_artifact_id: "mmproj-2",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 1,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m2"]
      },
      {
        id: "ambiguous:mmproj-3",
        base_model_id: null,
        projector_artifact_id: "mmproj-3",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.4,
        status: "ambiguous",
        routing_allowed: false,
        candidate_base_model_ids: ["m1", "m2"]
      },
      {
        id: "missing_base:mmproj-4",
        base_model_id: null,
        projector_artifact_id: "mmproj-4",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0,
        status: "missing_base",
        routing_allowed: false,
        candidate_base_model_ids: []
      }
    ];

    expect(summarizeMultimodalPairs(pairs)).toEqual({
      total: 4,
      verified: 1,
      candidate: 1,
      ambiguous: 1,
      missing_base: 1
    });
  });
});

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
    expect(formatMultimodalPairSource("same_folder")).toBe("same_folder");
    expect(formatMultimodalPairSource("manual")).toBe("manual");
    expect(formatMultimodalPairSource("catalog")).toBe("catalog");
    expect(formatMultimodalPairSource("custom")).toBe("custom");
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
      hint: "Bildinput bleibt gesperrt, bis ein verifiziertes Projector-Pair vorliegt"
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

describe("summarizeModelRoutingReadiness", () => {
  it("counts text, coding, blocked vision and screenshot-ready models", () => {
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
      visionBlocked: 1,
      screenshotReady: 1
    });
  });
});

describe("sortMultimodalPairs", () => {
  it("surfaces unresolved problem states before candidates and verified pairs", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "verified:mmproj-4",
        base_model_id: "m4",
        projector_artifact_id: "mmproj-4",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m4"]
      },
      {
        id: "candidate:mmproj-3",
        base_model_id: "m3",
        projector_artifact_id: "mmproj-3",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.8,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m3"]
      },
      {
        id: "missing_base:mmproj-2",
        base_model_id: null,
        projector_artifact_id: "mmproj-2",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0,
        status: "missing_base",
        routing_allowed: false,
        candidate_base_model_ids: []
      },
      {
        id: "ambiguous:mmproj-1",
        base_model_id: null,
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.3,
        status: "ambiguous",
        routing_allowed: false,
        candidate_base_model_ids: ["m1", "m2"]
      }
    ];

    expect(sortMultimodalPairs(pairs).map((pair) => pair.id)).toEqual([
      "ambiguous:mmproj-1",
      "missing_base:mmproj-2",
      "candidate:mmproj-3",
      "verified:mmproj-4"
    ]);
  });
});
