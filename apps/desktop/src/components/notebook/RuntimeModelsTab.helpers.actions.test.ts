import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair, RuntimeStatus } from "@dbzs/shared";
import {
  describeMultimodalPairAction,
  describeMultimodalPairBaseModel,
  describeMultimodalPairProjector,
  formatSupportArtifactStatusLabel,
  multimodalCandidateSummaryTone,
  multimodalPairActionHint,
  multimodalPairHintTone,
  multimodalPairStatusTone,
  sortMultimodalPairs,
  sortVisibleSupportArtifacts,
  summarizeStartableModelActions,
  summarizeSupportArtifacts,
  summarizeVisibleSupportArtifactActions,
  summarizeVisibleSupportArtifactStatuses,
  supportArtifactHintTone,
  supportArtifactStatusTone
} from "./RuntimeModelsTab.helpers";
import {
  describeBaseModelSelection,
  formatPairingProbeButtonLabel,
  formatPairingSaveButtonLabel
} from "./RuntimeModelsTab.pairing";

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
    expect(formatSupportArtifactStatusLabel("verified")).toBe("Verifiziert");
    expect(formatSupportArtifactStatusLabel("candidate")).toBe("Kandidat");
    expect(formatSupportArtifactStatusLabel("orphan")).toBe("Verwaist");
    expect(formatSupportArtifactStatusLabel("missing_base")).toBe("Basis fehlt");
    expect(formatSupportArtifactStatusLabel("support_artifact")).toBe("Hilfsartefakt");
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
