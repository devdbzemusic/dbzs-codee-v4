import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeImplementationContinuationRouting,
  normalizeWorkspaceContextPathCandidates,
  useRuntimeChatStore
} from "./runtimeChatStore";
import { useRuntimeStore } from "./runtimeStore";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";
import { backendClient } from "@/services/backendClient";
import { DEFAULT_SETTINGS } from "@dbzs/shared";

function resolveDeltaCallbacks(args: unknown[]): { onDelta: (delta: string, total: number) => void } {
  const candidate = args.find(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "onDelta" in (value as Record<string, unknown>) &&
      typeof (value as { onDelta?: unknown }).onDelta === "function"
  ) as { onDelta: (delta: string, total: number) => void } | undefined;

  if (!candidate) {
    throw new Error("callbacks.onDelta is not a function");
  }

  return candidate;
}

const sendChatStreamMock = vi.fn().mockImplementation(
  async (...args: unknown[]) => {
    const callbacks = resolveDeltaCallbacks(args);
    callbacks.onDelta("Antwort", 7);
    return {
      message: { role: "assistant", content: "Antwort" },
      model_id: "coder",
      model_name: "Coder"
    };
  }
);

const resolveRoutingMock = vi.fn().mockResolvedValue({
  targetAgent: "runtime_chat",
  modelId: "llama-cpp:test",
  modelName: "Test Model",
  providerId: "llama-cpp"
});

const sendChatMock = vi.fn().mockResolvedValue({
  message: { role: "assistant", content: "Antwort" },
  model_id: "coder",
  model_name: "Coder"
});
const verifySlotForRequestMock = vi.fn().mockResolvedValue({ ok: true, slotId: "fast_gpu" });
const getSlotStatusMock = vi.fn();
const getAllSlotsStatusMock = vi.fn().mockResolvedValue([]);
const startSlotMock = vi.fn();
const stopSlotMock = vi.fn().mockResolvedValue({ success: true });
const waitForSlotReadyMock = vi.fn();
const warmupInferenceMock = vi.fn();
const previewResourcePlanMock = vi.fn();
const resolveDefaultModelForSlotMock = vi.fn();
const isSlotReadyMock = vi.fn((status: any) => status?.state === "running" && status?.chat_ready === true);

const runningStatus = {
  state: "running" as const,
  provider: "llama.cpp" as const,
  model_id: "coder",
  model_name: "Coder",
  port: 8081,
  pid: 42,
  endpoint: "http://127.0.0.1:8081",
  message: ""
};

const stoppedStatus = {
  state: "stopped" as const,
  provider: null,
  model_id: null,
  model_name: null,
  port: null,
  pid: null,
  endpoint: null,
  message: ""
};

function makeSlotStatus(
  slotId: string,
  overrides: Partial<{
    state: "running" | "stopped";
    provider: "llama.cpp" | null;
    model_id: string | null;
    model_name: string | null;
    port: number | null;
    pid: number | null;
    endpoint: string | null;
    chat_ready: boolean;
  }> = {}
) {
  const running = overrides.state !== "stopped";
  return {
    slot_id: slotId,
    state: running ? "running" : "stopped",
    provider: running ? "llama.cpp" : null,
    model_id: running
      ? slotId === "quality_cpu"
        ? "chat-model"
        : slotId === "orchestrator_cpu"
          ? "functiongemma-270m-it-Q8-0"
          : "coder"
      : null,
    model_name: running
      ? slotId === "quality_cpu"
        ? "Chat Model"
        : slotId === "orchestrator_cpu"
          ? "FunctionGemma"
          : "Coder"
      : null,
    port: running
      ? slotId === "quality_cpu"
        ? 8081
        : slotId === "orchestrator_cpu"
          ? 8084
          : 8082
      : null,
    pid: running ? 42 : null,
    endpoint: running
      ? slotId === "quality_cpu"
        ? "http://127.0.0.1:8081"
        : slotId === "orchestrator_cpu"
          ? "http://127.0.0.1:8084"
          : "http://127.0.0.1:8082"
      : null,
    message: "",
    chat_ready: running,
    ...overrides
  };
}

vi.mock("@/services/agentRunService", () => ({
  agentRunService: {
    sendChatStream: (...args: unknown[]) => sendChatStreamMock(...args),
    sendChat: (...args: unknown[]) => sendChatMock(...args),
    resolveRouting: (...args: unknown[]) => resolveRoutingMock(...args)
  }
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({
      queueProposedChanges: vi.fn()
    })
  }
}));

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    getRuntimeStatus: vi.fn()
  }
}));

vi.mock("@/services/runtimeSlotValidator", () => ({
  verifySlotForRequest: (...args: unknown[]) => verifySlotForRequestMock(...args),
  listAvailableSlots: vi.fn().mockResolvedValue([])
}));

vi.mock("@/services/runtimeSlotManager", () => ({
  runtimeSlotManager: {
    getSlotStatus: (...args: unknown[]) => getSlotStatusMock(...args),
    getAllSlotsStatus: (...args: unknown[]) => getAllSlotsStatusMock(...args),
    startSlot: (...args: unknown[]) => startSlotMock(...args),
    stopSlot: (...args: unknown[]) => stopSlotMock(...args),
    waitForSlotReady: (...args: unknown[]) => waitForSlotReadyMock(...args),
    warmupInference: (...args: unknown[]) => warmupInferenceMock(...args),
    previewResourcePlan: (...args: unknown[]) => previewResourcePlanMock(...args),
    resolveDefaultModelForSlot: (...args: unknown[]) => resolveDefaultModelForSlotMock(...args),
    isSlotReady: (status: unknown) => isSlotReadyMock(status)
  }
}));

vi.mock("@/services/orchestrationClient", () => ({
  orchestrationClient: {
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    prepareContext: vi.fn().mockResolvedValue({
      intent_summary: "test",
      decomposition_steps: [],
      context_hints: [],
      suggested_agents: [],
      work_items: [],
      tool_capabilities: []
    }),
    executeTool: vi.fn()
  },
  shouldRunWorkspaceListTool: () => false,
  formatToolResultForContext: () => ""
}));

beforeEach(() => {
  sendChatStreamMock.mockReset();
  sendChatMock.mockReset();
  verifySlotForRequestMock.mockReset();
  verifySlotForRequestMock.mockResolvedValue({ ok: true, slotId: "fast_gpu" });
  getSlotStatusMock.mockReset();
  getSlotStatusMock.mockImplementation(async (slotId: string) => makeSlotStatus(slotId));
  getAllSlotsStatusMock.mockReset();
  getAllSlotsStatusMock.mockResolvedValue([]);
  startSlotMock.mockReset();
  startSlotMock.mockResolvedValue({ success: true, slotId: "fast_gpu" });
  stopSlotMock.mockReset();
  stopSlotMock.mockResolvedValue({ success: true });
  waitForSlotReadyMock.mockReset();
  waitForSlotReadyMock.mockImplementation(async (slotId: string) => makeSlotStatus(slotId));
  warmupInferenceMock.mockReset();
  warmupInferenceMock.mockResolvedValue({ ok: true, status: "ready", detail: "OK" });
  previewResourcePlanMock.mockReset();
  previewResourcePlanMock.mockResolvedValue({
    context_size: 8192,
    estimated_model_bytes: 0,
    estimated_total_vram_bytes: 0,
    warnings: []
  });
  resolveDefaultModelForSlotMock.mockReset();
  resolveDefaultModelForSlotMock.mockResolvedValue("coder");
  isSlotReadyMock.mockClear();
  sendChatMock.mockResolvedValue({
    message: { role: "assistant", content: "Antwort" },
    model_id: "coder",
    model_name: "Coder"
  });
  sendChatStreamMock.mockImplementation(
    async (...args: unknown[]) => {
      const callbacks = resolveDeltaCallbacks(args);
      callbacks.onDelta("Antwort", 7);
      return {
        message: { role: "assistant", content: "Antwort" },
        model_id: "coder",
        model_name: "Coder"
      };
    }
  );
  resolveRoutingMock.mockReset();
  resolveRoutingMock.mockResolvedValue({
    targetAgent: "runtime_chat",
    modelId: "llama-cpp:test",
    modelName: "Test Model",
    providerId: "llama-cpp"
  });
  vi.mocked(backendClient.getRuntimeStatus).mockReset();
  useRuntimeStore.setState({ status: null, isLoading: false, error: null });
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      defaultModelId: "chat-model",
      defaultChatModelId: "chat-model",
      defaultPlannerModelId: "planner-model",
      defaultCoderModelId: "coder",
      defaultReviewerModelId: "reviewer-model",
      defaultDebugModelId: "coder",
      defaultModelName: "Chat Model",
      runtimeChatUseBroker: true
    },
    isLoading: false,
    error: null
  });
  useRuntimeChatStore.setState({
    messages: [],
    isSending: false,
    isStreaming: false,
    error: null,
    currentActivity: null,
    lastActivity: null,
    enabledSkillIds: [],
    toolsEnabled: false
  });

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    getModelIndex: vi.fn(),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "Antwort" },
      model_id: "coder",
      model_name: "Coder"
    }),
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

describe("useRuntimeChatStore", () => {
  afterEach(() => {
    useWorkspaceStore.setState({ files: [] });
  });

  it("answers a workspace file-count query directly, without starting a model", async () => {
    useWorkspaceStore.setState({
      files: [
        { path: "C:/repo/models/a.gguf", relativePath: "models/a.gguf", name: "a.gguf", language: "binary" },
        { path: "C:/repo/models/b.gguf", relativePath: "models/b.gguf", name: "b.gguf", language: "binary" },
        { path: "C:/repo/src/index.ts", relativePath: "src/index.ts", name: "index.ts", language: "typescript" }
      ]
    });

    const sent = await useRuntimeChatStore.getState().sendMessage(
      "Zähle alle gguf Dateien im Workspace",
      stoppedStatus,
      null
    );

    expect(sent).toBe(true);
    expect(getSlotStatusMock).not.toHaveBeenCalled();
    expect(startSlotMock).not.toHaveBeenCalled();
    expect(warmupInferenceMock).not.toHaveBeenCalled();
    expect(sendChatStreamMock).not.toHaveBeenCalled();
    expect(sendChatMock).not.toHaveBeenCalled();
    expect(useRuntimeChatStore.getState().activeRun).toBeNull();
    const lastMessage = useRuntimeChatStore.getState().messages.at(-1);
    expect(lastMessage?.role).toBe("assistant");
    expect(lastMessage?.content).toContain("2 Dateien");
  });

  it("asks for missing StringLab feature details before runtime, context, or RAG work", async () => {
    const workspaceRoot = "C:/Users/ralle/source/repos/dbzssl";

    const sent = await useRuntimeChatStore.getState().sendMessage(
      "Wir bauen heute eine kleine neue Funktion für StringLab",
      stoppedStatus,
      null,
      undefined,
      null,
      "runtime_chat",
      { workspaceRoot, workspaceName: "dbzssl", includeWorkspaceContext: true }
    );

    expect(sent).toBe(false);
    expect(backendClient.getRuntimeStatus).not.toHaveBeenCalled();
    expect(getSlotStatusMock).not.toHaveBeenCalled();
    expect(sendChatStreamMock).not.toHaveBeenCalled();
    expect(useRuntimeChatStore.getState().messages).toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({
        role: "system",
        content: "Welche konkrete Funktion soll StringLab bekommen?",
        actions: [
          expect.objectContaining({
            kind: "answer_question",
            workspaceRoot,
            workspaceId: "c:/users/ralle/source/repos/dbzssl",
            state: "pending"
          })
        ]
      })
    ]);
    expect(useRuntimeChatStore.getState().activeRun).toBeNull();
    expect(useRuntimeChatStore.getState().isSending).toBe(false);
  });

  it("rejects an answer from a different workspace", async () => {
    useRuntimeChatStore.setState({
      messages: [
        {
          id: "message-question",
          role: "system",
          content: "Welche Funktion?",
          actions: [
            {
              id: "action-question",
              runId: "run-question",
              messageId: "message-question",
              workspaceRoot: "C:/Repos/StringLab",
              workspaceId: "c:/repos/stringlab",
              kind: "answer_question",
              title: "Welche Funktion?",
              payload: {
                question: {
                  id: "question-1",
                  questionType: "free_text",
                  prompt: "Welche Funktion?",
                  toolCallId: "ask-user-1"
                }
              },
              state: "pending",
              createdAt: "2026-07-22T00:00:00.000Z"
            }
          ]
        }
      ]
    });

    await expect(
      useRuntimeChatStore.getState().submitAssistantAnswer(
        "action-question",
        "message-question",
        {
          questionId: "question-1",
          answeredAt: "2026-07-22T00:01:00.000Z",
          freeText: "CSV exportieren"
        },
        "c:/repos/analyzer"
      )
    ).rejects.toThrow("aktiven Workspace");

    expect(useRuntimeChatStore.getState().messages[0].actions?.[0].state).toBe("pending");
  });

  it("returns rejected workspace context paths instead of silently dropping them", async () => {
    const result = await normalizeWorkspaceContextPathCandidates(
      "D:/repo",
      ["src\\main.ts", "D:/outside/secret.ts", "../escape.ts"],
      async (_workspaceRoot, [candidate]) => {
        if (candidate === "src\\main.ts") return ["src/main.ts"];
        throw new Error("Path is outside of current workspace.");
      }
    );

    expect(result.normalized).toEqual(["src/main.ts"]);
    expect(result.rejected).toEqual(["<absolute path rejected>", "../escape.ts"]);
  });

  it("sends chat messages with active file context", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(runningStatus);

    await useRuntimeChatStore.getState().sendMessage(
      "Pruefe das HTML.",
      runningStatus,
      {
        path: "D:\\Dev\\repo\\dbzs-codee\\apps\\desktop\\index.html",
        name: "index.html",
        content: "<main>DBZS</main>",
        language: "html"
      }
    );

    expect(sendChatStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file_context: expect.objectContaining({ language: "html" }),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Pruefe das HTML." })
        ])
      }),
      expect.any(Object),
      expect.any(AbortSignal)
    );
    expect(useRuntimeChatStore.getState().lastActivity).toEqual(
      expect.objectContaining({
        userPrompt: "Pruefe das HTML."
      })
    );
  });

  it("does not send when backend slots API is unreachable", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(stoppedStatus);
    getAllSlotsStatusMock.mockRejectedValue(new Error("network down"));

    await useRuntimeChatStore.getState().sendMessage("Hallo", stoppedStatus, null);

    expect(sendChatStreamMock).not.toHaveBeenCalled();
    expect(startSlotMock).not.toHaveBeenCalled();
    expect(useRuntimeChatStore.getState().error).toContain("Backend nicht erreichbar");
  });

  it("refreshes stale running UI status but still allows on-demand send when backend is reachable", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(stoppedStatus);

    await useRuntimeChatStore.getState().sendMessage("Hallo", runningStatus, null);

    expect(useRuntimeStore.getState().status?.state).toBe("stopped");
    expect(getAllSlotsStatusMock).toHaveBeenCalled();
    expect(sendChatStreamMock).toHaveBeenCalled();
  });

  it("answers deterministic workspace queries without routing or runtime start", async () => {
    useWorkspaceStore.setState({
      files: [
        { path: "C:/workspace/demo/models/a.gguf", relativePath: "models/a.gguf", content: "", type: "file" },
        { path: "C:/workspace/demo/models/b.gguf", relativePath: "models/b.gguf", content: "", type: "file" },
        { path: "C:/workspace/demo/README.md", relativePath: "README.md", content: "", type: "file" }
      ] as any
    });

    const sent = await useRuntimeChatStore
      .getState()
      .sendMessage("Zähle alle gguf modelle im Workspace", runningStatus, null);

    expect(sent).toBe(true);
    expect(resolveRoutingMock).not.toHaveBeenCalled();
    expect(startSlotMock).not.toHaveBeenCalled();
    expect(warmupInferenceMock).not.toHaveBeenCalled();
    expect(sendChatStreamMock).not.toHaveBeenCalled();
    expect(useRuntimeChatStore.getState().messages.at(-1)?.content).toContain("2 Dateien passend zu `*.gguf`");
  });

  it("keeps trivial auto chat on the casual runtime-chat path", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(runningStatus);

    await useRuntimeChatStore.getState().sendMessage(
      "Hallo",
      runningStatus,
      null,
      undefined,
      undefined,
      "runtime_chat",
      {
        agentMode: "auto",
        workspaceRoot: "C:/workspace/demo"
      } as any
    );

    const sentRequest = sendChatStreamMock.mock.calls[0]?.[0] as { model_id?: string } | undefined;
    const runs = Object.values(useRuntimeChatStore.getState().historicalRuns);
    const lastRun = runs[runs.length - 1];

    expect(sendChatStreamMock).toHaveBeenCalled();
    expect(sentRequest?.model_id).not.toBe("planner-model");
    expect(lastRun?.targetAgentLabel).not.toBe("planner");
    expect(lastRun?.workflowLabel).toBe("Hallo");
  });

  it("maps backend 409 runtime errors to a restart hint", async () => {
    vi.mocked(backendClient.getRuntimeStatus)
      .mockResolvedValue(runningStatus);
    const runtimeError = new Error('Backend request failed: 409 Conflict | {"detail":"Runtime is not running."}');
    sendChatStreamMock.mockRejectedValueOnce(runtimeError);
    sendChatStreamMock.mockRejectedValueOnce(runtimeError);

    await useRuntimeChatStore.getState().sendMessage("Hallo", runningStatus, null);

    expect(useRuntimeChatStore.getState().error).toContain("erneut starten");
  });

  it("does not trigger non-stream fallback after a structured provider error response", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(runningStatus);
    sendChatStreamMock.mockResolvedValueOnce({
      message: { role: "assistant", content: "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen." },
      model_id: null,
      model_name: null,
      safe_fallback: true,
      provider_error: {
        kind: "provider_error",
        code: "provider_internal_error",
        stage: "stream_read",
        userMessage: "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen.",
        retryable: false,
        correlationId: "safe-test"
      }
    });

    await useRuntimeChatStore.getState().sendMessage("Hallo", runningStatus, null);

    expect(sendChatStreamMock).toHaveBeenCalledTimes(1);
    expect(sendChatMock).not.toHaveBeenCalled();
  });

  it("treats aborted stream errors as cancellation instead of runtime failure", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(runningStatus);
    sendChatStreamMock.mockRejectedValueOnce(new Error("Error: aborted"));

    const result = await useRuntimeChatStore.getState().sendMessage("Hallo", runningStatus, null);

    expect(result).toBe(false);
    expect(useRuntimeChatStore.getState().error).toBeNull();
    expect(useRuntimeChatStore.getState().activeRun).toBeNull();
  });

  it("starts a stopped routed slot on demand after context budget passes", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(stoppedStatus);
    getSlotStatusMock.mockResolvedValue({
      slot_id: "fast_gpu",
      state: "stopped",
      provider: null,
      model_id: null,
      model_name: null,
      port: null,
      pid: null,
      endpoint: null,
      chat_ready: false
    });
    waitForSlotReadyMock.mockResolvedValueOnce({
      slot_id: "fast_gpu",
      state: "running",
      provider: "llama.cpp",
      model_id: "coder",
      model_name: "Coder",
      port: 8082,
      pid: 43,
      endpoint: "http://127.0.0.1:8082",
      chat_ready: true
    });

    await useRuntimeChatStore.getState().sendMessage("Fehler analysieren", stoppedStatus, null);

    expect(resolveDefaultModelForSlotMock).not.toHaveBeenCalled();
    expect(startSlotMock).toHaveBeenCalledWith("fast_gpu", "coder", "balanced", undefined);
    expect(waitForSlotReadyMock).toHaveBeenCalledWith("fast_gpu", expect.any(Number));
    expect(verifySlotForRequestMock).toHaveBeenCalledWith(
      expect.any(String),
      "fast_gpu",
      "coder",
      expect.any(Number),
      expect.any(AbortSignal)
    );
  });

  it("does not start a work model while ask_user clarification is pending", async () => {
    const workspaceRoot = "C:/Users/ralle/source/repos/dbzssl";
    await useRuntimeChatStore.getState().sendMessage(
      "Wir bauen heute eine kleine neue Funktion für StringLab",
      stoppedStatus,
      null,
      undefined,
      null,
      "runtime_chat",
      { workspaceRoot, workspaceName: "dbzssl", includeWorkspaceContext: true }
    );
    expect(startSlotMock).not.toHaveBeenCalled();
    expect(getAllSlotsStatusMock).not.toHaveBeenCalled();
  });

  it("allows chat send when backend is reachable but work model is stopped", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(stoppedStatus);
    sendChatStreamMock.mockImplementationOnce(
      async (...args: unknown[]) => {
        const callbacks = resolveDeltaCallbacks(args);
        callbacks.onDelta("Antwort", 7);
        return {
          message: { role: "assistant", content: "Antwort" },
          model_id: "chat-model",
          model_name: "Chat Model"
        };
      }
    );
    const stoppedChatSlot = {
      slot_id: "quality_cpu",
      state: "stopped",
      provider: null,
      model_id: null,
      model_name: null,
      port: null,
      pid: null,
      endpoint: null,
      chat_ready: false
    };
    const runningChatSlot = {
      slot_id: "quality_cpu",
      state: "running",
      provider: "llama.cpp",
      model_id: "chat-model",
      model_name: "Chat Model",
      port: 8081,
      pid: 42,
      endpoint: "http://127.0.0.1:8081",
      chat_ready: true
    };
    getSlotStatusMock.mockImplementation(async () =>
      startSlotMock.mock.calls.length > 0 ? runningChatSlot : stoppedChatSlot
    );
    waitForSlotReadyMock.mockResolvedValue(runningChatSlot);
    verifySlotForRequestMock.mockResolvedValue({
      ok: true,
      slotId: "quality_cpu",
      status: runningChatSlot
    });

    await useRuntimeChatStore.getState().sendMessage("Hallo", stoppedStatus, null);
    expect(getAllSlotsStatusMock).toHaveBeenCalled();
    expect(startSlotMock).toHaveBeenCalledWith("quality_cpu", "chat-model", "balanced", undefined);
    expect(sendChatStreamMock).toHaveBeenCalled();
  });

  it("shows assistant text when change payload parsing fails", async () => {
    vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(runningStatus);
    sendChatStreamMock.mockImplementationOnce(
      async (...args: unknown[]) => {
        const callbacks = resolveDeltaCallbacks(args);
        callbacks.onDelta("{invalid changes json", 20);
        return {
          message: { role: "assistant", content: "{invalid changes json" },
          model_id: "coder",
          model_name: "Coder"
        };
      }
    );

    const sent = await useRuntimeChatStore.getState().sendMessage(
      "Refactor apps/desktop/src/foo.ts nur in dieser Datei, damit die Tests wieder gruen werden",
      runningStatus,
      null,
      {
        rootPath: "D:/Dev/repo/dbzs-codee",
        name: "Workspace",
        fileTree: [],
        sampledFiles: []
      },
      null,
      "coder"
    );

    expect(sent).toBe(false);
    expect(useRuntimeChatStore.getState().error).toBeTruthy();
  });
});

describe("compactConversation", () => {
  function makeMessage(id: string, content: string, overrides: Partial<import("@dbzs/shared").RuntimeChatMessage> = {}) {
    return { id, role: "user" as const, content, ...overrides };
  }

  it("does nothing below the minimum compaction threshold", () => {
    useRuntimeChatStore.setState({ messages: [makeMessage("m1", "hi"), makeMessage("m2", "hello")] });

    useRuntimeChatStore.getState().compactConversation();

    expect(useRuntimeChatStore.getState().messages).toHaveLength(2);
  });

  it("keeps the last 4 messages and prepends a compaction summary", () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`, `plain chat turn ${i}`));
    useRuntimeChatStore.setState({ messages });

    useRuntimeChatStore.getState().compactConversation();

    const result = useRuntimeChatStore.getState().messages;
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("compacted");
    expect(result.slice(-4).map((m) => m.id)).toEqual(["m6", "m7", "m8", "m9"]);
  });

  it("acceptance: preserves error/correction turns literally instead of folding them into the summary", () => {
    const messages = [
      makeMessage("m0", "plain chat turn"),
      makeMessage("m1", "Es gab einen Fehler beim Ausführen des Tests"),
      makeMessage("m2", "plain chat turn"),
      makeMessage("m3", "plain chat turn"),
      makeMessage("m4", "plain chat turn"),
      makeMessage("m5", "plain chat turn"),
      makeMessage("m6", "plain chat turn"),
      makeMessage("m7", "plain chat turn"),
      makeMessage("m8", "plain chat turn"),
      makeMessage("m9", "plain chat turn")
    ];
    useRuntimeChatStore.setState({ messages });

    useRuntimeChatStore.getState().compactConversation();

    const result = useRuntimeChatStore.getState().messages;
    expect(result.some((m) => m.id === "m1")).toBe(true); // the error turn survives, not just referenced in the digest
  });

  it("preserves messages carrying approval actions regardless of content", () => {
    const messages = [
      makeMessage("m0", "plain chat turn"),
      makeMessage("m1", "Plan vorschlagen", {
        actions: [
          {
            id: "a1",
            runId: "r1",
            messageId: "m1",
            workspaceRoot: "C:/work/a",
            workspaceId: "c:/work/a",
            kind: "approve_plan",
            title: "Plan genehmigen",
            payload: {},
            state: "pending",
            createdAt: "2026-01-01T00:00:00Z"
          }
        ]
      }),
      makeMessage("m2", "plain"),
      makeMessage("m3", "plain"),
      makeMessage("m4", "plain"),
      makeMessage("m5", "plain"),
      makeMessage("m6", "plain"),
      makeMessage("m7", "plain")
    ];
    useRuntimeChatStore.setState({ messages });

    useRuntimeChatStore.getState().compactConversation();

    const result = useRuntimeChatStore.getState().messages;
    expect(result.some((m) => m.id === "m1")).toBe(true);
  });
});

describe("implementation continuation routing", () => {
  it("forces coder routing for implementation follow-ups even when planner-first is sticky", () => {
    const normalized = normalizeImplementationContinuationRouting({
      phase: "implementation",
      taskType: "planning",
      contractTaskType: "planning",
      targetAgent: "planner",
      preferPlannerFirst: true
    });

    expect(normalized).toEqual({
      taskType: "small_code_change",
      targetAgent: "coder",
      preferPlannerFirst: false,
      normalized: true
    });
  });

  it("keeps non-implementation routing untouched", () => {
    expect(
      normalizeImplementationContinuationRouting({
        phase: "planning",
        taskType: "planning",
        contractTaskType: "planning",
        targetAgent: "planner",
        preferPlannerFirst: true
      })
    ).toEqual({
      taskType: "planning",
      targetAgent: "planner",
      preferPlannerFirst: true,
      normalized: false
    });
  });
});
