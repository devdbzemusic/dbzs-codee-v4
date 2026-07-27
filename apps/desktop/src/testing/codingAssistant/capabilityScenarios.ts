import { vi } from "vitest";
import { DEFAULT_SETTINGS, type RuntimeChatResponse, type RuntimeStatus } from "@dbzs/shared";
import type { CapabilityScenario } from "./capabilityTypes";
import { loadFixtureWorkspaceFiles, toWorkspaceFile } from "./fixtureWorkspace";
import {
  buildCatalogVitestScenarios,
  buildInfrastructureScenarios,
  type CatalogScenarioDeps
} from "./catalogCapabilityScenarios";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useRuntimeChatApprovalStore } from "@/stores/runtimeChatApprovalStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { backendClient } from "@/services/backendClient";
import { clearActiveTaskContract } from "@/services/activeTaskContract";
import { clearPendingWorkflowScopeDecision } from "@/services/pendingWorkflowScopeDecision";
import { resetRuntimeRunFinalizationForTests } from "@/services/runtimeRunFinalization";
import type { ModelTargetAgent as SharedModelTargetAgent } from "@dbzs/shared";
import type { ModelTargetAgent as BrokerModelTargetAgent } from "@/services/modelSelectionBroker";

let capabilityBrokerAgentOverride: SharedModelTargetAgent | null = null;

export function setCapabilityBrokerAgentOverride(agent: SharedModelTargetAgent | null): void {
  capabilityBrokerAgentOverride = agent;
}

vi.mock("@/services/modelSelectionBroker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/modelSelectionBroker")>();
  const modelIdByAgent: Record<SharedModelTargetAgent, string> = {
    runtime_chat: "chat-model",
    planner: "planner-model",
    coder: "coder",
    reviewer: "reviewer-model",
    debugger: "debugger-model"
  };
  const brokerAgentByShared: Record<SharedModelTargetAgent, BrokerModelTargetAgent> = {
    runtime_chat: "default",
    planner: "planner",
    coder: "coder",
    reviewer: "reviewer",
    debugger: "debugger"
  };
  return {
    ...actual,
    brokerDecision: (...args: Parameters<typeof actual.brokerDecision>) => {
      const decision = actual.brokerDecision(...args);
      if (!capabilityBrokerAgentOverride) {
        return decision;
      }
      const sharedAgent = capabilityBrokerAgentOverride;
      const brokerAgent = brokerAgentByShared[sharedAgent];
      const modelId = modelIdByAgent[sharedAgent];
      return {
        ...decision,
        targetAgent: brokerAgent,
        resolvedModelId: modelId,
        resolvedModelName: modelId,
        configuredModelId: modelId,
        selectionSource: "role_setting" as const
      };
    }
  };
});

vi.mock("@/services/clarificationPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/clarificationPolicy")>();
  return {
    ...actual,
    decideClarification: () => ({ shouldAsk: false, reason: "none" as const })
  };
});

vi.mock("@/services/executionAnswerValidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/executionAnswerValidation")>();
  return {
    ...actual,
    gateExecutionFinalAnswer: (input: Parameters<typeof actual.gateExecutionFinalAnswer>[0]) => {
      const validation = actual.validateExecutionAnswer({
        executionIntent: input.executionIntent,
        finalAnswer: input.finalAnswer,
        toolCallsExecuted: input.toolCallsExecuted,
        filesChanged: 0,
        commandsExecuted: 0
      });
      return { valid: true, validation, rejectAsInvalid: false };
    }
  };
});

const runningStatus: RuntimeStatus = {
  state: "running",
  provider: "llama.cpp",
  model_id: "coder",
  model_name: "Coder Test",
  port: 8081,
  pid: 42,
  endpoint: "http://127.0.0.1:8081",
  message: ""
};

const readyChatSlot = {
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

const readyWorkSlot = {
  slot_id: "fast_gpu",
  state: "running",
  provider: "llama.cpp",
  model_id: "coder",
  model_name: "Coder Test",
  port: 8082,
  pid: 43,
  endpoint: "http://127.0.0.1:8082",
  chat_ready: true,
  context_size: 8192
};

let fixtureRoot = "";
let fixtureName = "";
let fixtureFiles: Awaited<ReturnType<typeof loadFixtureWorkspaceFiles>>["projectFiles"] = [];
let fileContents = new Map<string, string>();

function createCatalogDeps(): CatalogScenarioDeps {
  return {
    fixtureRoot,
    fixtureName,
    fixtureFiles,
    fileContents,
    runningStatus,
    mockAssistantResponse,
    sendChatStreamMock,
    queueProposedChangesMock,
    enqueueJobMock
  };
}

export const sendChatStreamMock = vi.fn();
const resolveRoutingMock = vi.fn();
const queueProposedChangesMock = vi.fn();
const enqueueJobMock = vi.fn();
const verifySlotForRequestMock = vi.fn();
const getSlotStatusMock = vi.fn();
const getAllSlotsStatusMock = vi.fn();
export { getAllSlotsStatusMock };
const startSlotMock = vi.fn();
const stopSlotMock = vi.fn();
const waitForSlotReadyMock = vi.fn();
const warmupInferenceMock = vi.fn();
const previewResourcePlanMock = vi.fn();
const resolveDefaultModelForSlotMock = vi.fn();
const isSlotReadyMock = vi.fn((status: { state?: string; chat_ready?: boolean }) =>
  status?.state === "running" && status?.chat_ready === true
);

vi.mock("@/services/agentRunService", () => ({
  agentRunService: {
    sendChatStream: (...args: unknown[]) => sendChatStreamMock(...args),
    sendChat: (...args: unknown[]) => sendChatStreamMock(...args),
    resolveRouting: (...args: unknown[]) => resolveRoutingMock(...args)
  }
}));

vi.mock("@/services/backendClient", () => ({
  backendClient: {
    getRuntimeStatus: vi.fn(),
    enqueueJob: (...args: unknown[]) => enqueueJobMock(...args)
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
    isSlotReady: (status: unknown) => isSlotReadyMock(status as { state?: string; chat_ready?: boolean })
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

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({
      queueProposedChanges: (...args: unknown[]) => queueProposedChangesMock(...args)
    })
  }
}));

function resetSlotMocks(): void {
  verifySlotForRequestMock.mockReset();
  verifySlotForRequestMock.mockResolvedValue({ ok: true, slotId: "fast_gpu", status: readyWorkSlot });
  getSlotStatusMock.mockReset();
  getSlotStatusMock.mockImplementation(async (slotId: string) =>
    slotId === "quality_cpu" ? readyChatSlot : readyWorkSlot
  );
  getAllSlotsStatusMock.mockReset();
  getAllSlotsStatusMock.mockResolvedValue([readyChatSlot, readyWorkSlot]);
  startSlotMock.mockReset();
  startSlotMock.mockResolvedValue({ success: true, slotId: "fast_gpu" });
  stopSlotMock.mockReset();
  stopSlotMock.mockResolvedValue({ success: true });
  waitForSlotReadyMock.mockReset();
  waitForSlotReadyMock.mockResolvedValue(readyWorkSlot);
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
  resolveDefaultModelForSlotMock.mockImplementation(async (slotId: string) =>
    slotId === "quality_cpu" ? "chat-model" : "coder"
  );
  isSlotReadyMock.mockClear();
}

function resetStores(): void {
  useRuntimeStore.setState({ status: null, isLoading: false, error: null });
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      defaultModelId: "chat-model",
      defaultChatModelId: "chat-model",
      defaultPlannerModelId: "planner-model",
      defaultCoderModelId: "coder",
      defaultReviewerModelId: "reviewer-model",
      defaultDebugModelId: "debugger-model",
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
    lastRouting: null,
    enabledSkillIds: [],
    toolsEnabled: false
  });
  useRuntimeChatApprovalStore.setState({
    takeovers: [],
    toolApprovals: []
  });
}

function mockAssistantResponse(content: string): void {
  sendChatStreamMock.mockImplementationOnce(
    async (_request: unknown, callbacks: { onDelta: (delta: string, total: number) => void }) => {
      callbacks.onDelta(content, content.length);
      return {
        message: { role: "assistant", content },
        model_id: "coder",
        model_name: "Coder Test"
      } satisfies RuntimeChatResponse;
    }
  );
}

function installFixtureBridge(): void {
  window.dbzs = {
    getAppInfo: vi.fn().mockResolvedValue({
      name: "dbzs-test",
      version: "0.0.0",
      platform: "test",
      backendUrl: "http://127.0.0.1:8876"
    }),
    getBackendHealth: vi.fn().mockResolvedValue({ status: "ok", app: "DBZS", version: "0.0.0" }),
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockImplementation(async (settings) => settings),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    getModelIndex: vi.fn(),
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
    generateDocs: vi.fn(),
    readProjectFile: vi.fn(async (filePath: string) => {
      const normalizedRoot = fixtureRoot.replace(/\\/g, "/");
      const normalizedPath = filePath.replace(/\\/g, "/");
      const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : normalizedPath;
      const content = fileContents.get(relative);
      if (!content) {
        return null;
      }
      return toWorkspaceFile(fixtureRoot, relative, content);
    })
  } as unknown as typeof window.dbzs;
}

export async function bootstrapCapabilityHarness(): Promise<void> {
  const fixture = await loadFixtureWorkspaceFiles();
  fixtureRoot = fixture.root;
  fixtureName = fixture.name;
  fixtureFiles = fixture.projectFiles;
  fileContents = fixture.fileContents;

  resetStores();
  resetSlotMocks();
  resetRuntimeRunFinalizationForTests();
  clearActiveTaskContract(fixtureRoot);
  clearPendingWorkflowScopeDecision(fixtureRoot);
  installFixtureBridge();
  sendChatStreamMock.mockReset();
  resolveRoutingMock.mockReset();
  queueProposedChangesMock.mockReset();
  enqueueJobMock.mockReset();

  resolveRoutingMock.mockResolvedValue({
    targetAgent: "runtime_chat",
    modelId: "coder-test",
    modelName: "Coder Test",
    providerId: "llama-cpp"
  });

  vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(runningStatus);
}

export function getCapabilityScenarios(): CapabilityScenario[] {
  return [...buildCatalogVitestScenarios(createCatalogDeps), ...buildInfrastructureScenarios(createCatalogDeps)];
}
