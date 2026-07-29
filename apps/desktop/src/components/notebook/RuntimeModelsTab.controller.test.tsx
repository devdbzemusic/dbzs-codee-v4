import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type IndexedModel, type ModelIndex, type MultimodalPair } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRuntimeModelsTabController } from "./RuntimeModelsTab.controller";

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    saveManualMultimodalPairing: vi.fn(),
    probeRuntimeModel: vi.fn()
  }
}));

function createModel(overrides: Partial<IndexedModel> = {}): IndexedModel {
  return {
    id: "model-1",
    name: "model-1.gguf",
    path: "/models/model-1.gguf",
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
    recommended_use: "chat_candidate",
    compatibility: "llama_server_ready",
    runtime: {
      ctx: 4096,
      gpu_layers: 0,
      server_enabled: true,
      preferred_port: 8080,
      health_status: "unknown",
      provider: "llama_server"
    },
    ...overrides
  };
}

function createPair(overrides: Partial<MultimodalPair> = {}): MultimodalPair {
  return {
    id: "pair-1",
    base_model_id: "base-2",
    projector_artifact_id: "mmproj-1",
    modalities: ["image", "text"],
    source: "catalog",
    confidence: 0.91,
    status: "candidate",
    routing_allowed: false,
    candidate_base_model_ids: ["base-2"],
    ...overrides
  };
}

function createIndex(): ModelIndex {
  return {
    generated_from: "catalog:/models/catalog.json",
    summary: {
      models_dir: "/models",
      runtime_dir: "/runtime",
      ollama_dir: null,
      ollama_models_dir: null,
      total: 4,
      gguf_total: 4,
      ollama_total: 0,
      llama_server_ready: 2,
      ollama_ready: 0,
      coding_candidates: 1,
      vision_candidates: 1,
      adapters: 1,
      support_artifact_count: 2,
      unsupported: 0
    },
    models: [
      createModel({
        id: "base-1",
        name: "base-1.gguf",
        recommended_use: "chat_candidate",
        capabilities: ["chat"]
      }),
      createModel({
        id: "base-2",
        name: "base-2.gguf",
        recommended_use: "primary_coding",
        capabilities: ["chat", "code"]
      })
    ],
    support_artifacts: [
      createModel({
        id: "mmproj-1",
        name: "mmproj-1.gguf",
        path: "/models/mmproj-1.gguf",
        artifact_type: "mmproj",
        recommended_use: "vision_candidate",
        capabilities: ["vision"],
        modality: ["image", "text"]
      }),
      createModel({
        id: "adapter-1",
        name: "adapter-1.safetensors",
        path: "/models/adapter-1.safetensors",
        format: "safetensors",
        artifact_type: "adapter",
        quantization: null,
        recommended_use: "adapter_only",
        compatibility: "support_artifact",
        capabilities: [],
        modality: ["text"],
        runtime: {
          ctx: 0,
          gpu_layers: 0,
          server_enabled: false,
          preferred_port: 0,
          health_status: "unknown",
          provider: "llama_server"
        }
      })
    ],
    multimodal_pairs: [createPair()]
  };
}

describe("useRuntimeModelsTabController", () => {
  beforeEach(() => {
    vi.mocked(backendClient.saveManualMultimodalPairing).mockReset();
    vi.mocked(backendClient.probeRuntimeModel).mockReset();

    useModelIndexStore.setState({
      index: createIndex(),
      isLoading: false,
      error: null,
      primaryCodingModel: null,
      loadModelIndex: vi.fn(async () => {})
    });

    useRuntimeStore.setState({
      status: null,
      doctorReport: null,
      logs: null,
      lastDoctorAction: null,
      actionResult: null,
      isLoading: false,
      isRefreshing: false,
      doctorLoading: false,
      error: null,
      loadStatus: vi.fn(async () => {}),
      loadDoctorReport: vi.fn(async () => {}),
      loadLogs: vi.fn(async () => {}),
      dryRunModel: vi.fn(async () => {}),
      probeModel: vi.fn(async () => {}),
      startModel: vi.fn(async () => {}),
      stopModel: vi.fn(async () => {})
    });

    useSettingsStore.setState((state) => ({
      ...state,
      settings: DEFAULT_SETTINGS,
      backendHealth: {
        status: "ok",
        app: "DBZS Code Assistant",
        version: "0.4.0-rc.1"
      },
      error: null
    }));
  });

  it("derives sorted models, visible support artifacts and summaries from store state", () => {
    const { result } = renderHook(() => useRuntimeModelsTabController());

    expect(result.current.backendOnline).toBe(true);
    expect(result.current.sortedStartableModels.map((model) => model.id)).toEqual(["base-2", "base-1"]);
    expect(result.current.pairingCandidates.map((model) => model.id)).toEqual(["base-1", "base-2"]);
    expect(result.current.sortedVisibleSupportArtifacts.map((artifact) => artifact.id)).toEqual(["adapter-1"]);
    expect(result.current.multimodalPairSummary).toMatchObject({
      total: 1,
      candidate: 1,
      verified: 0
    });
    expect(result.current.modelRoutingSummary).toMatchObject({
      text: 1,
      textCode: 1,
      visionBlocked: 0,
      screenshotReady: 0
    });
    expect(result.current.supportArtifactSummary).toMatchObject({
      adapter: 1,
      mmproj: 0
    });
  });

  it("stores manual pairing feedback and reloads the model index after saving", async () => {
    const loadModelIndex = vi.fn(async () => {});
    useModelIndexStore.setState((state) => ({
      ...state,
      loadModelIndex
    }));
    vi.mocked(backendClient.saveManualMultimodalPairing).mockResolvedValue(
      createPair({
        source: "manual"
      })
    );

    const { result } = renderHook(() => useRuntimeModelsTabController());

    await act(async () => {
      await result.current.pairingUi.saveManualPairing("mmproj-1", "base-2");
    });

    expect(backendClient.saveManualMultimodalPairing).toHaveBeenCalledWith({
      base_model_id: "base-2",
      projector_artifact_id: "mmproj-1"
    });
    expect(loadModelIndex).toHaveBeenCalledOnce();
    expect(result.current.pairingUi.pairingSaving["mmproj-1"]).toBe(false);
    expect(result.current.pairingUi.pairingFeedback["mmproj-1"]).toBe("Manuelle Zuordnung gespeichert.");
    expect(result.current.pairingUi.pairingOutcome["mmproj-1"]).toMatchObject({
      label: "Zuordnung aktualisiert",
      tone: "info"
    });
    expect(result.current.pairingUi.pairingEvidence["mmproj-1"]).toEqual([
      { tone: "info", text: "Basismodell: base-2" }
    ]);
  });

  it("records probe evidence and reloads the index when runtime verification succeeds", async () => {
    const loadModelIndex = vi.fn(async () => {});
    useModelIndexStore.setState((state) => ({
      ...state,
      loadModelIndex
    }));
    vi.mocked(backendClient.probeRuntimeModel).mockResolvedValue({
      allowed: true,
      message: "Probe ok",
      stderr_tail: "",
      stdout_tail: "",
      projector_artifact_id: "mmproj-1",
      mmproj_path: "/models/mmproj-1.gguf",
      endpoint_verified: true,
      models_endpoint_verified: true,
      advertised_models: ["base-2.gguf"],
      vision_chat_verified: true,
      vision_response_preview: "Bild erkannt",
      verification_failures: []
    });

    const { result } = renderHook(() => useRuntimeModelsTabController());

    await act(async () => {
      await result.current.pairingUi.probePairing("mmproj-1", "base-2");
    });

    expect(backendClient.probeRuntimeModel).toHaveBeenCalledWith({
      allow_start: true,
      model_id: "base-2",
      projector_artifact_id: "mmproj-1"
    });
    expect(loadModelIndex).toHaveBeenCalledOnce();
    expect(result.current.pairingUi.pairingProbing["mmproj-1"]).toBe(false);
    expect(result.current.pairingUi.pairingFeedback["mmproj-1"]).toBe(
      "Probe ok (Endpoint ok | /v1/models ok | Modelle: base-2.gguf | Bildtest ok)"
    );
    expect(result.current.pairingUi.pairingOutcome["mmproj-1"]).toMatchObject({
      label: "Probe verifiziert",
      tone: "ok"
    });
    expect(result.current.pairingUi.pairingEvidence["mmproj-1"]).toEqual(
      expect.arrayContaining([
        { tone: "ok", text: "Basis-Endpoint: ok" },
        { tone: "ok", text: "/v1/models: ok" },
        { tone: "info", text: "Gemeldete Modelle: base-2.gguf" },
        { tone: "ok", text: "Bildtest: ok" },
        { tone: "info", text: "Vision-Antwort: Bild erkannt" },
        { tone: "info", text: "MMProj: /models/mmproj-1.gguf" }
      ])
    );
  });
});
