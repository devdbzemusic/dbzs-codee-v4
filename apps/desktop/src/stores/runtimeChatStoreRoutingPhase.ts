import { workspaceScopeId } from "@dbzs/shared";
import type {
  ReasoningTraceEvent,
  RuntimeChatRun,
  RuntimeRunOutcome,
  RuntimeTaskType
} from "@dbzs/shared";
import type { RuntimeChatState, RuntimeChatSendOptions } from "@/stores/runtimeChatStore";
import type { RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import type { RuntimeChatActivityRun } from "@/types/runtimeChatActivity";
import type { CanonicalWorkflowAssignment } from "@/runtime/workflow/workflowContracts";
import type { ActiveTaskContract } from "@/services/activeTaskContract";
import type { RuntimeBindingDecision } from "@/services/runtimeBinding";
import type { ModelSelectionDecision } from "@/services/modelSelectionBroker";
import { brokerDecision, BindingModelError, formatModelDisplayLabel } from "@/services/modelSelectionBroker";
import { createRuntimeBindingDecision } from "@/services/runtimeBinding";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import { resolveToolProtocolMode } from "@/runtime/agent/toolProtocolAdapter";
import { WORKFLOW_POLICY_VERSION } from "@/runtime/workflow/workflowPolicyRegistry";
import { canaryStageLabel, shouldStopForShadowMismatch } from "@/services/runtimeChatRollout";
import { validateResolvedRuntimeRoute } from "@/services/runtimeRouteValidator";
import { mapBrokerAgentToShared } from "@/services/runtimeChat/agentMapping";
import { patchActivityRun } from "@/stores/runtimeChatStoreRuntimeHelpers";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { upsertActiveTaskContract } from "@/services/activeTaskContract";
import { useSettingsStore } from "@/stores/settingsStore";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { modelRouterService } from "@/services/modelRouterService";
import { createTraceEvent } from "@/services/ragClient";
import { agentLabel } from "@/services/runtimeChatActivityHelpers";

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

interface RoutingCallbacks {
  failStep: (id: string, label: string, detail: string) => void;
  finishStep: (id: string, label: string, detail?: string) => void;
  appendStepDetail: (id: string, line: string) => void;
  updateActiveRun: (updater: (run: RuntimeChatRun) => RuntimeChatRun) => void;
  updateActivity: (nextRun: RuntimeChatActivityRun) => void;
  getActivity: () => RuntimeChatActivityRun;
}

export interface RoutingPhaseResult {
  handled: boolean;
  result: boolean;
  routing: RuntimeChatRoutingInfo | null;
  brokerDecisionFull: ModelSelectionDecision | null;
  bindingDecision: RuntimeBindingDecision | null;
  activeTaskContract: ActiveTaskContract | null;
  contextSlotId: string | null;
  displayModelLabel: string | null;
  shadowMatch: boolean | null;
}

export async function runRoutingPhaseAction(input: {
  set: Setter;
  get: Getter;
  sendOptions: RuntimeChatSendOptions | undefined;
  trimmedContent: string;
  taskType: RuntimeTaskType;
  effectiveAgent: RuntimeChatRoutingInfo["targetAgent"];
  requestCapabilities: {
    hasImageInput: boolean;
    requiresVision: boolean;
  };
  preferPlannerFirst: boolean;
  toolsEnabled: boolean;
  continuation: {
    useActiveContract: boolean;
    reason: string;
  };
  activeTaskContract: ActiveTaskContract | null;
  workflowAssignment: CanonicalWorkflowAssignment;
  runWorkspaceRoot: string | null;
  initialRunId: string;
  safeTraceEvents: ReasoningTraceEvent[];
  callbacks: RoutingCallbacks;
  resetFirstTokenTimeout: () => void;
  clearTotalTimeout: () => void;
}): Promise<RoutingPhaseResult> {
  const {
    set,
    get,
    sendOptions,
    trimmedContent,
    taskType,
    effectiveAgent,
    requestCapabilities,
    preferPlannerFirst,
    toolsEnabled,
    continuation,
    workflowAssignment,
    runWorkspaceRoot,
    initialRunId,
    safeTraceEvents,
    callbacks,
    resetFirstTokenTimeout,
    clearTotalTimeout
  } = input;
  let activeTaskContract = input.activeTaskContract;
  let routing: RuntimeChatRoutingInfo;
  let brokerDecisionFull: ModelSelectionDecision | undefined;
  let bindingDecision: RuntimeBindingDecision | null = null;
  let shadowMatch: boolean | null = null;

  try {
    const settings = useSettingsStore.getState().settings;
    const canaryPercent = settings.runtimeChatCanaryPercent ?? 100;
    const shadowMode = settings.runtimeChatShadowMode ?? false;
    const stopOnShadowMismatch = settings.runtimeChatStopOnShadowMismatch ?? false;
    const canaryStage = canaryStageLabel(canaryPercent);
    const catalog =
      useModelIndexStore.getState().index?.models.map((model) => ({
        id: model.id,
        name: model.name,
        capabilities: model.capabilities,
        recommended_use: model.recommended_use,
        supportsVision: model.capabilities?.includes("vision"),
        supportsTextOnly:
          model.capabilities?.includes("chat") && model.capabilities?.includes("vision")
            ? true
            : undefined
      })) ?? undefined;
    const settingsState = useSettingsStore.getState();

    callbacks.appendStepDetail(
      "model-route",
      `binding_broker=yes rollout_stage=${canaryStage} workflow=${continuation.reason}`
    );

    const decision = brokerDecision(
      taskType,
      {
        defaultModelId: settings.defaultModelId,
        defaultChatModelId: settings.defaultChatModelId,
        defaultModelName: settings.defaultModelName || "Default Model",
        defaultPlannerModelId: settings.defaultPlannerModelId,
        defaultCoderModelId: settings.defaultCoderModelId,
        defaultReviewerModelId: settings.defaultReviewerModelId,
        defaultDebugModelId: settings.defaultDebugModelId,
        localOnlyModels: settings.modelDiscoveryMode === "project_local_strict"
      },
      {
        hasImageInput: requestCapabilities.hasImageInput,
        requiresVision: requestCapabilities.requiresVision,
        preferPlannerFirst,
        catalog,
        settingsRevision: settingsState.settingsRevision,
        userMessage: trimmedContent,
        workflowAssignment
      }
    );
    brokerDecisionFull = decision;
    bindingDecision = createRuntimeBindingDecision({
      workspaceId: workspaceScopeId(runWorkspaceRoot ?? sendOptions?.workspaceRoot ?? ""),
      workspaceRoot: runWorkspaceRoot ?? sendOptions?.workspaceRoot ?? "",
      workflowId: activeTaskContract?.workflowId,
      workflowAssignment,
      brokerDecision: decision,
      protocolMode: toolsEnabled ? resolveToolProtocolMode(decision.providerId) : "none",
      policyVersion: WORKFLOW_POLICY_VERSION,
      activeContractId: activeTaskContract?.workflowId,
      activeContractInherited: continuation.useActiveContract,
      activeContractReason: continuation.reason,
      orchestratorModelId: settings.defaultOrchestratorModelId || undefined,
      orchestratorSlotId: "orchestrator_cpu"
    });

    routing = {
      targetAgent: mapBrokerAgentToShared(decision.targetAgent),
      modelId: decision.resolvedModelId,
      modelName: decision.resolvedModelName,
      providerId: decision.providerId === "llama-cpp" ? "llama-cpp" : null,
      slotId: decision.slotId,
      routingPath: "broker",
      rolloutStage: canaryStage,
      canaryPercent,
      shadowMode,
      shadowMatch: null,
      stopOnShadowMismatch,
      configuredModelId: decision.configuredModelId,
      selectionSource: decision.selectionSource,
      fallbackReason: decision.fallbackReason ?? null,
      settingsRevision: decision.decisionSettingsRevision,
      warmupStatus: "pending"
    };

    if (shadowMode) {
      const legacySelected = modelRouterService.selectModelForAgent(effectiveAgent, settings);
      if (legacySelected) {
        const isSameModel = legacySelected.id === decision.resolvedModelId;
        shadowMatch = isSameModel;
        callbacks.appendStepDetail(
          "model-route",
          `[shadow] broker=${decision.resolvedModelId}/${decision.slotId} legacy=${legacySelected.id}/no-slot match=${isSameModel ? "yes" : "no"}`
        );
        const enforceShadowMismatchStop =
          import.meta.env.VITE_DBZS_ENFORCE_SHADOW_MISMATCH_STOP === "1";
        const shadowMismatchStopRequested = shouldStopForShadowMismatch({
          shadowMode,
          stopOnShadowMismatch,
          shadowMatch: isSameModel
        });
        if (enforceShadowMismatchStop && shadowMismatchStopRequested) {
          throw new Error("Shadow mismatch detected (broker vs legacy) - rollout stop criterion triggered");
        } else if (!enforceShadowMismatchStop && shadowMismatchStopRequested) {
          callbacks.appendStepDetail("model-route", "[shadow] mismatch stop ignored outside strict rollout gate");
        }
      } else {
        callbacks.appendStepDetail("model-route", "[shadow] legacy decision unavailable");
      }
    }

    if (input.activeTaskContract && input.activeTaskContract.workflowId && input.activeTaskContract.workflowId.length > 0) {
      // preserve current variable usage intent
    }
    if (runWorkspaceRoot) {
      const assignedAgent = mapBrokerAgentToShared(decision.targetAgent);
      activeTaskContract = upsertActiveTaskContract(runWorkspaceRoot, {
        originalRequest: activeTaskContract?.originalRequest ?? trimmedContent,
        confirmedGoal: activeTaskContract?.confirmedGoal ?? trimmedContent,
        acceptanceCriteria: activeTaskContract?.acceptanceCriteria ?? [],
        taskType,
        assignedAgent,
        currentPhase: workflowAssignment.phase,
        workflowKind: workflowAssignment.workflowKind,
        effectiveAgent: workflowAssignment.effectiveAgent,
        requestedAgent: workflowAssignment.requestedAgent ?? undefined,
        policyVersion: workflowAssignment.policyVersion,
        modelRole: workflowAssignment.modelRole,
        toolProfile: workflowAssignment.toolProfile,
        runId: initialRunId,
        answeredQuestions: activeTaskContract?.answeredQuestions
      });
    }
  } catch (error) {
    const errMsg =
      error instanceof BindingModelError
        ? `${error.message}${error.options.length ? ` Optionen: ${error.options.join(" · ")}` : ""}`
        : error instanceof Error
          ? error.message
          : "Routing fehlgeschlagen";
    callbacks.failStep("model-route", "Modell-Routing", errMsg);
    callbacks.updateActiveRun((run) => appendRunEvent(updateRunStatus(run, "failed"), "chat.failed", errMsg));
    callbacks.updateActivity(
      patchActivityRun(callbacks.getActivity(), {
        finishedAt: new Date().toISOString(),
        summary: `Abgebrochen: ${errMsg}`
      })
    );
    const finishedRun = get().activeRun;
    resetFirstTokenTimeout();
    clearTotalTimeout();
    set((state) => ({
      error: errMsg,
      isSending: false,
      lastActivity: state.currentActivity,
      currentActivity: null,
      activeRun: null,
      historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
    }));
    return {
      handled: true,
      result: false,
      routing: null,
      brokerDecisionFull: null,
      bindingDecision: null,
      activeTaskContract,
      contextSlotId: null,
      displayModelLabel: null,
      shadowMatch: null
    };
  }

  const runtimeFlags = useSettingsStore.getState().settings;
  const contextSlotId = ((taskType: RuntimeTaskType, slotId?: string | null): "quality_cpu" | "fast_gpu" | "utility" => {
    if (slotId === "quality_cpu" || slotId === "fast_gpu" || slotId === "utility") {
      return slotId;
    }
    if (["small_code_change", "large_code_change", "debugging", "review", "planning", "architecture", "test_analysis", "refactoring"].includes(taskType)) {
      return "fast_gpu";
    }
    if (["embedding", "reranking", "indexing"].includes(taskType)) {
      return "utility";
    }
    return "quality_cpu";
  })(taskType, routing.slotId);
  routing.slotId = contextSlotId;

  const indexedName = useModelIndexStore
    .getState()
    .index?.models.find((model) => model.id === routing.modelId || model.name === routing.modelId)?.name;
  if (indexedName?.trim()) {
    routing.modelName = indexedName.trim();
  } else {
    routing.modelName = formatModelDisplayLabel(
      routing.modelName,
      routing.modelId,
      runtimeFlags.defaultModelName || "Lokales Modell"
    );
  }
  const displayModelLabel = formatModelDisplayLabel(
    routing.modelName,
    routing.modelId,
    runtimeFlags.defaultModelName || "Lokales Modell"
  );
  safeTraceEvents.push(
    createTraceEvent(initialRunId, "model_selected", "Modell gewählt", `${displayModelLabel} · ${contextSlotId}`)
  );
  const diagnosticsEnabled = runtimeFlags.runtimeChatEnableDiagnostics ?? true;
  routing.shadowMatch = shadowMatch;
  set({ lastRouting: routing, lastBrokerDecision: diagnosticsEnabled ? brokerDecisionFull ?? null : null });
  callbacks.updateActivity(
    patchActivityRun(callbacks.getActivity(), {
      modelId: routing.modelId ?? undefined,
      modelName: displayModelLabel,
      providerId: routing.providerId ?? undefined
    })
  );
  callbacks.finishStep(
    "model-route",
    "Modell-Routing",
    `Agent ${agentLabel(effectiveAgent)} → ${displayModelLabel} (${routing.providerId ?? "runtime"})`
  );
  callbacks.updateActiveRun((run) => {
    const updated = appendRunEvent(
      run,
      "routing.completed",
      `Modell gewählt: ${displayModelLabel}`,
      {
        rolloutStage: routing.rolloutStage ?? null,
        routingPath: routing.routingPath ?? null,
        canaryPercent: routing.canaryPercent ?? null,
        shadowMode: routing.shadowMode ?? false,
        shadowMatch: routing.shadowMatch ?? null,
        stopOnShadowMismatch: routing.stopOnShadowMismatch ?? false
      }
    );
    return {
      ...updated,
      provider: routing.providerId ?? undefined,
      modelId: routing.modelId ?? undefined,
      modelName: displayModelLabel,
      slotId: routing.slotId ?? undefined,
      configuredModelId: routing.configuredModelId ?? undefined,
      selectionSource: routing.selectionSource ?? undefined,
      fallbackReason: routing.fallbackReason ?? undefined,
      settingsRevision: routing.settingsRevision ?? undefined,
      warmupStatus: routing.warmupStatus ?? undefined,
      workflowLabel:
        activeTaskContract?.confirmedGoal ??
        activeTaskContract?.workflowId ??
        trimmedContent,
      phaseLabel: bindingDecision?.phase ?? workflowAssignment.phase,
      targetAgentLabel: bindingDecision?.targetAgent ?? brokerDecisionFull?.targetAgent
    };
  });

  const resolvedRoute = {
    modelId: routing.modelId,
    modelName: routing.modelName,
    slotId: contextSlotId,
    profile: sendOptions?.runtimeProfileOverride ?? "balanced",
    provider: routing.providerId ?? "runtime",
    reasons: brokerDecisionFull?.reason ?? [],
    source: routing.selectionSource
  };
  const routeValidation = validateResolvedRuntimeRoute(resolvedRoute, brokerDecisionFull);
  if (!routeValidation.ok) {
    const validationError = `Inkonsistente Routing-Entscheidung: ${routeValidation.conflicts?.join(", ") ?? "unbekannter Konflikt"}`;
    callbacks.failStep("model-route", "Modell-Routing", validationError);
    callbacks.updateActiveRun((run) =>
      appendRunEvent(
        {
          ...updateRunStatus(run, "failed"),
          outcome: "internal_error" satisfies RuntimeRunOutcome,
          error: { code: "runtime_route_inconsistent", message: validationError, phase: "routing" }
        },
        "chat.failed",
        validationError
      )
    );
    const finishedRun = get().activeRun;
    set((state) => ({
      error: validationError,
      isSending: false,
      activeRun: null,
      historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
    }));
    return {
      handled: true,
      result: false,
      routing,
      brokerDecisionFull: brokerDecisionFull ?? null,
      bindingDecision,
      activeTaskContract,
      contextSlotId,
      displayModelLabel,
      shadowMatch
    };
  }

  const phaseAgentGate = assertValidPhaseAgentPair(
    workflowAssignment.phase,
    workflowAssignment.effectiveAgent
  );
  if (!phaseAgentGate.ok) {
    const invalidMsg = `Interner Workflow-Routingfehler. Diagnose-ID: ${initialRunId}`;
    callbacks.appendStepDetail("model-route", `policy_error=${phaseAgentGate.reason}`);
    callbacks.failStep("model-route", "Modell-Routing", invalidMsg);
    callbacks.updateActiveRun((run) =>
      appendRunEvent(
        {
          ...updateRunStatus(run, "failed"),
          outcome: "workflow_state_invalid" satisfies RuntimeRunOutcome,
          phaseLabel: workflowAssignment.phase,
          targetAgentLabel: workflowAssignment.effectiveAgent,
          error: { code: "workflow_state_invalid", message: invalidMsg, phase: "routing" }
        },
        "chat.failed",
        invalidMsg
      )
    );
    const finishedRun = get().activeRun;
    resetFirstTokenTimeout();
    clearTotalTimeout();
    set((state) => ({
      error: invalidMsg,
      isSending: false,
      lastActivity: state.currentActivity,
      currentActivity: null,
      activeRun: null,
      historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
    }));
    return {
      handled: true,
      result: false,
      routing,
      brokerDecisionFull: brokerDecisionFull ?? null,
      bindingDecision,
      activeTaskContract,
      contextSlotId,
      displayModelLabel,
      shadowMatch
    };
  }

  return {
    handled: false,
    result: false,
    routing,
    brokerDecisionFull: brokerDecisionFull ?? null,
    bindingDecision,
    activeTaskContract,
    contextSlotId,
    displayModelLabel,
    shadowMatch
  };
}
