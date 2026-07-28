import { describe, expect, it } from "vitest";
import type { IndexedModel, MultimodalPair, RuntimeProbeResponse, RuntimeStatus } from "@dbzs/shared";
import {
  canProbeSupportArtifactPair,
  collectProbeEvidenceLines,
  describeSupportArtifact,
  formatProbeFeedback,
  modelRowActionState
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
      vision_chat_verified: false
    };

    expect(collectProbeEvidenceLines(response)).toEqual([
      "Basis-Endpoint: fehlt",
      "/v1/models: fehlt",
      "Bildtest: fehlt",
      "MMProj: /models/mmproj-vision-base-f16.gguf",
      "stderr: port already in use",
      "stdout: retrying"
    ]);
  });
});
