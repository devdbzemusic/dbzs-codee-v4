import type {
  AgentAction,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentPlanProposal,
  ApprovedPlanContext,
  AssistantAnswer,
  ChatActionRequest,
  ModelTargetAgent,
  ReasoningTraceEvent,
  ReviewRemediationSelectionScope,
  RuntimeChatRun,
  RuntimeChatMessage,
  RuntimeTaskType
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import type { RuntimeChatState } from "@/stores/runtimeChatStore";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import { useEditorStore } from "@/stores/editorStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { createTraceEvent, traceClient } from "@/services/ragClient";
import { approvalCoordinator } from "@/services/approvalCoordinator";
import { questionCoordinator } from "@/services/questionCoordinator";
import { clearPendingQuestion } from "@/services/pendingQuestionPersistence";
import {
  answeredFieldIds,
  readActiveTaskContract,
  upsertActiveTaskContract
} from "@/services/activeTaskContract";
import { classifyUserExecutionIntent } from "@/services/executionIntent";
import { buildExecutionHandoff, mapExecutionIntentToHandoffIntent } from "@/services/executionHandoff";
import { createElectronReviewWorkspaceIO, saveRemediationReport, saveRemediationState } from "@/services/repositoryReview";
import { lookupProjectDecision } from "@/services/decisionMemoryService";
import { createChatRun, appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import {
  clearSkippedPreflightAssistantAnswer,
  handleClarificationAssistantAnswerFlow,
  handleResourceRiskAssistantAnswerFlow,
  handleRehydratedAssistantAnswerFlow,
  handleReviewRemediationAssistantAnswerFlow,
  handleWorkflowScopeAssistantAnswerFlow,
  type AssistantAnswerPreflight,
  type WorkflowScopeOptionId,
  workflowScopeDecisionLabel,
  type RehydratedPendingQuestionState
} from "@/stores/runtimeChatStoreAssistantAnswerFlows";
import {
  completeAssistantAnswerAction,
  markChatActionCompleted,
  markChatActionDecisionState,
  markChatActionFailed,
  withUpdatedMessage,
  withSyncedMessages
} from "@/stores/runtimeChatStoreInteractionMessageState";

const workflowScopeProcessingIds = new Set<string>();

export interface RuntimeChatInteractionStateSlice {
  messages: RuntimeChatMessage[];
  planProposalsById: Record<string, AgentPlanProposal>;
  agentActionsById: Record<string, AgentAction>;
  activePatchPreview: AgentPatchPreview | null;
  activePatchProposal: AgentPatchProposal | null;
  activeRun: RuntimeChatRun | null;
  rehydratedPendingQuestion: import("@/services/pendingQuestionPersistence").PendingQuestionState | null;
  lastRouting: { slotId?: string | null } | null;
  lastBrokerDecision: { resolvedModelId?: string | null } | null;
  pendingJobContextHint: string | null;
  toolProfile: AgentToolProfile | null;
  webResearchApprovedForRun: boolean;
  webResearchStatus: "idle" | "searching" | "fetching" | "succeeded" | "failed" | "cancelled" | "timed_out";
}

type Setter = (
  partial:
    | RuntimeChatState
    | Partial<RuntimeChatState>
    | ((state: RuntimeChatState) => RuntimeChatState | Partial<RuntimeChatState>)
) => void;

type Getter = () => RuntimeChatState;

export async function continueAgentRunAfterPlanApprovalAction(
  set: Setter,
  get: Getter,
  { runId, planProposalId, messageId }: { runId: string; planProposalId: string; messageId: string }
): Promise<ApprovedPlanContext> {
  const planProposal = get().planProposalsById[planProposalId];
  if (!planProposal) {
    throw new Error("Plan proposal not found");
  }

  const approvedPlanContext: ApprovedPlanContext = {
    planProposalId,
    title: planProposal.title,
    summary: planProposal.summary,
    steps: planProposal.steps,
    approvedAt: new Date().toISOString()
  };

  const settings = useSettingsStore.getState().settings;
  const workspaceRoot = get().activeRun?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath ?? "";
  const workspaceId = workspaceRoot ? workspaceScopeId(workspaceRoot) : "";
  const coderModelId = settings.defaultCoderModelId || settings.defaultModelId || "";
  const handoffIntent =
    mapExecutionIntentToHandoffIntent(classifyUserExecutionIntent(`${planProposal.title} ${planProposal.summary}`)) ??
    "implement";
  const handoff = buildExecutionHandoff({
    runId,
    workflowId: readActiveTaskContract(workspaceRoot)?.workflowId ?? runId,
    workspaceId,
    approvedPlanId: planProposalId,
    executionIntent: handoffIntent,
    coderModelId
  });

  if (workspaceRoot) {
    const currentContract = readActiveTaskContract(workspaceRoot);
    upsertActiveTaskContract(workspaceRoot, {
      originalRequest: currentContract?.originalRequest ?? planProposal.title,
      confirmedGoal: currentContract?.confirmedGoal ?? planProposal.title,
      acceptanceCriteria: currentContract?.acceptanceCriteria ?? [],
      taskType: currentContract?.taskType ?? "large_code_change",
      assignedAgent: "coder",
      currentPhase: "executing",
      answeredQuestions: currentContract?.answeredQuestions
    });
    if (currentContract?.reviewRemediation) {
      const capsule = currentContract.reviewRemediation;
      const now = new Date().toISOString();
      const resolutions = capsule.selectedFindingIds.map((findingId) => ({
        findingId,
        status: "planned" as const,
        changedFiles: [],
        verificationCommands: []
      }));
      const io = createElectronReviewWorkspaceIO();
      await saveRemediationState(io, workspaceRoot, {
        schemaVersion: 1,
        reviewId: capsule.reviewId,
        workspaceId: capsule.workspaceId,
        status: "planned",
        selectedFindingIds: capsule.selectedFindingIds,
        severityScope: capsule.severityScope,
        resolutions,
        createdAt: now,
        updatedAt: now
      });
      await saveRemediationReport(
        io,
        workspaceRoot,
        capsule.reviewId,
        [
          `# Remediation Report · ${capsule.reviewId}`,
          "",
          "Status: planned",
          `Freigegebener Plan: ${planProposal.title}`,
          `Finding-Scope: ${capsule.severityScope.join(", ")}`,
          "",
          "## Findings",
          ...resolutions.map((resolution) => `- ${resolution.findingId}: planned`),
          "",
          "Das originale `findings.json` bleibt unverändert."
        ].join("\n")
      );
    }
  }

  const existingRun = get().activeRun?.id === runId ? get().activeRun : null;
  const nextRun = existingRun ?? {
    ...createChatRun(`msg-${Date.now().toString(36)}-plan`, "agent", "agent", true, get().activeRun?.workspaceRoot ?? undefined),
    id: runId,
    status: "resuming_after_plan_approval" as const
  };
  set((state) => ({
    activeRun: state.activeRun
      ? updateRunStatus(
          appendRunEvent(
            appendRunEvent(state.activeRun as never, "chat.accepted", "Plan freigegeben, Lauf wird fortgesetzt"),
            "routing.completed",
            `Handoff Planner → Coder (${handoff.coderModelId || "defaultCoderModelId"}) · Intent ${handoff.executionIntent}`
          ),
          "resuming_after_plan_approval"
        ) as never
      : nextRun
  }));

  const pendingMessage = get().messages.find((m) => m.id === messageId);
  if (pendingMessage) {
    set((state) =>
      withUpdatedMessage(state, messageId, (message) => ({
        ...message,
        content: `${message.content}\n\n[Plan freigegeben: ${planProposal.title}]\n[Handoff: Planner → Coder]`,
        actions: message.actions?.map<ChatActionRequest>((action) =>
          action.kind === "approve_plan" ? { ...action, state: "running" } : action
        )
      }))
    );
  }

  const pendingContextHint = [
    "Approved Plan Context:",
    JSON.stringify(approvedPlanContext, null, 2),
    "",
    "Execution Handoff:",
    JSON.stringify(handoff, null, 2),
    "",
    "Continue as coder/executor. Use tools — do not instruct the user to open a terminal."
  ].join("\n");
  set((state) => ({
    pendingJobContextHint: state.pendingJobContextHint ? `${state.pendingJobContextHint}\n\n${pendingContextHint}` : pendingContextHint
  }));

  if (workspaceRoot) {
    void get().sendMessage(
      `Führe den freigegebenen Plan aus: ${planProposal.title}`,
      useRuntimeStore.getState().status,
      null,
      undefined,
      null,
      "coder",
      {
        workspaceRoot,
        agentMode: "agent",
        preferPlannerFirst: false,
        useAgentTurnLoop: true,
        toolProfile: get().toolProfile ?? "agent"
      }
    );
  }

  return approvedPlanContext;
}

export async function handleChatActionAction(
  set: Setter,
  get: Getter,
  actionId: string,
  messageId: string,
  approve: boolean,
  workspaceId: string
): Promise<void> {
  const msg = get().messages.find((m) => m.id === messageId);
  if (!msg || !msg.actions) return;

  const action = msg.actions.find((a) => a.id === actionId);
  if (!action) return;
  if (action.workspaceId !== workspaceId) {
    throw new Error("Strukturierte Aktion gehoert zu einem anderen Workspace.");
  }
  const traceRunId = action.runId || msg.safeReasoningSummary?.runId;
  if (traceRunId) {
    const approvalEvent = createTraceEvent(
      traceRunId,
      approve ? "approval_granted" : "approval_rejected",
      approve ? "Freigabe erteilt" : "Freigabe abgelehnt",
      `${action.kind}: ${action.title}`,
      "completed"
    );
    void traceClient.append(traceRunId, [approvalEvent]).then((trace) => {
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.id === messageId ? { ...entry, traceEvents: trace.events as ReasoningTraceEvent[], safeReasoningSummary: trace.summary } : entry
        )
      }));
    }).catch((error) => console.warn("Approval trace persistence failed:", error));
  }

  set((state) => {
    return markChatActionDecisionState(state, messageId, actionId, approve);
  });

  try {
    if (approve) {
      if (action.kind === "show_diff") {
        const preview = get().activePatchPreview;
        const proposal = get().activePatchProposal;
        if (preview && proposal) {
          set((state) =>
            withUpdatedMessage(state, messageId, (message) => ({
              ...message,
              content: `${message.content}\n\nDiff für ${proposal.title}:\n${preview.previews.map((p) => p.diff).join("\n\n")}`
            }))
          );
        }
      } else if (action.kind === "approve_patch") {
        await get().applyPatch();
      } else if (action.kind === "approve_plan") {
        const planProposalId = typeof action.payload?.planProposalId === "string" ? action.payload.planProposalId : null;
        const runId = typeof action.runId === "string" && action.runId.length > 0 ? action.runId : get().activeRun?.id ?? null;
        if (planProposalId && runId) {
          await get().continueAgentRunAfterPlanApproval({ runId, planProposalId, messageId });
        }
        set((state) => {
          const nextPlanProposalsById = {
            ...state.planProposalsById,
            [planProposalId ?? ""]: {
              ...(state.planProposalsById[planProposalId ?? ""] ?? {}),
              state: "approved"
            } as AgentPlanProposal
          };
          return {
            planProposalsById: nextPlanProposalsById,
            ...withSyncedMessages(state, state.messages, nextPlanProposalsById)
          };
        });
      } else if (action.kind === "rollback_patch") {
        await get().rollbackPatch();
      } else if (action.kind === "confirm_continue") {
        await get().validatePatch();
      } else if (action.kind === "approve_web_access") {
        const approvalRequestId = typeof action.payload?.approvalRequestId === "string" ? action.payload.approvalRequestId : null;
        set({ webResearchApprovedForRun: true, webResearchStatus: "searching" });
        if (approvalRequestId) {
          approvalCoordinator.resolve(approvalRequestId, "approved");
        }
      } else if (action.kind === "approve_command") {
        const approvalRequestId = typeof action.payload?.approvalRequestId === "string" ? action.payload.approvalRequestId : null;
        if (approvalRequestId) {
          approvalCoordinator.resolve(approvalRequestId, "approved");
        }
      } else if (action.kind === "open_file") {
        const payload = action.payload as Record<string, unknown> | undefined;
        const filePath = typeof payload?.filePath === "string" ? payload.filePath : null;
        if (filePath) {
          await useEditorStore.getState().openWorkspaceFile(filePath);
        }
      }
    } else {
      if (action.kind === "reject_patch") {
        await get().rejectPatch();
      } else if (action.kind === "reject_plan") {
        set((state) => {
          const planProposalId =
            typeof action.payload?.planProposalId === "string" ? action.payload.planProposalId : "";
          const nextPlanProposalsById = {
            ...state.planProposalsById,
            [planProposalId]: {
              ...(state.planProposalsById[planProposalId] ?? {}),
              state: "rejected"
            } as AgentPlanProposal
          };
          return {
            activeRun: state.activeRun
              ? (updateRunStatus(
                  appendRunEvent(state.activeRun as never, "chat.cancelled", "Plan abgelehnt"),
                  "cancelled"
                ) as never)
              : state.activeRun,
            planProposalsById: nextPlanProposalsById,
            ...withSyncedMessages(state, state.messages, nextPlanProposalsById)
          };
        });
      } else if (action.kind === "reject_web_access") {
        const approvalRequestId = typeof action.payload?.approvalRequestId === "string" ? action.payload.approvalRequestId : null;
        set({ webResearchApprovedForRun: false, webResearchStatus: "cancelled" });
        if (approvalRequestId) {
          approvalCoordinator.resolve(approvalRequestId, "rejected");
        }
      } else if (action.kind === "reject_command") {
        const approvalRequestId = typeof action.payload?.approvalRequestId === "string" ? action.payload.approvalRequestId : null;
        if (approvalRequestId) {
          approvalCoordinator.resolve(approvalRequestId, "rejected");
        }
      }
    }

    set((state) => markChatActionCompleted(state, messageId, actionId));
  } catch (err) {
    set((state) =>
      markChatActionFailed(
        state,
        messageId,
        actionId,
        err instanceof Error ? err.message : String(err)
      )
    );
  }
}

export async function submitAssistantAnswerAction(
  set: Setter,
  get: Getter,
  actionId: string,
  messageId: string,
  answer: AssistantAnswer,
  workspaceId: string
): Promise<void> {
  const msg = get().messages.find((m) => m.id === messageId);
  if (!msg || !msg.actions) return;
  const action = msg.actions.find((a) => a.id === actionId);
  if (!action || action.kind !== "answer_question") return;
  if (action.workspaceId !== workspaceId) {
    throw new Error("Die Rückfrage gehört nicht zum aktiven Workspace.");
  }
  if (action.state !== "pending") {
    return;
  }
  if (workflowScopeProcessingIds.has(actionId)) {
    return;
  }

  const requestId = typeof action.payload?.requestId === "string" ? (action.payload.requestId as string) : null;
  const question = action.payload?.question as import("@dbzs/shared").AssistantQuestion | undefined;
  const isWorkflowScope = question?.requiredField === "workflow_scope_decision";

  if (isWorkflowScope) {
    workflowScopeProcessingIds.add(actionId);
  }

  const selectedOptionId = (answer.optionIds?.[0] ?? null) as WorkflowScopeOptionId | null;
  const rawOptionId = answer.optionIds?.[0] ?? null;
  const decisionLabel =
    selectedOptionId === "continue_active_task" || selectedOptionId === "start_new_task"
      ? workflowScopeDecisionLabel(selectedOptionId)
      : answer.freeText?.trim() || "Antwort gesendet";
  const sendFollowupMessage = async (
    content: string,
    targetAgent: ModelTargetAgent,
    options: {
      workspaceRoot: string | null;
      stickyTaskType?: RuntimeTaskType;
      preferPlannerFirst?: boolean;
      forceContinueActiveWorkflow?: boolean;
      forceNewTask?: boolean;
      forceUseResidentModel?: boolean;
      acceptResourceRisk?: boolean;
      runtimeProfileOverride?: "hybrid" | "cpu_safe";
      toolProfile?: string | null;
      agentMode?: "agent";
      useAgentTurnLoop?: boolean;
      hasImageInput?: boolean;
      requiresVision?: boolean;
    }
  ) => {
    const { toolProfile, ...restOptions } = options;
    await get().sendMessage(
      content,
      useRuntimeStore.getState().status,
      null,
      undefined,
      null,
      targetAgent,
      {
        ...restOptions,
        ...(toolProfile ? { toolProfile: toolProfile as AgentToolProfile } : {})
      }
    );
  };

  set((state) =>
    completeAssistantAnswerAction({
      state,
      messageId,
      actionId,
      answer,
      workflowLabel: decisionLabel,
      isWorkflowScope
    })
  );

  try {
    const rehydrated = get().rehydratedPendingQuestion;
    if (
      await handleRehydratedAssistantAnswerFlow({
        rehydrated: rehydrated as RehydratedPendingQuestionState | null,
        question,
        answer,
        sendMessage: sendFollowupMessage
      })
    ) {
      set({ rehydratedPendingQuestion: null, activeRun: null });
      return;
    }

    const preflight = action.payload?.preflight as AssistantAnswerPreflight | undefined;
    if (preflight) {
      if (
        await handleReviewRemediationAssistantAnswerFlow({
          preflight,
          question,
          answer,
          sendMessage: sendFollowupMessage
        })
      ) {
        return;
      }

      if (answer.skipped) {
        await clearSkippedPreflightAssistantAnswer(preflight.workspaceRoot);
        return;
      }

      if (isWorkflowScope) {
        await handleWorkflowScopeAssistantAnswerFlow({
          preflight,
          selectedOptionId,
          sendMessage: sendFollowupMessage
        });
        return;
      }

      if (question?.requiredField === "resource_risk_decision") {
        await handleResourceRiskAssistantAnswerFlow({
          preflight,
          rawOptionId,
          lastRoutingSlotId: preflight.workspaceRoot ? get().lastRouting?.slotId : null,
          lastResolvedModelId: get().lastBrokerDecision?.resolvedModelId,
          sendMessage: sendFollowupMessage,
          appendSystemMessage: (content) =>
            set((state) => ({
              messages: [
                ...state.messages,
                {
                  id: `msg-${Date.now().toString(36)}-choose-model`,
                  role: "system",
                  content
                }
              ]
            }))
        });
        return;
      }

      await handleClarificationAssistantAnswerFlow({
        preflight,
        question,
        answer,
        sendMessage: sendFollowupMessage
      });
      return;
    }

    if (requestId) {
      questionCoordinator.resolve(requestId, answer);
    }
  } finally {
    if (isWorkflowScope) {
      workflowScopeProcessingIds.delete(actionId);
    }
  }
}
