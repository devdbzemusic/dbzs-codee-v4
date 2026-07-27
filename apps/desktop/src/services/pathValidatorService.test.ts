import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IndexedModel } from "@dbzs/shared";
import { pathValidatorService } from "./pathValidatorService";
import { useSettingsStore } from "@/stores/settingsStore";

// Mock der Abhängigkeiten
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
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
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      settings: {
        llamaCppPath: "/runtimes/llama.cpp.exe"
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const llamaCppModel: IndexedModel = {
    id: "test-model",
    name: "Test Model",
    provider: "llama.cpp",
    filePath: "/models/test.gguf",
    capabilities: ["chat"]
  };

  it("sollte 'ok' zurückgeben, wenn alle Pfade existieren", async () => {
    mockFs.stat.mockResolvedValue({}); // Simuliert, dass die Datei existiert
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockFs.stat).toHaveBeenCalledWith("/models/test.gguf");
    expect(mockFs.stat).toHaveBeenCalledWith("/runtimes/llama.cpp.exe");
  });

  it("sollte einen Fehler melden, wenn die Modelldatei nicht gefunden wird", async () => {
    mockFs.stat
      .mockRejectedValueOnce(new Error("File not found")) // Modelldatei fehlt
      .mockResolvedValueOnce({}); // Runtime existiert
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Modelldatei nicht gefunden: /models/test.gguf"]);
  });

  it("sollte einen Fehler melden, wenn die Llama.cpp Executable nicht gefunden wird", async () => {
    mockFs.stat
      .mockResolvedValueOnce({}) // Modelldatei existiert
      .mockRejectedValueOnce(new Error("File not found")); // Runtime fehlt
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Llama.cpp Executable nicht gefunden: /runtimes/llama.cpp.exe"]);
  });

  it("sollte beide Fehler melden, wenn beide Pfade nicht existieren", async () => {
    mockFs.stat.mockRejectedValue(new Error("File not found"));
    const result = await pathValidatorService.validateModelPaths(llamaCppModel);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain("Modelldatei nicht gefunden: /models/test.gguf");
    expect(result.errors).toContain("Llama.cpp Executable nicht gefunden: /runtimes/llama.cpp.exe");
  });

  it("sollte für Ollama-Modelle nur die Modelldatei prüfen (falls vorhanden)", async () => {
    const ollamaModel: IndexedModel = {
      ...llamaCppModel,
      provider: "ollama",
      filePath: "/models/ollama-model.bin" // Ollama-Modelle haben oft keine Dateipfade im Index
    };
    mockFs.stat.mockResolvedValue({});
    const result = await pathValidatorService.validateModelPaths(ollamaModel);
    expect(result.ok).toBe(true);
    expect(mockFs.stat).toHaveBeenCalledOnce();
    expect(mockFs.stat).toHaveBeenCalledWith("/models/ollama-model.bin");
  });
});
