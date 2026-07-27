import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelRouterService } from "./modelRouterService";
import { modelRegistryService } from "./modelRegistryService";
import { useRuntimeStore } from "@/stores/runtimeStore";
import type { AppSettings, RegisteredModel } from "@dbzs/shared";

describe("ModelRouterService", () => {
  const mockSettings: AppSettings = {
    theme: "dark",
    autoSave: true,
    editorFontSize: 14,
    terminalShell: "powershell",
    safeCommandConfirmation: true,
    telemetryEnabled: false,
    modelsPath: "D:\\Models",
    backendUrl: "http://127.0.0.1:8876",
    agentExecutionEnabled: true,
    safeMode: false,
    maxAgentRuntimeSeconds: 300,
    maxFileScanCount: 100,
    cloudModelsEnabled: false,
    preferLocalModels: true,
    localOnlyModels: true,
    ollamaBaseUrl: "",
    anthropicApiKey: "",
    openaiApiKey: "",
    defaultPlannerModelId: "",
    defaultCoderModelId: "llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m",
    defaultReviewerModelId: "",
    defaultDebugModelId: "",
    defaultChatModelId: "llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m",
    defaultModelId: "llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m",
    autoStartChatRuntime: false,
    autoStartCodingRuntime: false,
    chatRuntimeSlot: "quality_cpu",
    codingRuntimeSlot: "fast_gpu",
    chatRuntimePort: 8081,
    codingRuntimePort: 8082,
    stopDesktopRuntimesOnExit: true,
    maxAutonomousSteps: 10,
    maxDebugRetries: 3,
    maxFailedTaskRetries: 2,
    localOnly: true
  };

  const mockRunningModel: RegisteredModel = {
    id: "llama-cpp:qwen2.5-coder-1.5b-instruct-q8-0",
    providerId: "llama-cpp",
    name: "Qwen 1.5B Coder",
    capabilities: ["chat", "code"],
    isLocal: true,
    enabled: true
  };

  const mockPreferredModel: RegisteredModel = {
    id: "llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m",
    providerId: "llama-cpp",
    name: "Qwen 7B Coder",
    capabilities: ["chat", "code"],
    isLocal: true,
    enabled: true
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useRuntimeStore.setState({
      status: null,
      isLoading: false,
      error: null
    });
  });

  it("routes to the preferred model if no local model is active and running", () => {
    vi.spyOn(modelRegistryService, "getModelById").mockImplementation((id) => {
      if (id === "llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m") return mockPreferredModel;
      return null;
    });

    const selected = modelRouterService.selectModelForAgent("coder", mockSettings);
    expect(selected?.id).toBe("llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m");
  });

  it("keeps the preferred role model even when another local model is already running", () => {
    vi.spyOn(modelRegistryService, "getModelById").mockImplementation((id) => {
      if (id === "llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m") return mockPreferredModel;
      if (id === "llama-cpp:qwen2.5-coder-1.5b-instruct-q8-0") return mockRunningModel;
      return null;
    });

    useRuntimeStore.setState({
      status: {
        state: "running",
        provider: "llama.cpp",
        model_id: "qwen2.5-coder-1.5b-instruct-q8-0",
        model_name: "Qwen 1.5B Coder",
        port: 8081,
        pid: 123,
        endpoint: "http://127.0.0.1:8081",
        message: ""
      }
    });

    const selected = modelRouterService.selectModelForAgent("coder", mockSettings);
    expect(selected?.id).toBe("llama-cpp:qwen2.5-coder-7b-instruct-q4-k-m");
  });

  it("uses defaultChatModelId for runtime_chat instead of defaultModelId", () => {
    const settings = {
      ...mockSettings,
      defaultModelId: "llama-cpp:default-model",
      defaultChatModelId: "llama-cpp:chat-model"
    };
    vi.spyOn(modelRegistryService, "getModelById").mockImplementation((id) => {
      if (id === "llama-cpp:chat-model") {
        return {
          id: "llama-cpp:chat-model",
          providerId: "llama-cpp",
          name: "Chat Model",
          capabilities: ["chat"],
          isLocal: true,
          enabled: true
        };
      }
      return null;
    });

    const selected = modelRouterService.selectModelForAgent("runtime_chat", settings);
    expect(selected?.id).toBe("llama-cpp:chat-model");
  });
});
