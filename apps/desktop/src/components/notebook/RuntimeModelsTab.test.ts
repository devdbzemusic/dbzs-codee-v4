import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair, RuntimeProbeResponse, RuntimeStatus } from "@dbzs/shared";
import {
  canProbeSupportArtifactPair,
  collectProbeEvidenceItems,
  collectProbeEvidenceLines,
  defaultPairingSelection,
  describeModelCapabilities,
  describeModelRoutingReadiness,
  compatibilityTone,
  describeMultimodalPairAction,
  describeMultimodalPairBaseModel,
  describeMultimodalPairProjector,
  describeBaseModelSelection,
  describeSupportArtifactFile,
  formatPairingProbeButtonLabel,
  formatPairingSaveButtonLabel,
  formatSupportArtifactStatusLabel,
  multimodalPairActionHint,
  describeSupportArtifactAction,
  supportArtifactActionHint,
  describeModelRowStatus,
  formatCompatibilityLabel,
  formatCapabilityLabel,
  formatLauncherLabel,
  formatModelRoleLabel,
  capabilityTone,
  describeMultimodalPairCandidates,
  describeProbeOutcome,
  describeMultimodalPairStatus,
  describeProbeFailureCodes,
  describeSupportArtifact,
  formatMultimodalPairModalities,
  formatMultimodalPairSource,
  sortMultimodalPairs,
  formatMultimodalPairConfidence,
  launcherTone,
  modelRoleTone,
  multimodalConfidenceTone,
  multimodalCandidateSummaryTone,
  multimodalPairHintTone,
  multimodalPairSourceTone,
  formatProbeFeedback,
  modelRowActionState,
  modelRoutingTone,
  multimodalPairStatusTone,
  shouldDisplaySupportArtifact,
  shouldManagePairInControlCenter,
  sortStartableModels,
  sortVisibleSupportArtifacts,
  supportArtifactTypeTone,
  supportArtifactHintTone,
  formatSupportArtifactTypeLabel,
  supportArtifactStatusTone,
  summarizeMultimodalPairActions,
  summarizeMultimodalPairSources,
  summarizeModelRoles,
  summarizeModelRoutingReadiness,
  summarizeStartableModelActions,
  summarizeSupportArtifacts,
  summarizeVisibleSupportArtifactStatuses,
  summarizeVisibleSupportArtifactActions,
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

describe("describeModelRowStatus", () => {
  it("describes running, loadable and blocked model rows from action state", () => {
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

    expect(describeModelRowStatus(baseModel, running, false)).toEqual({
      label: "laeuft",
      tone: "ok"
    });
    expect(describeModelRowStatus(baseModel, { state: "stopped" } as RuntimeStatus, false)).toEqual({
      label: "ladbar",
      tone: "info"
    });
    expect(describeModelRowStatus({ ...baseModel, id: "m2", name: "other.gguf" }, running, true)).toEqual({
      label: "blockiert",
      tone: "error"
    });
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

describe("describeSupportArtifactAction", () => {
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

  it("describes pairing-managed, probe-ready, assignable and read-only support actions", () => {
    const pairingCandidates = [{ ...baseModel, id: "m1" }];

    expect(
      describeSupportArtifactAction(
        mmprojArtifact,
        {
          id: "managed:mmproj-1",
          base_model_id: null,
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0.4,
          status: "ambiguous",
          routing_allowed: false,
          candidate_base_model_ids: ["m1", "m2"]
        },
        pairingCandidates
      )
    ).toEqual({ label: "MM-Pairing", tone: "info" });

    expect(
      describeSupportArtifactAction(
        mmprojArtifact,
        {
          id: "probe:mmproj-1",
          base_model_id: "m1",
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "manual",
          confidence: 1,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m1"]
        },
        pairingCandidates
      )
    ).toEqual({ label: "Probe", tone: "ok" });

    expect(describeSupportArtifactAction(mmprojArtifact, undefined, pairingCandidates)).toEqual({
      label: "Zuordnen",
      tone: "warn"
    });

    expect(
      describeSupportArtifactAction(
        {
          ...baseModel,
          id: "adapter-1",
          artifact_type: "adapter",
          compatibility: "support_artifact"
        },
        undefined,
        pairingCandidates
      )
    ).toEqual({ label: "Hinweis", tone: "info" });
  });
});

describe("supportArtifactActionHint", () => {
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

  it("describes the next step for support artifacts in stable language", () => {
    const pairingCandidates = [{ ...baseModel, id: "m1" }];

    expect(
      supportArtifactActionHint(
        mmprojArtifact,
        {
          id: "probe:mmproj-1",
          base_model_id: "m1",
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "manual",
          confidence: 1,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m1"]
        },
        pairingCandidates
      )
    ).toBe("Runtime-Probe kann direkt aus dieser Zeile gestartet werden.");

    expect(
      supportArtifactActionHint(
        mmprojArtifact,
        {
          id: "managed:mmproj-1",
          base_model_id: null,
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0.3,
          status: "ambiguous",
          routing_allowed: false,
          candidate_base_model_ids: ["m1", "m2"]
        },
        pairingCandidates
      )
    ).toBe('Im Bereich "Multimodale Paare" weiterfuehren.');

    expect(supportArtifactActionHint(mmprojArtifact, undefined, pairingCandidates)).toBe(
      "Basismodell auswaehlen und Zuordnung hier speichern."
    );

    expect(
      supportArtifactActionHint(
        {
          ...baseModel,
          id: "adapter-1",
          artifact_type: "adapter",
          compatibility: "support_artifact"
        },
        undefined,
        pairingCandidates
      )
    ).toBe("Nur Referenz im Modellindex; keine direkte Runtime-Aktion.");
  });
});

describe("describeSupportArtifactFile", () => {
  it("describes support artifact file label and parent folder for the UI", () => {
    expect(
      describeSupportArtifactFile({
        ...baseModel,
        id: "mmproj-1",
        name: "mmproj-test.gguf",
        path: "D:/Models/Vision/mmproj-test.gguf",
        artifact_type: "mmproj",
        compatibility: "support_artifact"
      })
    ).toEqual({
      label: "mmproj-test.gguf",
      location: "Vision",
      tone: "info"
    });

    expect(
      describeSupportArtifactFile({
        ...baseModel,
        id: "adapter-1",
        name: "adapter.gguf",
        path: "",
        artifact_type: "adapter",
        compatibility: "support_artifact"
      })
    ).toEqual({
      label: "adapter.gguf",
      location: "-",
      tone: "info"
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
      label: "Verified",
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
      label: "Ambiguous",
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

describe("summarizeMultimodalPairSources", () => {
  it("counts manual, catalog, same-folder and other source buckets", () => {
    expect(
      summarizeMultimodalPairSources([
        {
          id: "manual:mmproj-1",
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
          id: "catalog:mmproj-2",
          base_model_id: "m2",
          projector_artifact_id: "mmproj-2",
          modalities: ["text", "image"],
          source: "catalog",
          confidence: 0.9,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m2"]
        },
        {
          id: "same-folder:mmproj-3",
          base_model_id: "m3",
          projector_artifact_id: "mmproj-3",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0.8,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m3"]
        },
        {
          id: "other:mmproj-4",
          base_model_id: "m4",
          projector_artifact_id: "mmproj-4",
          modalities: ["text", "image"],
          source: "imported",
          confidence: 0.5,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m4"]
        }
      ])
    ).toEqual({
      manual: 1,
      catalog: 1,
      sameFolder: 1,
      other: 1
    });
  });
});

describe("summarizeMultimodalPairActions", () => {
  it("counts probe-ready, assignment-needed, resolved and blocked pair actions", () => {
    expect(
      summarizeMultimodalPairActions([
        {
          id: "resolved:mmproj-1",
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
          id: "probe:mmproj-2",
          base_model_id: "m2",
          projector_artifact_id: "mmproj-2",
          modalities: ["text", "image"],
          source: "catalog",
          confidence: 0.9,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m2"]
        },
        {
          id: "assign:mmproj-3",
          base_model_id: null,
          projector_artifact_id: "mmproj-3",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0.5,
          status: "ambiguous",
          routing_allowed: false,
          candidate_base_model_ids: ["m3", "m4"]
        },
        {
          id: "blocked:mmproj-4",
          base_model_id: null,
          projector_artifact_id: "mmproj-4",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0,
          status: "missing_base",
          routing_allowed: false,
          candidate_base_model_ids: []
        }
      ])
    ).toEqual({
      probeReady: 1,
      needsAssignment: 1,
      resolved: 1,
      blocked: 1
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
    expect(formatMultimodalPairSource("same_folder")).toBe("Same Folder");
    expect(formatMultimodalPairSource("manual")).toBe("Manual");
    expect(formatMultimodalPairSource("catalog")).toBe("Catalog");
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
    expect(formatCompatibilityLabel("llama_server_ready")).toBe("llama-server ready");
    expect(formatCompatibilityLabel("ollama_ready")).toBe("Ollama ready");
    expect(formatCompatibilityLabel("support_artifact")).toBe("Support artifact");
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

describe("modelRoutingTone", () => {
  it("maps routing labels to stable badge tones", () => {
    expect(modelRoutingTone("Vision + Code")).toBe("ok");
    expect(modelRoutingTone("Text + Code")).toBe("ok");
    expect(modelRoutingTone("Vision direkt")).toBe("warn");
    expect(modelRoutingTone("Vision Chat")).toBe("warn");
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

describe("multimodalPairStatusTone", () => {
  it("maps pair status and routing gate to stable tones", () => {
    expect(multimodalPairStatusTone("candidate", true)).toBe("ok");
    expect(multimodalPairStatusTone("candidate", false)).toBe("warn");
    expect(multimodalPairStatusTone("ambiguous", false)).toBe("error");
    expect(multimodalPairStatusTone("missing_base", false)).toBe("error");
  });
});

describe("multimodalPairHintTone", () => {
  it("maps pair hint emphasis to stable tones", () => {
    expect(
      multimodalPairHintTone({
        id: "ready:mmproj",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      })
    ).toBe("ok");
    expect(
      multimodalPairHintTone({
        id: "candidate:mmproj",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.8,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      })
    ).toBe("warn");
    expect(
      multimodalPairHintTone({
        id: "ambiguous:mmproj",
        base_model_id: null,
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.3,
        status: "ambiguous",
        routing_allowed: false,
        candidate_base_model_ids: ["m1", "m2"]
      })
    ).toBe("error");
  });
});

describe("multimodalCandidateSummaryTone", () => {
  it("maps candidate summary emphasis to stable tones", () => {
    expect(
      multimodalCandidateSummaryTone({
        id: "ready:mmproj",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      })
    ).toBe("ok");
    expect(
      multimodalCandidateSummaryTone({
        id: "multi-candidate:mmproj",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.8,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1", "m2"]
      })
    ).toBe("warn");
    expect(
      multimodalCandidateSummaryTone({
        id: "ambiguous:mmproj",
        base_model_id: null,
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.3,
        status: "ambiguous",
        routing_allowed: false,
        candidate_base_model_ids: ["m1", "m2"]
      })
    ).toBe("error");
    expect(
      multimodalCandidateSummaryTone({
        id: "single-candidate:mmproj",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.7,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      })
    ).toBe("info");
  });
});

describe("describeMultimodalPairAction", () => {
  const projector: IndexedModel = {
    ...baseModel,
    id: "mmproj-1",
    name: "mmproj-test.gguf",
    artifact_type: "mmproj",
    compatibility: "support_artifact",
    recommended_use: "vision_candidate"
  };

  it("describes resolved, probe-ready, assignable and blocked pair actions", () => {
    const pairingCandidates = [{ ...baseModel, id: "m1" }];

    expect(
      describeMultimodalPairAction(
        {
          id: "resolved:mmproj-1",
          base_model_id: "m1",
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "manual",
          confidence: 1,
          status: "candidate",
          routing_allowed: true,
          candidate_base_model_ids: ["m1"]
        },
        projector,
        pairingCandidates
      )
    ).toEqual({ label: "Erledigt", tone: "ok" });

    expect(
      describeMultimodalPairAction(
        {
          id: "probe:mmproj-1",
          base_model_id: "m1",
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "catalog",
          confidence: 0.8,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m1"]
        },
        projector,
        pairingCandidates
      )
    ).toEqual({ label: "Probe", tone: "ok" });

    expect(
      describeMultimodalPairAction(
        {
          id: "assign:mmproj-1",
          base_model_id: null,
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0.4,
          status: "ambiguous",
          routing_allowed: false,
          candidate_base_model_ids: ["m1", "m2"]
        },
        projector,
        pairingCandidates
      )
    ).toEqual({ label: "Zuordnen", tone: "warn" });

    expect(
      describeMultimodalPairAction(
        {
          id: "blocked:clip-1",
          base_model_id: null,
          projector_artifact_id: "clip-1",
          modalities: ["text", "image"],
          source: "imported",
          confidence: 0.1,
          status: "missing_base",
          routing_allowed: false,
          candidate_base_model_ids: []
        },
        {
          ...projector,
          id: "clip-1",
          artifact_type: "clip"
        },
        []
      )
    ).toEqual({ label: "Blockiert", tone: "error" });
  });
});

describe("describeMultimodalPairBaseModel", () => {
  it("describes resolved, unresolved and missing base model references", () => {
    const pair: MultimodalPair = {
      id: "pair:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "catalog",
      confidence: 0.8,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1"]
    };

    expect(describeMultimodalPairBaseModel(pair, { ...baseModel, id: "m1", name: "coder.gguf" })).toEqual({
      label: "coder.gguf",
      tone: "ok"
    });
    expect(describeMultimodalPairBaseModel(pair, undefined)).toEqual({
      label: "m1",
      tone: "warn"
    });
    expect(describeMultimodalPairBaseModel({ ...pair, base_model_id: null }, undefined)).toEqual({
      label: "Kein Basismodell",
      tone: "error"
    });
  });
});

describe("describeMultimodalPairProjector", () => {
  it("describes resolved and unresolved projector references", () => {
    const pair: MultimodalPair = {
      id: "pair:mmproj-1",
      base_model_id: "m1",
      projector_artifact_id: "mmproj-1",
      modalities: ["text", "image"],
      source: "catalog",
      confidence: 0.8,
      status: "candidate",
      routing_allowed: false,
      candidate_base_model_ids: ["m1"]
    };

    expect(
      describeMultimodalPairProjector(pair, {
        ...baseModel,
        id: "mmproj-1",
        name: "mmproj-test.gguf",
        artifact_type: "mmproj",
        compatibility: "support_artifact"
      })
    ).toEqual({
      label: "mmproj-test.gguf",
      tone: "ok"
    });
    expect(describeMultimodalPairProjector(pair, undefined)).toEqual({
      label: "mmproj-1",
      tone: "warn"
    });
  });
});

describe("describeBaseModelSelection", () => {
  it("describes selected, unresolved and empty base model selections", () => {
    const modelsById = new Map<string, IndexedModel>([
      ["m1", { ...baseModel, id: "m1", name: "coder.gguf" }]
    ]);

    expect(describeBaseModelSelection("m1", modelsById)).toEqual({
      label: "coder.gguf",
      tone: "ok"
    });
    expect(describeBaseModelSelection("missing-id", modelsById)).toEqual({
      label: "missing-id",
      tone: "warn"
    });
    expect(describeBaseModelSelection("", modelsById)).toEqual({
      label: "Keine Auswahl",
      tone: "info"
    });
  });
});

describe("formatPairingSaveButtonLabel", () => {
  it("formats save button labels for initial and repeated manual pairing", () => {
    expect(formatPairingSaveButtonLabel("manual", false)).toBe("Neu zuordnen");
    expect(formatPairingSaveButtonLabel("catalog", false)).toBe("Zuordnen");
    expect(formatPairingSaveButtonLabel(undefined, true)).toBe("Speichert ...");
  });
});

describe("formatPairingProbeButtonLabel", () => {
  it("formats probe button labels for idle and running state", () => {
    expect(formatPairingProbeButtonLabel(false)).toBe("Probe");
    expect(formatPairingProbeButtonLabel(true)).toBe("Prueft ...");
  });
});

describe("multimodalPairActionHint", () => {
  const projector: IndexedModel = {
    ...baseModel,
    id: "mmproj-1",
    name: "mmproj-test.gguf",
    artifact_type: "mmproj",
    compatibility: "support_artifact",
    recommended_use: "vision_candidate"
  };

  it("describes the next step for multimodal pairs in stable language", () => {
    const pairingCandidates = [{ ...baseModel, id: "m1" }];

    expect(
      multimodalPairActionHint(
        {
          id: "resolved:mmproj-1",
          base_model_id: "m1",
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "manual",
          confidence: 1,
          status: "candidate",
          routing_allowed: true,
          candidate_base_model_ids: ["m1"]
        },
        projector,
        pairingCandidates
      )
    ).toBe("Pair ist verifiziert und fuer Routing freigegeben.");

    expect(
      multimodalPairActionHint(
        {
          id: "probe:mmproj-1",
          base_model_id: "m1",
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "catalog",
          confidence: 0.8,
          status: "candidate",
          routing_allowed: false,
          candidate_base_model_ids: ["m1"]
        },
        projector,
        pairingCandidates
      )
    ).toBe("Runtime-Probe kann direkt aus dieser Zeile gestartet werden.");

    expect(
      multimodalPairActionHint(
        {
          id: "assign:mmproj-1",
          base_model_id: null,
          projector_artifact_id: "mmproj-1",
          modalities: ["text", "image"],
          source: "same_folder",
          confidence: 0.4,
          status: "ambiguous",
          routing_allowed: false,
          candidate_base_model_ids: ["m1", "m2"]
        },
        projector,
        pairingCandidates
      )
    ).toBe("Basismodell auswaehlen und Pairing hier aktualisieren.");

    expect(
      multimodalPairActionHint(
        {
          id: "blocked:clip-1",
          base_model_id: null,
          projector_artifact_id: "clip-1",
          modalities: ["text", "image"],
          source: "imported",
          confidence: 0.1,
          status: "missing_base",
          routing_allowed: false,
          candidate_base_model_ids: []
        },
        {
          ...projector,
          id: "clip-1",
          artifact_type: "clip"
        },
        []
      )
    ).toBe("Erst Zuordnung oder Basismodell-Lage klaeren, dann erneut pruefen.");
  });
});

describe("summarizeStartableModelActions", () => {
  it("counts running, loadable and blocked startable models from action state", () => {
    const models: IndexedModel[] = [
      {
        ...baseModel,
        id: "running-model",
        name: "running-model.gguf"
      },
      {
        ...baseModel,
        id: "loadable-model",
        name: "loadable-model.gguf"
      },
      {
        ...baseModel,
        id: "blocked-model",
        name: "blocked-model.gguf"
      }
    ];

    const runningStatus: RuntimeStatus = {
      state: "running",
      model_id: "running-model",
      model_name: "running-model.gguf",
      provider: "llama.cpp",
      port: 8080,
      pid: 1234,
      endpoint: "http://127.0.0.1:8080",
      message: "running"
    };

    expect(summarizeStartableModelActions(models, runningStatus, false)).toEqual({
      running: 1,
      loadable: 0,
      blocked: 2
    });

    expect(summarizeStartableModelActions(models, { state: "stopped" } as RuntimeStatus, false)).toEqual({
      running: 0,
      loadable: 3,
      blocked: 0
    });
  });
});

describe("supportArtifactStatusTone", () => {
  it("maps support artifact status labels to stable tones", () => {
    expect(supportArtifactStatusTone("verified")).toBe("ok");
    expect(supportArtifactStatusTone("candidate")).toBe("warn");
    expect(supportArtifactStatusTone("orphan")).toBe("error");
    expect(supportArtifactStatusTone("ambiguous")).toBe("error");
    expect(supportArtifactStatusTone("support_artifact")).toBe("info");
  });
});

describe("formatSupportArtifactStatusLabel", () => {
  it("formats support artifact status labels for the UI", () => {
    expect(formatSupportArtifactStatusLabel("verified")).toBe("Verified");
    expect(formatSupportArtifactStatusLabel("candidate")).toBe("Candidate");
    expect(formatSupportArtifactStatusLabel("orphan")).toBe("Orphan");
    expect(formatSupportArtifactStatusLabel("missing_base")).toBe("Missing Base");
    expect(formatSupportArtifactStatusLabel("support_artifact")).toBe("Support Artifact");
    expect(formatSupportArtifactStatusLabel("custom_status")).toBe("custom status");
  });
});

describe("supportArtifactHintTone", () => {
  it("reuses support artifact status emphasis for hint rendering", () => {
    expect(supportArtifactHintTone("verified")).toBe("ok");
    expect(supportArtifactHintTone("candidate")).toBe("warn");
    expect(supportArtifactHintTone("orphan")).toBe("error");
    expect(supportArtifactHintTone("support_artifact")).toBe("info");
  });
});

describe("summarizeSupportArtifacts", () => {
  it("counts mmproj, adapter/lora and other visible support artifacts", () => {
    expect(
      summarizeSupportArtifacts([
        {
          ...baseModel,
          id: "mmproj-1",
          artifact_type: "mmproj",
          recommended_use: "vision_candidate"
        },
        {
          ...baseModel,
          id: "adapter-1",
          artifact_type: "adapter",
          recommended_use: "coding_candidate"
        },
        {
          ...baseModel,
          id: "lora-1",
          artifact_type: "lora",
          recommended_use: "coding_candidate"
        },
        {
          ...baseModel,
          id: "clip-1",
          artifact_type: "clip",
          recommended_use: "vision_candidate"
        }
      ])
    ).toEqual({
      mmproj: 1,
      adapter: 2,
      other: 1
    });
  });
});

describe("summarizeVisibleSupportArtifactActions", () => {
  it("counts probe-ready, manual-assignment and read-only visible support actions", () => {
    const visibleArtifacts: IndexedModel[] = [
      {
        ...baseModel,
        id: "mmproj-probe",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "mmproj-manual",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "adapter-1",
        artifact_type: "adapter",
        recommended_use: "coding_candidate"
      }
    ];

    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-probe",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-probe",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.9,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      }
    ];

    expect(
      summarizeVisibleSupportArtifactActions(visibleArtifacts, pairs, [
        {
          ...baseModel,
          id: "m1"
        }
      ])
    ).toEqual({
      probeReady: 1,
      manualAssignment: 1,
      readOnly: 1
    });
  });
});

describe("summarizeVisibleSupportArtifactStatuses", () => {
  it("counts verified, candidate, orphan and other visible support statuses", () => {
    const visibleArtifacts: IndexedModel[] = [
      {
        ...baseModel,
        id: "mmproj-verified",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "mmproj-candidate",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "mmproj-orphan",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "adapter-1",
        artifact_type: "adapter",
        recommended_use: "coding_candidate"
      }
    ];

    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-verified",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-verified",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      },
      {
        id: "m2:mmproj-candidate",
        base_model_id: "m2",
        projector_artifact_id: "mmproj-candidate",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.8,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m2"]
      }
    ];

    expect(summarizeVisibleSupportArtifactStatuses(visibleArtifacts, pairs)).toEqual({
      verified: 1,
      candidate: 1,
      orphan: 1,
      other: 1
    });
  });
});

describe("sortVisibleSupportArtifacts", () => {
  it("prioritizes probe-ready and manual mmproj artifacts before read-only support files", () => {
    const visibleArtifacts: IndexedModel[] = [
      {
        ...baseModel,
        id: "adapter-1",
        name: "adapter-a.gguf",
        artifact_type: "adapter",
        recommended_use: "coding_candidate"
      },
      {
        ...baseModel,
        id: "mmproj-manual",
        name: "mmproj-manual.gguf",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      },
      {
        ...baseModel,
        id: "mmproj-probe",
        name: "mmproj-probe.gguf",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate"
      }
    ];

    const pairs: MultimodalPair[] = [
      {
        id: "m1:mmproj-probe",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-probe",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.8,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m1"]
      }
    ];

    expect(
      sortVisibleSupportArtifacts(visibleArtifacts, pairs, [
        {
          ...baseModel,
          id: "m1"
        }
      ]).map((artifact) => artifact.id)
    ).toEqual(["mmproj-probe", "mmproj-manual", "adapter-1"]);
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
