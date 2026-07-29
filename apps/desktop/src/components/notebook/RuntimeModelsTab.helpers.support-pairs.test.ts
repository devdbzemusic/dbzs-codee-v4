import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair, RuntimeProbeResponse } from "@dbzs/shared";
import {
  canProbeSupportArtifactPair,
  collectProbeEvidenceItems,
  collectProbeEvidenceLines,
  describeMultimodalPairCandidates,
  describeMultimodalPairRouting,
  describeMultimodalPairStatus,
  describeProbeFailureCodes,
  describeProbeOutcome,
  describeSupportArtifact,
  describeSupportArtifactAction,
  describeSupportArtifactFile,
  formatMultimodalPairControlSurface,
  formatProbeFeedback,
  formatSupportArtifactControlSurface,
  shouldManagePairInControlCenter,
  shouldRenderStandaloneMultimodalProbeButton,
  summarizeMultimodalPairActions,
  summarizeMultimodalPairSources,
  summarizeMultimodalPairs,
  supportArtifactActionHint
} from "./RuntimeModelsTab.helpers";
import {
  defaultPairingSelection,
  describePairingTargetBadge
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
      hint: "Ordner-Paar erkannt, aber noch nicht runtime-verifiziert"
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

  it("surfaces missing-base pair state for mmproj artifacts", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "missing:mmproj-1",
        base_model_id: null,
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0,
        status: "missing_base",
        routing_allowed: false,
        candidate_base_model_ids: []
      }
    ];

    expect(describeSupportArtifact(mmprojArtifact, pairs)).toEqual({
      statusLabel: "missing_base",
      hint: "Projektor erkannt, aber kein Basismodell im selben Ordner gefunden"
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

describe("formatMultimodalPairControlSurface", () => {
  it("describes whether multimodal pairs can be managed inline, probed, or only inspected", () => {
    expect(formatMultimodalPairControlSurface(true, false)).toEqual({
      label: "Inline-Steuerung",
      tone: "ok"
    });
    expect(formatMultimodalPairControlSurface(false, true)).toEqual({
      label: "Probe bereit",
      tone: "info"
    });
    expect(formatMultimodalPairControlSurface(false, false)).toEqual({
      label: "Nur Status",
      tone: "info"
    });
  });
});

describe("shouldRenderStandaloneMultimodalProbeButton", () => {
  it("only renders the standalone probe action when no inline pairing is shown but probing is possible", () => {
    expect(shouldRenderStandaloneMultimodalProbeButton(true, true)).toBe(false);
    expect(shouldRenderStandaloneMultimodalProbeButton(true, false)).toBe(false);
    expect(shouldRenderStandaloneMultimodalProbeButton(false, true)).toBe(true);
    expect(shouldRenderStandaloneMultimodalProbeButton(false, false)).toBe(false);
  });
});

describe("formatSupportArtifactControlSurface", () => {
  it("describes whether support actions continue in the mm block or inline", () => {
    expect(formatSupportArtifactControlSurface(true, false)).toEqual({
      label: "MM-Bereich",
      tone: "info"
    });
    expect(formatSupportArtifactControlSurface(false, true)).toEqual({
      label: "Inline-Steuerung",
      tone: "ok"
    });
    expect(formatSupportArtifactControlSurface(false, false)).toEqual({
      label: "Nur Anzeige",
      tone: "info"
    });
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
      label: "Verifiziert",
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
      label: "Mehrdeutig",
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

describe("describeMultimodalPairRouting", () => {
  it("separates released, probe-pending, blocked and generic locked routing states", () => {
    expect(
      describeMultimodalPairRouting({
        id: "verified:mmproj-1",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      })
    ).toEqual({
      label: "Freigegeben",
      tone: "ok"
    });
    expect(
      describeMultimodalPairRouting({
        id: "probe:mmproj-2",
        base_model_id: "m2",
        projector_artifact_id: "mmproj-2",
        modalities: ["text", "image"],
        source: "catalog",
        confidence: 0.8,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: ["m2"]
      })
    ).toEqual({
      label: "Probe ausstehend",
      tone: "warn"
    });
    expect(
      describeMultimodalPairRouting({
        id: "blocked:mmproj-3",
        base_model_id: null,
        projector_artifact_id: "mmproj-3",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.2,
        status: "missing_base",
        routing_allowed: false,
        candidate_base_model_ids: []
      })
    ).toEqual({
      label: "Blockiert",
      tone: "error"
    });
    expect(
      describeMultimodalPairRouting({
        id: "locked:mmproj-4",
        base_model_id: null,
        projector_artifact_id: "mmproj-4",
        modalities: ["text", "image"],
        source: "imported",
        confidence: 0.2,
        status: "candidate",
        routing_allowed: false,
        candidate_base_model_ids: []
      })
    ).toEqual({
      label: "Gesperrt",
      tone: "info"
    });
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

describe("describePairingTargetBadge", () => {
  it("marks empty targets as open and selected targets as concrete destinations", () => {
    expect(
      describePairingTargetBadge("", {
        label: "Keine Auswahl",
        tone: "info"
      })
    ).toEqual({
      label: "Ziel offen",
      tone: "warn"
    });
    expect(
      describePairingTargetBadge("m1", {
        label: "Qwen3 Coder",
        tone: "ok"
      })
    ).toEqual({
      label: "Ziel Qwen3 Coder",
      tone: "ok"
    });
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
