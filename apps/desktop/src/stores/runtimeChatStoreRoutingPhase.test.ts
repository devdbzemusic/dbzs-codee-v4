import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MultimodalPair, ReasoningTraceEvent } from "@dbzs/shared";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import type { CanonicalWorkflowAssignment } from "@/runtime/workflow/workflowContracts";

const {
  brokerDecisionMock,
  createRuntimeBindingDecisionMock,
  upsertActiveTaskContractMock,
  validateResolvedRuntimeRouteMock,
  useSettingsStoreGetStateMock,
  useModelIndexStoreGetStateMock,
  hasConfiguredRoleModelForTaskMock,
  getAllSlotsStatusMock
} = vi.hoisted(() => ({
  brokerDecisionMock: vi.fn(),
  createRuntimeBindingDecisionMock: vi.fn(),
  upsertActiveTaskContractMock: vi.fn(),
  validateResolvedRuntimeRouteMock: vi.fn(),
  useSettingsStoreGetStateMock: vi.fn(),
  useModelIndexStoreGetStateMock: vi.fn(),
  hasConfiguredRoleModelForTaskMock: vi.fn(),
  getAllSlotsStatusMock: vi.fn()
}));

vi.mock("@/services/modelSelectionBroker", () => ({
  brokerDecision: brokerDecisionMock,
  hasConfiguredRoleModelForTask: hasConfiguredRoleModelForTaskMock,
  BindingModelError: class BindingModelError extends Error {
    code = "binding_error";
    options: string[] = [];
  },
  formatModelDisplayLabel: (modelName: string | null | undefined, modelId: string | null | undefined) =>
    modelName ?? modelId ?? "Lokales Modell"
}));

vi.mock("@/services/runtimeSlotManager", () => ({
  runtimeSlotManager: {
    getAllSlotsStatus: getAllSlotsStatusMock
  }
}));

vi.mock("@/services/runtimeBinding", () => ({
  createRuntimeBindingDecision: createRuntimeBindingDecisionMock
}));

vi.mock("@/services/phaseAgentInvariant", () => ({
  assertValidPhaseAgentPair: () => ({ ok: true })
}));

vi.mock("@/runtime/agent/toolProtocolAdapter", () => ({
  resolveToolProtocolMode: () => "none"
}));

vi.mock("@/runtime/workflow/workflowPolicyRegistry", () => ({
  WORKFLOW_POLICY_VERSION: "test-policy"
}));

vi.mock("@/services/runtimeChatRollout", () => ({
  canaryStageLabel: () => "stable",
  shouldStopForShadowMismatch: () => false
}));

vi.mock("@/services/runtimeRouteValidator", () => ({
  validateResolvedRuntimeRoute: validateResolvedRuntimeRouteMock
}));

vi.mock("@/services/runtimeChat/agentMapping", () => ({
  mapBrokerAgentToShared: (agent: string) => agent
}));

vi.mock("@/stores/runtimeChatStoreRuntimeHelpers", () => ({
  patchActivityRun: (run: unknown, patch: Record<string, unknown>) => ({ ...(run as object), ...patch })
}));

vi.mock("@/services/runtimeChatRunHelpers", () => ({
  appendRunEvent: (run: unknown) => run,
  updateRunStatus: (run: unknown, status: string) => ({ ...(run as object), status })
}));

vi.mock("@/services/activeTaskContract", () => ({
  upsertActiveTaskContract: upsertActiveTaskContractMock
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: useSettingsStoreGetStateMock
  }
}));

vi.mock("@/stores/modelIndexStore", () => ({
  useModelIndexStore: {
    getState: useModelIndexStoreGetStateMock
  }
}));

vi.mock("@/services/modelRouterService", () => ({
  modelRouterService: {
    selectModelForAgent: () => null
  }
}));

vi.mock("@/services/ragClient", () => ({
  createTraceEvent: (_runId: string, type: string, title: string, message: string) => ({
    type,
    title,
    message
  })
}));

vi.mock("@/services/runtimeChatActivityHelpers", () => ({
  agentLabel: (agent: string) => agent
}));

import { runRoutingPhaseAction } from "@/stores/runtimeChatStoreRoutingPhase";

describe("runRoutingPhaseAction", () => {
  const multimodalPairs: MultimodalPair[] = [
    {
      id: "pair-verified",
      base_model_id: "vision-model",
      projector_artifact_id: "mmproj-vision-model",
      modalities: ["image", "text"],
      source: "manual",
      confidence: 1,
      status: "candidate",
      routing_allowed: true,
      candidate_base_model_ids: ["vision-model"]
    }
  ];

  beforeEach(() => {
    brokerDecisionMock.mockReset();
    createRuntimeBindingDecisionMock.mockReset();
    upsertActiveTaskContractMock.mockReset();
    validateResolvedRuntimeRouteMock.mockReset();
    hasConfiguredRoleModelForTaskMock.mockReset();
    getAllSlotsStatusMock.mockReset();
    hasConfiguredRoleModelForTaskMock.mockReturnValue(true);
    getAllSlotsStatusMock.mockResolvedValue([]);

    brokerDecisionMock.mockReturnValue({
      taskType: "casual_chat",
      targetAgent: "default",
      slotId: "quality_cpu",
      modelId: "vision-model",
      modelName: "Vision Model",
      configuredModelId: "vision-model",
      resolvedModelId: "vision-model",
      resolvedModelName: "Vision Model",
      selectionSource: "role_setting",
      capabilities: ["chat", "vision"],
      hasImageInput: true,
      requiresVision: false,
      providerId: "llama-cpp",
      reason: ["task_type:casual_chat"],
      fallbackPolicy: "strict",
      decisionId: "decision-test",
      decidedAt: new Date("2026-07-28T10:00:00.000Z"),
      decisionSettingsRevision: 12
    });
    createRuntimeBindingDecisionMock.mockReturnValue({
      decisionId: "binding-test",
      phase: "implementation",
      targetAgent: "default",
      settingsRevision: 12,
      providerId: "llama-cpp"
    });
    validateResolvedRuntimeRouteMock.mockReturnValue({ ok: true });
    upsertActiveTaskContractMock.mockReturnValue(null);

    useSettingsStoreGetStateMock.mockReturnValue({
      settings: {
        runtimeChatCanaryPercent: 100,
        runtimeChatShadowMode: false,
        runtimeChatStopOnShadowMismatch: false,
        defaultModelId: "chat-default",
        defaultChatModelId: "vision-model",
        defaultModelName: "Default Model",
        runtimeChatEnableDiagnostics: true,
        modelDiscoveryMode: "project_local_strict"
      },
      settingsRevision: 12
    });
    useModelIndexStoreGetStateMock.mockReturnValue({
      index: {
        models: [
          {
            id: "vision-model",
            name: "Vision Model",
            artifact_type: "model",
            capabilities: ["chat", "vision"],
            recommended_use: "vision_candidate"
          }
        ],
        multimodal_pairs: multimodalPairs
      }
    });
  });

  it("passes multimodal pairs from the model index into broker routing", async () => {
    const set = vi.fn();
    const get = vi.fn(() => ({
      activeRun: { id: "run-1" },
      currentActivity: { id: "activity-1" },
      historicalRuns: {}
    })) as unknown as () => RuntimeChatState;
    const activity = {
      id: "activity-1",
      startedAt: "2026-07-28T10:00:00.000Z",
      userPrompt: "Bitte pruefe das Bild",
      targetAgent: "runtime_chat",
      steps: []
    } as unknown as RuntimeChatActivityRun;
    const callbacks = {
      failStep: vi.fn(),
      finishStep: vi.fn(),
      appendStepDetail: vi.fn(),
      updateActiveRun: vi.fn(),
      updateActivity: vi.fn(),
      getActivity: vi.fn(() => activity)
    };
    const safeTraceEvents: ReasoningTraceEvent[] = [];
    const workflowAssignment = {
      workflowKind: "execution",
      phase: "implementation",
      effectiveAgent: "runtime_chat",
      requestedAgent: "runtime_chat",
      policyVersion: 1,
      modelRole: "primary",
      toolProfile: "standard",
      source: "normalized",
      normalized: true,
      normalizationReasons: []
    } as unknown as CanonicalWorkflowAssignment;

    const result = await runRoutingPhaseAction({
      set,
      get,
      sendOptions: { workspaceRoot: "C:/repo" },
      trimmedContent: "Bitte pruefe das Bild",
      taskType: "casual_chat",
      effectiveAgent: "runtime_chat",
      requestCapabilities: {
        hasImageInput: true,
        requiresVision: false
      },
      preferPlannerFirst: true,
      toolsEnabled: false,
      continuation: {
        useActiveContract: false,
        reason: "fresh_turn"
      },
      activeTaskContract: null,
      workflowAssignment,
      runWorkspaceRoot: null,
      initialRunId: "run-1",
      safeTraceEvents,
      callbacks,
      resetFirstTokenTimeout: vi.fn(),
      clearTotalTimeout: vi.fn()
    });

    expect(brokerDecisionMock).toHaveBeenCalledTimes(1);
    expect(brokerDecisionMock.mock.calls[0]?.[2]).toMatchObject({
      hasImageInput: true,
      multimodalPairs
    });
    expect(callbacks.appendStepDetail).toHaveBeenCalledWith(
      "model-route",
      expect.stringContaining("Agent runtime_chat -> Slot quality_cpu -> Modell Vision Model")
    );
    expect(callbacks.appendStepDetail).toHaveBeenCalledWith(
      "model-route",
      expect.stringContaining("Quelle role_setting")
    );
    const liveRunUpdate = callbacks.updateActiveRun.mock.calls[0]?.[0];
    expect(liveRunUpdate?.({ id: "run-1", status: "preparing", events: [] })).toMatchObject({
      status: "routing",
      provider: "llama-cpp",
      modelId: "vision-model",
      modelName: "Vision Model",
      slotId: "quality_cpu",
      configuredModelId: "vision-model",
      selectionSource: "role_setting",
      settingsRevision: 12,
      warmupStatus: "pending",
      phaseLabel: "implementation",
      targetAgentLabel: "default"
    });
    expect(result.handled).toBe(false);
    expect(result.routing?.modelId).toBe("vision-model");
  });

  function buildCallArgs(overrides: { taskType?: string; workflowAssignment?: CanonicalWorkflowAssignment } = {}) {
    const set = vi.fn();
    const get = vi.fn(() => ({
      activeRun: { id: "run-1" },
      currentActivity: { id: "activity-1" },
      historicalRuns: {}
    })) as unknown as () => RuntimeChatState;
    const activity = {
      id: "activity-1",
      startedAt: "2026-07-28T10:00:00.000Z",
      userPrompt: "Hallo",
      targetAgent: "runtime_chat",
      steps: []
    } as unknown as RuntimeChatActivityRun;
    const callbacks = {
      failStep: vi.fn(),
      finishStep: vi.fn(),
      appendStepDetail: vi.fn(),
      updateActiveRun: vi.fn(),
      updateActivity: vi.fn(),
      getActivity: vi.fn(() => activity)
    };
    const workflowAssignment =
      overrides.workflowAssignment ??
      ({
        workflowKind: "execution",
        phase: "implementation",
        effectiveAgent: "runtime_chat",
        requestedAgent: "runtime_chat",
        policyVersion: 1,
        modelRole: "primary",
        toolProfile: "standard",
        source: "normalized",
        normalized: true,
        normalizationReasons: []
      } as unknown as CanonicalWorkflowAssignment);
    return {
      set,
      get,
      sendOptions: { workspaceRoot: "C:/repo" },
      trimmedContent: "Hallo",
      taskType: overrides.taskType ?? "casual_chat",
      effectiveAgent: "runtime_chat" as const,
      requestCapabilities: { hasImageInput: false, requiresVision: false },
      preferPlannerFirst: true,
      toolsEnabled: false,
      continuation: { useActiveContract: false, reason: "fresh_turn" },
      activeTaskContract: null,
      workflowAssignment,
      runWorkspaceRoot: null,
      initialRunId: "run-1",
      safeTraceEvents: [] as ReasoningTraceEvent[],
      callbacks,
      resetFirstTokenTimeout: vi.fn(),
      clearTotalTimeout: vi.fn()
    };
  }

  it("does not fetch slot status when a role model is already configured", async () => {
    hasConfiguredRoleModelForTaskMock.mockReturnValue(true);

    await runRoutingPhaseAction(buildCallArgs() as never);

    expect(getAllSlotsStatusMock).not.toHaveBeenCalled();
    expect(brokerDecisionMock.mock.calls[0]?.[2]).toMatchObject({ runningModels: undefined });
  });

  it("fetches slot status and passes running models into the broker when no role model is configured", async () => {
    hasConfiguredRoleModelForTaskMock.mockReturnValue(false);
    getAllSlotsStatusMock.mockResolvedValue([
      { slot_id: "quality_cpu", model_id: "running-model", state: "running" },
      { slot_id: "fast_gpu", model_id: null, state: "stopped" },
      { slot_id: "orchestrator_cpu", model_id: "orchestrator-model", state: "running" }
    ]);

    await runRoutingPhaseAction(buildCallArgs() as never);

    expect(getAllSlotsStatusMock).toHaveBeenCalledTimes(1);
    expect(brokerDecisionMock.mock.calls[0]?.[2]).toMatchObject({
      runningModels: [{ slotId: "quality_cpu", modelId: "running-model" }]
    });
  });
});
