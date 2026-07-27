import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModelIndexStore } from "./modelIndexStore";

beforeEach(() => {
  useModelIndexStore.setState({
    index: null,
    isLoading: false,
    error: null
  });

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    getModelIndex: vi.fn().mockResolvedValue({
      generated_from: "catalog:D:\\Models\\models.catalog.json",
      summary: {
        models_dir: "D:\\Models",
        runtime_dir: "D:\\Models\\llama.cpp-win-runtime",
        ollama_dir: "G:\\Ollama",
        ollama_models_dir: "G:\\Ollama\\models",
        total: 2,
        gguf_total: 2,
        ollama_total: 0,
        llama_server_ready: 1,
        ollama_ready: 0,
        coding_candidates: 1,
        vision_candidates: 0,
        adapters: 0,
        unsupported: 0
      },
      models: [
        {
          id: "qwen",
          name: "Qwen2.5-Coder-7B",
          path: "D:\\Models\\qwen.gguf",
          format: "gguf",
          artifact_type: "model",
          size_bytes: 1000,
          size_gb: 0.001,
          quantization: "Q4_K_M",
          backend: "llama.cpp",
          runtime_launcher: "llama-server",
          capabilities: ["chat", "code"],
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
        }
      ]
    }),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgentLogs: vi.fn().mockResolvedValue([]),
    listProjectMemory: vi.fn().mockResolvedValue([]),
    upsertProjectMemory: vi.fn(),
    deleteProjectMemory: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn()
  };
});

describe("useModelIndexStore", () => {
  it("loads the model index through the preload bridge", async () => {
    await useModelIndexStore.getState().loadModelIndex();

    expect(window.dbzs.getModelIndex).toHaveBeenCalledOnce();
    expect(useModelIndexStore.getState().index?.summary.total).toBe(2);
    expect(useModelIndexStore.getState().primaryCodingModel?.name).toBe("Qwen2.5-Coder-7B");
  });
});
