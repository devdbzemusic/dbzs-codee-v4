import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IndexedModel } from "@dbzs/shared";
import { pathValidatorService } from "./pathValidatorService";
import { useModelIndexStore } from "@/stores/modelIndexStore";

// Mock der Abhängigkeiten
vi.mock("@/stores/modelIndexStore", () => ({
  useModelIndexStore: {
    getState: vi.fn()
  }
}));

const mockFs = {
  stat: vi.fn()
};

const mockDbzsApi = {
  fs: mockFs
};

describe("pathValidatorService", () => {
  beforeEach(() => {
    // @ts-expect-error - Mocking window object
    global.window = { dbzs: mockDbzsApi };
    vi.mocked(useModelIndexStore.getState).mockReturnValue({
      index: {
        generated_from: "catalog:/models/models.catalog.json",
        summary: {
          models_dir: "/models",
          runtime_dir: "/runtimes/llama.cpp",
          ollama_dir: null,
          ollama_models_dir: null,
          total: 1,
          gguf_total: 1,
          ollama_total: 0,
          llama_server_ready: 1,
          ollama_ready: 0,
          coding_candidates: 1,
          vision_candidates: 0,
          adapters: 0,
          unsupported: 0
        },
        models: []
      },
      isLoading: false,
      error: null,
      primaryCodingModel: null,
      loadModelIndex: vi.fn()
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const llamaCppModel: IndexedModel = {
    id: "test-model",
    name: "Test Model",
    path: "/models/test.gguf",
    format: "gguf",
    artifact_type: "model",
    size_bytes: 1000,
    size_gb: 0.001,
    quantization: "Q4_K_M",
    backend: "llama.cpp",
    runtime_launcher: "llama-server",
    capabilities: ["chat"],
    modality: ["text"],
    role: "CODE_MODEL",
    recommended_use: "primary_coding",
    compatibility: "llama_server_ready",
    runtime: {
      ctx: 8192,
      gpu_layers: 99,
      server_enabled: true,
      preferred_port: 8081,
      health_status: "ok",
      provider: "llama.cpp"
    }
  };

  it("sollte 'ok' zurückgeben, wenn alle Pfade existieren", async () => {
    mockFs.stat.mockResolvedValue({}); // Simuliert, dass die Datei existiert
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockFs.stat).toHaveBeenCalledWith("/models/test.gguf");
    expect(mockFs.stat).toHaveBeenCalledWith("/runtimes/llama.cpp");
  });

  it("sollte einen Fehler melden, wenn die Modelldatei nicht gefunden wird", async () => {
    mockFs.stat
      .mockRejectedValueOnce(new Error("File not found")) // Modelldatei fehlt
      .mockResolvedValueOnce({}); // Runtime existiert
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Modelldatei nicht gefunden: /models/test.gguf"]);
  });

  it("sollte einen Fehler melden, wenn das Llama.cpp Runtime-Verzeichnis nicht gefunden wird", async () => {
    mockFs.stat
      .mockResolvedValueOnce({}) // Modelldatei existiert
      .mockRejectedValueOnce(new Error("File not found")); // Runtime fehlt
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Llama.cpp Runtime-Verzeichnis nicht gefunden: /runtimes/llama.cpp"]);
  });

  it("sollte beide Fehler melden, wenn beide Pfade nicht existieren", async () => {
    mockFs.stat.mockRejectedValue(new Error("File not found"));
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain("Modelldatei nicht gefunden: /models/test.gguf");
    expect(result.errors).toContain("Llama.cpp Runtime-Verzeichnis nicht gefunden: /runtimes/llama.cpp");
  });

  it("sollte für Ollama-Modelle nur die Modelldatei prüfen (falls vorhanden)", async () => {
    const ollamaModel: IndexedModel = {
      ...llamaCppModel,
      backend: "ollama",
      path: "/models/ollama-model.bin",
      runtime: {
        ...llamaCppModel.runtime,
        provider: "ollama"
      }
    };
    mockFs.stat.mockResolvedValue({});
    const result = await pathValidatorService.validateModelPaths(ollamaModel);
    expect(result.ok).toBe(true);
    expect(mockFs.stat).toHaveBeenCalledOnce();
    expect(mockFs.stat).toHaveBeenCalledWith("/models/ollama-model.bin");
  });
});
