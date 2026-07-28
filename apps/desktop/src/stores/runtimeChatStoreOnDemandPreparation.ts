import { workspaceScopeId } from "@dbzs/shared";
import type {
  ChatActionRequest,
  RuntimeChatMessage,
  RuntimeChatRun,
  RuntimeRunOutcome,
  RuntimeTaskType
} from "@dbzs/shared";
import type { RuntimeChatState, RuntimeChatSendOptions } from "@/stores/runtimeChatStore";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import type { CanonicalWorkflowAssignment } from "@/runtime/workflow/workflowContracts";
import type { RuntimeBindingDecision } from "@/services/runtimeBinding";
import type { ModelSelectionDecision } from "@/services/modelSelectionBroker";
import { BindingModelError, formatModelDisplayLabel } from "@/services/modelSelectionBroker";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import {
  assessResourcePlanRisk,
  buildResourceRiskQuestion,
  hasAcceptedResourceRisk,
  markResourceRiskAccepted,
  requiresExplicitResourceRiskDecision
} from "@/services/runtimeResourceRisk";
import { residentModelFromStatus } from "@/services/residentModelHelpers";
import { workflowForTaskType } from "@/services/missingInformationPolicy";
import { pathValidatorService } from "@/services/pathValidatorService";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { residentSlotTimeoutOverrides, type TimeoutConfig } from "@/services/timeoutConfig";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

export interface OnDemandPreparationResult {
  handled: boolean;
  result: boolean;
  routing: RuntimeChatRoutingInfo;
  bindingDecision: RuntimeBindingDecision;
  contextSlotId: "quality_cpu" | "fast_gpu" | "utility";
  slotId: "quality_cpu" | "fast_gpu" | "utility";
  modelToStart: string;
  currentSlotStatus: Awaited<ReturnType<typeof runtimeSlotManager.getSlotStatus>>;
  launchProfile: "cpu_safe" | "hybrid" | "balanced" | "large_context" | "fast";
  slotNeedsStart: boolean;
  backendUrl: string;
}

export async function prepareOnDemandRuntimeAction(input: {
  set: Setter;
  get: Getter;
  sendOptions: RuntimeChatSendOptions | undefined;
  taskType: RuntimeTaskType;
  effectiveAgent: RuntimeChatRoutingInfo["targetAgent"];
  workflowAssignment: CanonicalWorkflowAssignment;
  initialRunId: string;
  userMessage: RuntimeChatMessage;
  activity: RuntimeChatState["currentActivity"];
  nextMessages: RuntimeChatMessage[];
  routing: RuntimeChatRoutingInfo;
  bindingDecision: RuntimeBindingDecision;
  brokerDecisionFull: ModelSelectionDecision;
  contextSlotId: "quality_cpu" | "fast_gpu" | "utility";
  trimmedContent: string;
  resetFirstTokenTimeout: () => void;
  clearTotalTimeout: () => void;
  timeoutManager: { config: TimeoutConfig };
  callbacks: {
    appendStepDetail: (id: string, line: string) => void;
    failStep: (id: string, label: string, detail: string) => void;
    updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
    syncActiveRunBindingPatch: (patch: Partial<RuntimeChatRun>) => void;
    updateActivitySummary: (summary: string) => void;
  };
}): Promise<OnDemandPreparationResult> {
  const {
    set,
    get,
    sendOptions,
    taskType,
    effectiveAgent,
    workflowAssignment,
    initialRunId,
    userMessage,
    activity,
    routing,
    trimmedContent,
    resetFirstTokenTimeout,
    clearTotalTimeout,
    timeoutManager,
    callbacks
  } = input;
  let { bindingDecision, brokerDecisionFull, contextSlotId } = input;

  const phaseAgentGate = assertValidPhaseAgentPair(
    workflowAssignment.phase,
    workflowAssignment.effectiveAgent
  );
  if (!phaseAgentGate.ok) {
    throw new Error(`workflow_state_invalid: internal_policy_error:${initialRunId}`);
  }

  const backendUrl = useSettingsStore.getState().settings.backendUrl || "http://localhost:8000";
  let slotId = contextSlotId;
  const currentSlotStatus = await runtimeSlotManager.getSlotStatus(slotId);
  let modelToStart = bindingDecision.resolvedModelId || routing.modelId;
  if (!modelToStart || modelToStart === "default") {
    throw new Error("runtime_start_failed: binding_model_missing");
  }

  const residentModelInfo = residentModelFromStatus(
    currentSlotStatus,
    useModelIndexStore.getState().index?.models
  );
  if (sendOptions?.forceUseResidentModel && currentSlotStatus && residentModelInfo?.isReady) {
    modelToStart = currentSlotStatus.model_id ?? modelToStart;
    routing.modelId = modelToStart;
    bindingDecision = {
      ...bindingDecision,
      resolvedModelId: modelToStart,
      resolvedModelName: currentSlotStatus.model_name || modelToStart,
      source: "resident_continue"
    };
    routing.modelName =
      currentSlotStatus.model_name ||
      formatModelDisplayLabel(routing.modelName, modelToStart);
    routing.selectionSource = "resident_continue";
    callbacks.appendStepDetail(
      "runtime-ondemand",
      `Fortsetzen mit residentem Modell: ${routing.modelName} (${modelToStart})`
    );
  } else {
    routing.modelId = modelToStart;
    routing.modelName =
      brokerDecisionFull.resolvedModelName ||
      formatModelDisplayLabel(routing.modelName, modelToStart);
  }

  callbacks.syncActiveRunBindingPatch({
    modelId: routing.modelId ?? undefined,
    modelName: routing.modelName ?? undefined,
    selectionSource: routing.selectionSource ?? undefined,
    slotId: routing.slotId ?? undefined
  });

  const launchProfile = sendOptions?.runtimeProfileOverride ?? "balanced";
  const slotNeedsStart =
    Boolean(sendOptions?.acceptResourceRisk && sendOptions?.runtimeProfileOverride) ||
    !runtimeSlotManager.isSlotReady(currentSlotStatus) ||
    currentSlotStatus?.model_id !== modelToStart;

  const resourcePreview = slotNeedsStart
    ? await runtimeSlotManager.previewResourcePlan(slotId, modelToStart, launchProfile)
    : null;
  const resourceAssessment = assessResourcePlanRisk(
    resourcePreview ?? {
      model_id: modelToStart,
      slot_id: slotId,
      estimated_model_bytes: 0,
      estimated_total_vram_bytes: 0,
      available_vram_bytes: currentSlotStatus?.vram_total_bytes ?? null,
      warnings: []
    }
  );

  callbacks.updateActiveRun((run) =>
    appendRunEvent(
      {
        ...run,
        resourceRisk: resourceAssessment.risk,
        resourceRiskReasons: resourceAssessment.reasons
      },
      "runtime.check.started",
      `resource_risk=${resourceAssessment.risk}${slotNeedsStart ? "" : ":resident_skip_ask"}`,
      {
        risk: resourceAssessment.risk,
        reasons: resourceAssessment.reasons,
        profile: launchProfile,
        slotNeedsStart
      }
    )
  );

  const riskAlreadyAccepted =
    sendOptions?.acceptResourceRisk === true ||
    sendOptions?.forceUseResidentModel === true ||
    hasAcceptedResourceRisk(slotId, modelToStart);

  if (
    slotNeedsStart &&
    requiresExplicitResourceRiskDecision(resourceAssessment.risk) &&
    !riskAlreadyAccepted
  ) {
    const roleLabel =
      taskType === "planning" || taskType === "architecture"
        ? "Plan"
        : taskType === "review"
          ? "Review"
          : taskType === "debugging"
            ? "Debug"
            : "Rollen";
    const residentReady =
      runtimeSlotManager.isSlotReady(currentSlotStatus) &&
      Boolean(currentSlotStatus?.model_id) &&
      currentSlotStatus?.model_id !== modelToStart;
    const question = buildResourceRiskQuestion({
      roleLabel,
      modelName: routing.modelName || modelToStart,
      risk: resourceAssessment.risk,
      reasons: resourceAssessment.reasons,
      residentModelName: residentReady
        ? currentSlotStatus?.model_name || currentSlotStatus?.model_id || null
        : null
    });
    const messageId = `msg-${Date.now().toString(36)}-resource-risk`;
    const actionWorkspaceRoot = sendOptions?.workspaceRoot ?? "";
    const action: ChatActionRequest = {
      id: `act-${Math.random().toString(36).substring(2, 10)}`,
      runId: initialRunId,
      messageId,
      workspaceRoot: actionWorkspaceRoot,
      workspaceId: workspaceScopeId(actionWorkspaceRoot),
      kind: "answer_question",
      title: question.prompt,
      description: question.context,
      riskLevel: question.riskLevel,
      payload: {
        question,
        preflight: {
          originalMessage: trimmedContent,
          targetAgent: effectiveAgent,
          workspaceRoot: sendOptions?.workspaceRoot ?? null,
          workflow: workflowForTaskType(taskType) ?? "review",
          taskType,
          hasImageInput: brokerDecisionFull.hasImageInput,
          requiresVision: brokerDecisionFull.requiresVision
        }
      },
      state: "pending",
      createdAt: new Date().toISOString()
    };
    callbacks.failStep("runtime-ondemand", "Arbeitsmodell laden", question.prompt);
    callbacks.updateActiveRun((run) =>
      appendRunEvent(
        {
          ...updateRunStatus(run, "waiting_for_user_answer"),
          outcome: "needs_user_input" satisfies RuntimeRunOutcome,
          resourceRisk: resourceAssessment.risk,
          resourceRiskReasons: resourceAssessment.reasons
        },
        "chat.question_asked",
        question.prompt
      )
    );
    const finishedRun = get().activeRun;
    resetFirstTokenTimeout();
    clearTotalTimeout();
    set((state) => ({
      messages: [
        ...state.messages.filter((m) => m.id !== userMessage.id),
        userMessage,
        { id: messageId, role: "system", content: question.prompt, actions: [action] }
      ],
      error: null,
      isSending: false,
      isStreaming: false,
      lastActivity: activity,
      currentActivity: null,
      activeRun: null,
      historicalRuns: finishedRun
        ? { ...state.historicalRuns, [finishedRun.id]: finishedRun }
        : state.historicalRuns
    }));
    return {
      handled: true,
      result: false,
      routing,
      bindingDecision,
      contextSlotId,
      slotId,
      modelToStart,
      currentSlotStatus,
      launchProfile,
      slotNeedsStart,
      backendUrl
    };
  }

  if (sendOptions?.acceptResourceRisk) {
    markResourceRiskAccepted(slotId, modelToStart);
  }

  const modelIndexEntry = useModelIndexStore.getState().index?.models.find((m) => m.id === modelToStart);
  if (modelIndexEntry) {
    const validation = await pathValidatorService.validateModelPaths(modelIndexEntry);
    if (!validation.ok) {
      throw new Error(`Pfad-Validierung fehlgeschlagen: ${validation.errors.join(", ")}`);
    }
  }

  if (!slotNeedsStart) {
    Object.assign(timeoutManager.config, residentSlotTimeoutOverrides());
  }

  return {
    handled: false,
    result: false,
    routing,
    bindingDecision,
    contextSlotId,
    slotId,
    modelToStart,
    currentSlotStatus,
    launchProfile,
    slotNeedsStart,
    backendUrl
  };
}
