import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair } from "@dbzs/shared";
import { collectDiagnosticsIssues, summarizeDiagnosticsIssues } from "./RuntimeModelsTab.helpers";

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

describe("collectDiagnosticsIssues", () => {
  it("returns no issues for a fully healthy index", () => {
    expect(collectDiagnosticsIssues([baseModel], [], [])).toEqual([]);
  });

  it("flags blocked models using the exclusion reason", () => {
    const blockedModel: IndexedModel = {
      ...baseModel,
      id: "m2",
      name: "missing.gguf",
      compatibility: "llama_server_missing_file"
    };

    const issues = collectDiagnosticsIssues([blockedModel], [], []);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: "model:m2",
      area: "Modell",
      title: "missing.gguf"
    });
  });

  it("flags ambiguous and missing-base multimodal pairs as errors", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "ambiguous:mmproj-1",
        base_model_id: null,
        projector_artifact_id: "mmproj-1",
        modalities: ["text", "image"],
        source: "same_folder",
        confidence: 0.4,
        status: "ambiguous",
        routing_allowed: false,
        candidate_base_model_ids: ["m1", "m2"]
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
        id: "verified:mmproj-3",
        base_model_id: "m1",
        projector_artifact_id: "mmproj-3",
        modalities: ["text", "image"],
        source: "manual",
        confidence: 1,
        status: "candidate",
        routing_allowed: true,
        candidate_base_model_ids: ["m1"]
      }
    ];

    const issues = collectDiagnosticsIssues([], pairs, []);

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
    expect(issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(["pair:ambiguous:mmproj-1", "pair:missing_base:mmproj-2"])
    );
  });

  it("does not flag candidate pairs that are simply awaiting a probe", () => {
    const pairs: MultimodalPair[] = [
      {
        id: "candidate:mmproj-1",
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

    expect(collectDiagnosticsIssues([], pairs, [])).toEqual([]);
  });

  it("flags orphan support artifacts as warnings", () => {
    const orphanArtifact: IndexedModel = {
      ...baseModel,
      id: "mmproj-1",
      name: "mmproj-orphan.gguf",
      artifact_type: "mmproj",
      capabilities: ["vision"],
      modality: ["image"],
      compatibility: "support_artifact",
      recommended_use: "vision_candidate"
    };

    const issues = collectDiagnosticsIssues([], [], [orphanArtifact]);

    expect(issues).toEqual([
      {
        id: "artifact:mmproj-1",
        severity: "warn",
        area: "Hilfsartefakt",
        title: "mmproj-orphan.gguf",
        detail: "Kein passendes Basismodell erkannt; Routing bleibt gesperrt"
      }
    ]);
  });

  it("sorts errors before warnings", () => {
    const models: IndexedModel[] = [
      { ...baseModel, id: "warn-b", name: "zeta.gguf", exclusion_reasons: ["missing_profile"] },
      { ...baseModel, id: "err-a", name: "alpha.gguf", compatibility: "llama_server_missing_file" }
    ];

    const issues = collectDiagnosticsIssues(models, [], []);

    expect(issues.map((issue) => issue.severity)).toEqual(["error", "warn"]);
  });
});

describe("summarizeDiagnosticsIssues", () => {
  it("counts errors and warnings separately", () => {
    expect(
      summarizeDiagnosticsIssues([
        { id: "1", severity: "error", area: "Modell", title: "a", detail: "" },
        { id: "2", severity: "warn", area: "Hilfsartefakt", title: "b", detail: "" },
        { id: "3", severity: "warn", area: "MM-Paar", title: "c", detail: "" }
      ])
    ).toEqual({ errors: 1, warnings: 2 });
  });

  it("returns zero counts for an empty issue list", () => {
    expect(summarizeDiagnosticsIssues([])).toEqual({ errors: 0, warnings: 0 });
  });
});
