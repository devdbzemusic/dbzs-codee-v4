import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ModelLabModel, type ModelLabScanJob, type ModelLabSource } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useSettingsStore } from "@/stores/settingsStore";
import { useModelLabTabController } from "./ModelLabTab.controller";

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    listModelLabSources: vi.fn(),
    listModelLabModels: vi.fn(),
    listModelLabJobs: vi.fn(),
    createModelLabSource: vi.fn(),
    runModelLabScan: vi.fn()
  }
}));

function createSource(overrides: Partial<ModelLabSource> = {}): ModelLabSource {
  return {
    id: "source-1",
    name: "Lokal",
    path: "C:/Modelle",
    recursive: true,
    enabled: true,
    trusted: false,
    priority: 100,
    include_patterns: [],
    exclude_patterns: [],
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    last_scan_at: null,
    last_scan_status: null,
    last_error: null,
    ...overrides
  };
}

function createModel(overrides: Partial<ModelLabModel> = {}): ModelLabModel {
  return {
    bundle: {
      bundle_id: "bundle-1",
      name: "test-model",
      primary_artifact_id: "artifact-1",
      artifact_ids: ["artifact-1"],
      source_ids: ["source-1"],
      status: "IDENTIFIED",
      capabilities: ["chat"],
      modalities: ["text"],
      evidence: [],
      health: {
        status: "healthy",
        model_type: "llama",
        architecture: "llama",
        parameters: null,
        context_length: 4096,
        quantization: "Q4_K_M",
        folder_size_bytes: 1024,
        config_files: [],
        missing_critical: [],
        optional_missing: [],
        issues: [],
        config_preview: {}
      },
      tags: [],
      is_favorite: false,
      notes: "",
      collection_ids: [],
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T00:00:00Z"
    },
    artifacts: [],
    ...overrides
  };
}

describe("useModelLabTabController", () => {
  beforeEach(() => {
    vi.mocked(backendClient.listModelLabSources).mockReset().mockResolvedValue([createSource()]);
    vi.mocked(backendClient.listModelLabModels).mockReset().mockResolvedValue([createModel()]);
    vi.mocked(backendClient.listModelLabJobs)
      .mockReset()
      .mockResolvedValue([] as ModelLabScanJob[]);
    vi.mocked(backendClient.createModelLabSource).mockReset();
    vi.mocked(backendClient.runModelLabScan).mockReset();

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

  it("loads sources, models and jobs on mount", async () => {
    const { result } = renderHook(() => useModelLabTabController());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.backendOnline).toBe(true);
    expect(result.current.sources).toHaveLength(1);
    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0].bundle.bundle_id).toBe("bundle-1");
  });

  it("adds a source and reloads the list", async () => {
    vi.mocked(backendClient.createModelLabSource).mockResolvedValue(createSource({ id: "source-2" }));

    const { result } = renderHook(() => useModelLabTabController());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addSource({ path: "C:/NeueModelle" });
    });

    expect(backendClient.createModelLabSource).toHaveBeenCalledWith({ path: "C:/NeueModelle" });
    expect(backendClient.listModelLabSources).toHaveBeenCalledTimes(2);
    expect(result.current.addingSource).toBe(false);
  });

  it("runs a scan and surfaces errors", async () => {
    vi.mocked(backendClient.runModelLabScan).mockRejectedValue(new Error("Scan-Fehler"));

    const { result } = renderHook(() => useModelLabTabController());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.runScan("source-1");
    });

    expect(backendClient.runModelLabScan).toHaveBeenCalledWith({ source_id: "source-1" });
    expect(result.current.error).toBe("Scan-Fehler");
    expect(result.current.isScanning).toBe(false);
  });

  it("selects a model by bundle id", async () => {
    const { result } = renderHook(() => useModelLabTabController());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSelectedBundleId("bundle-1");
    });

    expect(result.current.selectedModel?.bundle.bundle_id).toBe("bundle-1");
  });
});
