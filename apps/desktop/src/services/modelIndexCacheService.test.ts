import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ModelIndex } from "@dbzs/shared";
import { modelIndexCacheService } from "./modelIndexCacheService";

// Mock der Electron Preload API
const mockFs = {
  readFile: vi.fn(),
  writeFile: vi.fn()
};

const mockDbzsApi = {
  getAppPath: vi.fn(),
  fs: mockFs
};

describe("modelIndexCacheService", () => {
  beforeEach(() => {
    // @ts-expect-error - Mocking window object
    global.window = { dbzs: mockDbzsApi };
    mockDbzsApi.getAppPath.mockResolvedValue("/user/data");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const validIndex: ModelIndex = {
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
    models: [{
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
    }]
  };

  it("sollte null zurückgeben, wenn die Cache-Datei nicht existiert", async () => {
    mockFs.readFile.mockRejectedValue(new Error("File not found"));
    const result = await modelIndexCacheService.loadFromCache();
    expect(result).toBeNull();
    expect(mockFs.readFile).toHaveBeenCalledWith("/user/data/model-index-cache.json", "utf-8");
  });

  it("sollte null zurückgeben, wenn der Cache veraltet ist", async () => {
    const expiredCache = {
      version: 1,
      timestamp: Date.now() - (25 * 60 * 60 * 1000), // 25 Stunden alt
      index: validIndex
    };
    mockFs.readFile.mockResolvedValue(JSON.stringify(expiredCache));

    const result = await modelIndexCacheService.loadFromCache();
    expect(result).toBeNull();
  });

  it("sollte null zurückgeben, wenn die Cache-Version inkompatibel ist", async () => {
    const wrongVersionCache = {
      version: 0,
      timestamp: Date.now(),
      index: validIndex
    };
    mockFs.readFile.mockResolvedValue(JSON.stringify(wrongVersionCache));

    const result = await modelIndexCacheService.loadFromCache();
    expect(result).toBeNull();
  });

  it("sollte null zurückgeben, wenn der Cache-Inhalt ungültiges JSON ist", async () => {
    mockFs.readFile.mockResolvedValue("invalid json");
    const result = await modelIndexCacheService.loadFromCache();
    expect(result).toBeNull();
  });

  it("sollte den Index aus einem gültigen Cache laden", async () => {
    const validCache = {
      version: 1,
      timestamp: Date.now(),
      index: validIndex
    };
    mockFs.readFile.mockResolvedValue(JSON.stringify(validCache));

    const result = await modelIndexCacheService.loadFromCache();
    expect(result).toEqual(validIndex);
  });

  it("sollte den Index korrekt in den Cache speichern", async () => {
    await modelIndexCacheService.saveToCache(validIndex);

    expect(mockFs.writeFile).toHaveBeenCalledOnce();
    const [filePath, content] = mockFs.writeFile.mock.calls[0];
    expect(filePath).toBe("/user/data/model-index-cache.json");

    const writtenData = JSON.parse(content);
    expect(writtenData.version).toBe(1);
    expect(writtenData.index).toEqual(validIndex);
    expect(Date.now() - writtenData.timestamp).toBeLessThan(1000); // sollte sehr aktuell sein
  });

  it("sollte bei fehlender Preload-API keine Fehler werfen", async () => {
    // @ts-expect-error - Mocking window object
    global.window = {}; // API nicht vorhanden

    const loadResult = await modelIndexCacheService.loadFromCache();
    expect(loadResult).toBeNull();

    await modelIndexCacheService.saveToCache(validIndex);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});
