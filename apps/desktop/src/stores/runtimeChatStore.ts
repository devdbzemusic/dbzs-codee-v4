import { create } from "zustand";
import type {
  AgentAction,
  AgentPatchApplyResult,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentPatchState,
  AgentPlanProposal,
  ApprovedPlanContext,
  PatchValidationResult,
  ModelTargetAgent,
  RuntimeChatMessage,
  RuntimeChatWorkspaceContext,
  RuntimeStatus,
  RuntimeChatToolCallRecord,
  WorkspaceFile,
  WorkspaceProjectFile,
  AgentWebSearchRequest,
  AgentWebSearchResult,
  AgentWebFetchRequest,
  AgentWebDocument,
  AgentCitation,
  AssistantQuestion,
  ReviewRemediationSelectionScope
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import type { RagRetrievalResponse, ReasoningTraceEvent } from "@dbzs/shared";
import { agentRunService } from "@/services/agentRunService";
import { backendClient } from "@/services/backendClient";
import { AgentOutputParseError, looksLikeAgentChangePayload, parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import {
  agentLabel,
  appendActivityStepDetail,
  buildResponseAnalysisMessage,
  createActivityRun,
  upsertActivityStep
} from "@/services/runtimeChatActivityHelpers";
import { buildWorkspaceContext, buildWorkspaceContextSystemMessage } from "@/services/runtimeChatContext";
import { contextOrchestrator } from "@/services/contextOrchestrator";
import {
  formatToolResultForContext,
  orchestrationClient,
  shouldRunWorkspaceListTool
} from "@/services/orchestrationClient";
import {
  buildSkillSystemMessages,
  loadEnabledSkillIds,
  saveEnabledSkillIds
} from "@/services/runtimeChatSkills";
import { setSkillEnabled } from "@/services/skillsLoader";
import {
  prepareSkillRuntime,
  validateAndFinishSkillRun
} from "@/services/skillRunCoordinator";
import type { ActiveSkillRuntimeContext } from "@/runtime/skill/skillContracts";
import { bootstrapRuntimeLayer } from "@/services/runtimeBootstrap";
import { parseAssistantPayload } from "@/services/assistantPayloadParser";
import {
  parseRuntimeToolCallsFromAssistant,
  RUNTIME_TOOLS_SYSTEM_HINT
} from "@/services/runtimeChatToolParser";
import { loadToolProfile, saveToolProfile, shouldUseAgentTurnLoop } from "@/services/runtimeChatAgentConfig";
import { classifyUserExecutionIntent } from "@/services/executionIntent";
import { gateExecutionFinalAnswer } from "@/services/executionAnswerValidation";
import {
  buildExecutionHandoff,
  mapExecutionIntentToHandoffIntent
} from "@/services/executionHandoff";
import { buildGoalCapsule, formatGoalCapsuleBlock } from "@/services/goalCapsule";
import { runAgentChatTurnLoop } from "@/services/runtimeChatAgentRunner";
import { parseContextMentions } from "@/services/runtimeChatContextMentions";
import { codeIndexService } from "@/services/codeIndexService";
import {
  buildRuntimeToolRequest,
  getRuntimeKernel,
  listRuntimeToolNames
} from "@/services/runtimeKernelService";
import { useRuntimeAgentStore } from "@/stores/runtimeAgentStore";
import { type RuntimeChatRun, type RuntimeChatEvent, type RuntimeChatEventType, type RuntimeChatRunStatus, type RuntimeChatToolCall, type RuntimeChatTurn } from "@dbzs/shared";
import { createChatRun, appendRunEvent, updateRunStatus, upsertRunTurn } from "@/services/runtimeChatRunHelpers";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import type { AgentTrajectory } from "@/runtime/observability/agentTrajectory";
import type { RuntimeChatActivityRun, RuntimeChatActivityStep, RuntimeChatRoutingInfo } from "@/types/runtimeChatActivity";
import type { ToolCapability } from "@/types/orchestration";

import {
  startChatSession,
  captureContextProof,
  captureAgentHandoff,
  completeAgentHandoff,
  captureToolExecutionStart,
  completeToolExecution,
  addMessageToTrace,
  finishChatSession
} from "@/services/runtimeChatObservability";
import {
  applySettingsTimeoutOverrides,
  residentSlotTimeoutOverrides,
  selectTimeoutProfile,
  TimeoutManager
} from "@/services/timeoutConfig";
import {
  classifyRuntimeChatError,
  extractRuntimeBackendErrorDetail,
  formatChatErrorForUser
} from "@/services/runtimeChatErrorClassifier";
import { approvalCoordinator } from "@/services/approvalCoordinator";
import { questionCoordinator } from "@/services/questionCoordinator";
import { clearPendingQuestion, readPendingQuestion } from "@/services/pendingQuestionPersistence";
import { buildRuntimeAgentActionRegistry } from "@/services/runtimeAgentActions";
import { attachFollowUpActionsToMessages } from "@/services/runtimeChatFollowUpActions";
import { brokerDecision, formatModelDisplayLabel, BindingModelError } from "@/services/modelSelectionBroker";
import {
  answeredFieldIds,
  appendContractFieldAnswer,
  formatActiveTaskContractBlock,
  pauseActiveTaskContract,
  readActiveTaskContract,
  upsertActiveTaskContract
} from "@/services/activeTaskContract";
import {
  workflowScopeDecisionLabel,
  type WorkflowScopeOptionId
} from "@/services/workflowContinuation";
import {
  clearPendingWorkflowScopeDecision,
  readPendingWorkflowScopeDecision,
  writePendingWorkflowScopeDecision
} from "@/services/pendingWorkflowScopeDecision";
import {
  ANSWER_RELEVANCE_FAILED_USER_MESSAGE,
  buildRelevanceRetrySystemPrompt,
  stripUnverifiedPathClaims,
  validatePlanningGrounding
} from "@/services/planningGrounding";
import {
  collectEvidenceFromActiveFile,
  collectEvidenceFromIndexedFiles,
  collectEvidenceFromToolResult,
  createVerifiedWorkspaceEvidence,
  verifiedPathsList
} from "@/services/verifiedWorkspaceEvidence";
import {
  finalizeRuntimeRun,
  isGenericRuntimeErrorSentinel
} from "@/services/runtimeRunFinalization";
import {
  createPhaseTimeoutController,
  outcomeForPhaseTimeout,
  type PhaseTimeoutKind
} from "@/services/runtimePhaseTimeouts";
import { validateResolvedRuntimeRoute } from "@/services/runtimeRouteValidator";
import { gateSlotForRequest } from "@/services/runtimeSlotExecutionState";
import { checkMissingInformation } from "@/services/missingInformationPolicy";
import {
  buildRepositoryReviewRequest,
  createElectronReviewWorkspaceIO,
  createHeuristicBatchAnalyzer,
  createHybridBatchAnalyzer,
  createLlmBatchAnalyzer,
  loadFindings,
  loadRemediationState,
  matchesCompleteRepositoryReviewIntent,
  RepositoryReviewOrchestrator,
  resolveRepositoryReviewScope,
  saveRemediationReport,
  saveRemediationState,
  REPOSITORY_REVIEW_WORKFLOW_ID,
  CODE_REVIEW_INTENT_LABEL,
  buildChatReviewSummaryLines,
  isSuccessfulReviewOutcome
} from "@/services/repositoryReview";
import {
  buildRemediationScopeQuestion,
  buildReviewRemediationCapsule,
  extractRemediationScope,
  formatReviewRemediationCapsule,
  REVIEW_REMEDIATION_WORKFLOW_ID
} from "@/services/reviewRemediation";
import {
  applyReviewRemediationSelection,
  applySelectedReviewFindingIds,
  finishReviewRemediationSelection,
  readReviewRemediationSelection
} from "@/services/reviewRemediationSelection";
import {
  REVIEW_REMEDIATION_PHASE_TOOL_LIMITS,
  resolveReviewRemediationPhaseToolNames,
  resolveReviewRemediationToolPhase
} from "@/services/reviewRemediationToolPolicy";
import { decideClarification } from "@/services/clarificationPolicy";
import { lookupProjectDecision, recordProjectDecision } from "@/services/decisionMemoryService";
import { canaryStageLabel, shouldStopForShadowMismatch } from "@/services/runtimeChatRollout";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { modelRouterService } from "@/services/modelRouterService";
import { classifyTaskForSend } from "@/services/runtimeChat/taskClassificationPhase";
import { resolveWorkflowContinuationForSend } from "@/services/runtimeChat/workflowContinuationPhase";
import { buildRuntimeChatAttachmentPrompt, collectAttachmentImageDataUrls } from "@/services/runtimeChatAttachments";
import { runReviewRemediationPhase } from "@/services/runtimeChat/reviewRemediationPhase";
import { mapBrokerAgentToShared, mapWorkflowAgentToShared } from "@/services/runtimeChat/agentMapping";
import { isClarificationFieldBlockedInMessages } from "@/services/runtimeChat/clarificationGuards";
import { createTraceEvent, ragClient, traceClient } from "@/services/ragClient";
import { embeddingService } from "@/services/embeddingService";
import { buildTokenBudget, ContextSpooler, estimateTokensCharHeuristic, type SpoolerLaneItem } from "@/runtime/context/contextSpooler";
import {
  resolveContextStage,
  shouldLoadRuntimeSignalPipeline,
  shouldLoadBroadRag,
  shouldRunRecursiveListFiles
} from "@/services/contextStagePolicy";
import {
  buildMinimalPlanningContext,
  computeFinalRequestTokenBudget,
  evaluateFinalBudgetGate,
  isFinalBudgetWithinLimit,
  outputReserveForTask,
  outputReserveForTurn
} from "@/services/finalRequestTokenBudget";
import {
  buildDroppedContextSources,
  dedupeDroppedSourceIds,
  allocateTokensRemoved
} from "@/services/droppedContextSources";
import {
  assertPreparedRequestReady,
  assertPromptBindingMatches,
  buildPromptBindingDiagnostics,
  estimatePromptTokens,
  freezePreparedRuntimeRequest,
  type PreparedRuntimeRequest,
  type PromptBindingDiagnostics,
  type ProviderRequestDiagnostics
} from "@/services/preparedRuntimeRequest";
import {
  createRuntimeBindingDecision,
  type RuntimeBindingDecision
} from "@/services/runtimeBinding";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import { isModelContentDelta } from "@/services/providerRuntimeEvents";
import {
  estimateProviderToolBudget,
  messagesAlreadyIncludeToolCatalog
} from "@/services/providerToolBudget";
import { resolveToolProtocolMode } from "@/runtime/agent/toolProtocolAdapter";
import { buildRequiredContextArtifactBlock } from "@/services/requiredContextArtifacts";
import {
  resolveWorkflowToolPhase,
  resolveWorkflowPhaseToolLimit,
  resolveWorkflowPhaseToolNames
} from "@/services/workflowPhaseToolPolicy";
import {
  registerIdleEvictionActiveRunGuard,
  startWorkModelIdleWatcher,
  touchWorkModelActivity
} from "@/services/lazyRuntimePolicy";
import { startRuntimeProcessSupervisor } from "@/services/runtimeProcessSupervisor";
import { RUNTIME_SLOT_DEFINITIONS, type ContextManifest, type RuntimeTaskType, type RuntimeSlotId, type ContextStage, type RuntimeRunOutcome } from "@dbzs/shared";
import { WORKFLOW_POLICY_VERSION } from "@/runtime/workflow/workflowPolicyRegistry";
import {
  extractReasoningSummary,
  hasPendingPlanApproval,
  mergeAssistantMessageState,
  mergeStreamingAssistantMessage,
  REASONING_SYSTEM_HINT
} from "@/stores/runtimeChatStoreMessageHelpers";
import {
  buildFileContext,
  buildWorkspaceLaneItems,
  createMessageId,
  formatChatError,
  isSignificantConversationTurn,
  loadToolsEnabled,
  normalizeImplementationContinuationRouting,
  normalizeWorkspaceContextPathCandidates,
  patchActivityRun,
  patchActivitySteps,
  PRESET_MESSAGES,
  refreshRuntimeStatus,
  requestAssistantResponse,
  sleep,
  STOPPED_RUNTIME_STATUS,
  syncRuntimeAgentActions,
  targetAgentForPreset,
  withTimeout
} from "@/stores/runtimeChatStoreRuntimeHelpers";
import {
  applyPatchAction,
  approvePatchAction,
  clearPatchStateAction,
  previewPatchAction,
  receivePatchProposalAction,
  rejectPatchAction,
  rollbackPatchAction,
  validatePatchAction
} from "@/stores/runtimeChatStorePatchActions";
import {
  continueAgentRunAfterPlanApprovalAction,
  handleChatActionAction,
  submitAssistantAnswerAction
} from "@/stores/runtimeChatStoreInteractionActions";
import {
  cancelSendAction,
  checkForPendingQuestionAction,
  consumeJobContextHintAction,
  handoffJobContextAction,
  loadToolCatalogAction,
  setToolsEnabledAction,
  toggleSkillAction
} from "@/stores/runtimeChatStoreSessionActions";
import { handleSendPreflightAction } from "@/stores/runtimeChatStoreSendPreflight";
import { resolveWorkflowPreludeAction } from "@/stores/runtimeChatStoreWorkflowPrelude";
import {
  buildRunTurnSnapshot as buildRunTurnSnapshotHelper,
  createTimeoutLifecycle,
  createActiveRunUpdater,
  createActivityController,
  ensureBackendReachable,
  finalizeOfflineBackendFailure
} from "@/stores/runtimeChatStoreExecutionHelpers";
import { initializeSendRun } from "@/stores/runtimeChatStoreExecutionHelpers";
import { runRoutingPhaseAction } from "@/stores/runtimeChatStoreRoutingPhase";
import { loadWorkspaceContextPhaseAction } from "@/stores/runtimeChatStoreContextPhase";
import { prepareOnDemandRuntimeAction } from "@/stores/runtimeChatStoreOnDemandPreparation";
import { executeOnDemandRuntimeAction } from "@/stores/runtimeChatStoreOnDemandExecution";
import {
  buildProviderRequestPrelude,
  handleProviderPreflightFailure,
  validateRequestExecutionBinding
} from "@/stores/runtimeChatStoreRequestPrelude";
import { createAgentTurnLoopCallbacks } from "@/stores/runtimeChatStoreAgentTurnCallbacks";
import { finalizeAgentTurnResult } from "@/stores/runtimeChatStoreAgentTurnFinalization";
import { createStreamingResponseCallbacks } from "@/stores/runtimeChatStoreStreamingCallbacks";
import { processStreamingResponseArtifacts } from "@/stores/runtimeChatStoreStreamingProcessing";
import { finalizeStreamingResponseArtifacts } from "@/stores/runtimeChatStoreStreamingFinalization";
import {
  appendGenericRunFailure,
  appendTimeoutFailure,
  buildTrimmedFailureMessages,
  buildSendCompletionSummary,
  finalizePhaseTimeoutRun,
  finalizeSendState,
  genericSendErrorMessage,
  markActivityFailure,
  shouldClearSendError
} from "@/stores/runtimeChatStoreSendFailure";

export {
  extractReasoningSummary,
  mergeAssistantMessageState,
  mergeStreamingAssistantMessage
} from "@/stores/runtimeChatStoreMessageHelpers";
export {
  normalizeImplementationContinuationRouting,
  normalizeWorkspaceContextPathCandidates
} from "@/stores/runtimeChatStoreRuntimeHelpers";

const MAX_CONTEXT_CHARS = 16_000;
const MAX_HISTORY_MESSAGES = 50;
const TOOLS_ENABLED_STORAGE_KEY = "dbzs-runtime-chat-tools-enabled";
const STREAMING_UI_THROTTLE_MS = 40;

const runsAbortControllers: Record<string, AbortController> = {};

export interface RuntimeChatSendOptions {
  includeWorkspaceContext?: boolean;
  workspaceRoot?: string | null;
  workspaceName?: string | null;
  workspaceFiles?: WorkspaceProjectFile[];
  attachments?: import("@dbzs/shared").RuntimeChatAttachment[];
  showAnalysisProtocol?: boolean;
  contextHint?: string | null;
  toolsEnabled?: boolean;
  enabledSkillIds?: string[];
  indexedFileCount?: number;
  toolProfile?: AgentToolProfile;
  useAgentTurnLoop?: boolean;
  agentMode?: "agent" | "auto";
  taskType?: string;
  /** Persist coding/planning intent across clarification resume. */
  stickyTaskType?: RuntimeTaskType;
  hasImageInput?: boolean;
  requiresVision?: boolean;
  preferPlannerFirst?: boolean;
  provider?: string | null;
  /** After workflow-scope A/B: continue the active contract without re-asking. */
  forceContinueActiveWorkflow?: boolean;
  /** After workflow-scope A/B: treat message as a brand-new task. */
  forceNewTask?: boolean;
  /** User accepted a high resource-risk start (smaller profile or proceed). */
  acceptResourceRisk?: boolean;
  /** Prefer a launch profile after resource-risk remediation. */
  runtimeProfileOverride?: "cpu_safe" | "hybrid" | "balanced" | "large_context" | "fast";
  /** Explicit user choice: continue with the currently resident slot model. */
  forceUseResidentModel?: boolean;
}
function resolveContextSlotId(
  taskType: string,
  slotId?: string | null
): "quality_cpu" | "fast_gpu" | "utility" | "vision_gpu" {
  if (slotId === "quality_cpu" || slotId === "fast_gpu" || slotId === "utility" || slotId === "vision_gpu") {
    return slotId;
  }

  if (["small_code_change", "large_code_change", "debugging", "review", "planning", "architecture", "test_analysis", "refactoring"].includes(taskType)) {
    return "fast_gpu";
  }

  if (["embedding", "reranking", "indexing"].includes(taskType)) {
    return "utility";
  }

  return "quality_cpu";
}

function isRuntimeNotRunningError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("runtime is not running") || message.includes("runtime ist nicht aktiv");
}

function isTransientChatTransportError(error: unknown): boolean {
  // P0 Phase 3: Use explicit error classification
  const classified = classifyRuntimeChatError(error);
  return classified.class === "transport";
}


export interface RuntimeChatState {
  messages: RuntimeChatMessage[];
  isSending: boolean;
  isStreaming: boolean;
  error: string | null;
  activeRun: RuntimeChatRun | null;
  rehydratedPendingQuestion: import("@/services/pendingQuestionPersistence").PendingQuestionState | null;
  historicalRuns: Record<string, RuntimeChatRun>;
  currentActivity: RuntimeChatActivityRun | null;
  lastActivity: RuntimeChatActivityRun | null;
  lastRouting: RuntimeChatRoutingInfo | null;
  lastBrokerDecision: import("@/services/modelSelectionBroker").ModelSelectionDecision | null;
  enabledSkillIds: string[];
  toolsEnabled: boolean;
  availableTools: ToolCapability[];
  desktopToolNames: string[];
  toolProfile: AgentToolProfile;
  lastTrajectory: AgentTrajectory | null;
  activePatchProposal: AgentPatchProposal | null;
  activePatchPreview: AgentPatchPreview | null;
  planProposalsById: Record<string, AgentPlanProposal>;
  patchState: AgentPatchState | null;
  patchError: string | null;
  patchApplyResult: AgentPatchApplyResult | null;
  patchValidationResult: PatchValidationResult | null;
  pendingJobContextHint: string | null;
  activeWebSearches: AgentWebSearchRequest[];
  activeWebFetches: AgentWebFetchRequest[];
  webResearchStatus: "idle" | "searching" | "fetching" | "succeeded" | "failed" | "cancelled" | "timed_out";
  webResearchError: string | null;
  webResearchCitations: AgentCitation[];
  webResearchApprovalMode: "off" | "ask_once_per_run" | "ask_every_request" | "allow_search_only" | "allow_search_and_fetch";
  webResearchApprovedForRun: boolean;
  patchProposalsById: Record<string, AgentPatchProposal>;
  patchPreviewsById: Record<string, AgentPatchPreview>;
  agentActionsById: Record<string, AgentAction>;
  setWebResearchApprovalMode: (mode: "off" | "ask_once_per_run" | "ask_every_request" | "allow_search_only" | "allow_search_and_fetch") => void;
  approveWebResearch: () => void;
  rejectWebResearch: () => void;
  setToolProfile: (profile: AgentToolProfile) => void;
  receivePatchProposal: (proposal: AgentPatchProposal) => Promise<void>;
  previewPatch: (proposal?: AgentPatchProposal | null) => Promise<AgentPatchPreview | null>;
  approvePatch: () => Promise<void>;
  rejectPatch: () => Promise<void>;
  applyPatch: () => Promise<void>;
  rollbackPatch: () => Promise<void>;
  validatePatch: () => Promise<PatchValidationResult | null>;
  clearPatchState: () => void;
  continueAgentRunAfterPlanApproval: (input: { runId: string; planProposalId: string; messageId: string }) => Promise<ApprovedPlanContext>;
  handleChatAction: (actionId: string, messageId: string, approve: boolean, workspaceId: string) => Promise<void>;
  submitAssistantAnswer: (
    actionId: string,
    messageId: string,
    answer: import("@dbzs/shared").AssistantAnswer,
    workspaceId: string
  ) => Promise<void>;
  checkForPendingQuestion: (workspaceRoot: string) => Promise<void>;
  sendMessage: (
    content: string,
    runtimeStatus: RuntimeStatus | null,
    activeFile: WorkspaceFile | null,
    workspaceContext?: RuntimeChatWorkspaceContext | null,
    contextHint?: string | null,
    targetAgent?: ModelTargetAgent,
    sendOptions?: RuntimeChatSendOptions
  ) => Promise<boolean>;
  sendPresetPrompt: (
    preset: "plan" | "refactor" | "review" | "summarize" | "next_steps",
    runtimeStatus: RuntimeStatus | null,
    activeFile: WorkspaceFile | null,
    workspaceContext?: RuntimeChatWorkspaceContext | null,
    contextHint?: string | null,
    sendOptions?: RuntimeChatSendOptions
  ) => Promise<boolean>;
  compactConversation: () => void;
  clear: () => void;
  clearActivityHistory: () => void;
  cancelSend: (runId?: string) => void;
  toggleSkill: (skillId: string) => void;
  setToolsEnabled: (enabled: boolean) => void;
  loadToolCatalog: () => Promise<void>;
  handoffJobContext: (input: {
    jobId: string;
    title: string;
    workspaceRoot: string;
    description?: string | null;
    artifactSummary?: string | null;
  }) => void;
  consumeJobContextHint: () => string | null;
}

function looksLikeAgentChangeJson(content: string): boolean {
  return looksLikeAgentChangePayload(content);
}
async function applyPlanningRelevanceGate(input: {
  answer: string;
  confirmedGoal: string;
  acceptanceCriteria: string[];
  verifiedPaths: string[];
  toolResultCount: number;
  runId: string;
  userQuestion: string;
  contractBlock: string;
  routing: { modelId: string | null; providerId?: string | null };
  slotId: RuntimeSlotId | null | undefined;
  decisionId: string;
  signal: AbortSignal;
  traceEvents: ReasoningTraceEvent[];
}): Promise<{ content: string; outcome?: RuntimeRunOutcome }> {
  let grounding = validatePlanningGrounding({
    answer: input.answer,
    confirmedGoal: input.confirmedGoal,
    acceptanceCriteria: input.acceptanceCriteria,
    verifiedPaths: input.verifiedPaths,
    toolResultCount: input.toolResultCount
  });

  if (grounding.unrelatedTopicDetected) {
    input.traceEvents.push(
      createTraceEvent(
        input.runId,
        "context_gap",
        "answer_relevance_retry_started",
        "unrelated_project_topics",
        "running"
      )
    );
    try {
      const retryResponse = await requestAssistantResponse(
        {
          messages: [
            {
              id: `msg-${Date.now().toString(36)}-retry-sys`,
              role: "system",
              content: buildRelevanceRetrySystemPrompt(input.contractBlock)
            },
            {
              id: `msg-${Date.now().toString(36)}-retry-user`,
              role: "user",
              content: input.userQuestion
            }
          ],
          model_id: input.routing.modelId,
          slot_id: input.slotId ?? null,
          decision_id: input.decisionId,
          run_id: input.runId,
          max_tokens: 800,
          temperature: 0.2
        },
        () => undefined,
        input.signal
      );
      grounding = validatePlanningGrounding({
        answer: retryResponse.message.content,
        confirmedGoal: input.confirmedGoal,
        acceptanceCriteria: input.acceptanceCriteria,
        verifiedPaths: input.verifiedPaths,
        toolResultCount: input.toolResultCount
      });
      if (grounding.unrelatedTopicDetected) {
        input.traceEvents.push(
          createTraceEvent(
            input.runId,
            "context_gap",
            "answer_relevance_retry_failed",
            "unrelated_project_topics",
            "failed"
          )
        );
        return { content: ANSWER_RELEVANCE_FAILED_USER_MESSAGE, outcome: "answer_relevance_failed" };
      }
      input.traceEvents.push(
        createTraceEvent(
          input.runId,
          "context_gap",
          "answer_relevance_retry_succeeded",
          "relevant_retry_answer",
          "completed"
        )
      );
      const content = grounding.citedFilesVerified
        ? retryResponse.message.content
        : stripUnverifiedPathClaims(retryResponse.message.content, grounding.unverifiedPathCitations);
      return { content };
    } catch (retryError) {
      input.traceEvents.push(
        createTraceEvent(
          input.runId,
          "context_gap",
          "answer_relevance_retry_failed",
          retryError instanceof Error ? retryError.message : "retry_error",
          "failed"
        )
      );
      return { content: ANSWER_RELEVANCE_FAILED_USER_MESSAGE, outcome: "answer_relevance_failed" };
    }
  }

  if (!grounding.citedFilesVerified) {
    input.traceEvents.push(
      createTraceEvent(
        input.runId,
        "context_gap",
        "unverified_paths_stripped",
        grounding.unverifiedPathCitations.join(", "),
        "failed"
      )
    );
    return {
      content: stripUnverifiedPathClaims(input.answer, grounding.unverifiedPathCitations)
    };
  }

  return { content: input.answer };
}

export const useRuntimeChatStore = create<RuntimeChatState>((set, get) => ({
  messages: [],
  isSending: false,
  isStreaming: false,
  error: null,
  activeRun: null,
  rehydratedPendingQuestion: null,
  historicalRuns: {},
  currentActivity: null,
  lastActivity: null,
  lastRouting: null,
  lastBrokerDecision: null,
  enabledSkillIds: loadEnabledSkillIds(),
  toolsEnabled: loadToolsEnabled(),
  availableTools: [],
  desktopToolNames: [],
  toolProfile: loadToolProfile(),
  lastTrajectory: null,
  activePatchProposal: null,
  activePatchPreview: null,
  planProposalsById: {},
  patchState: null,
  patchError: null,
  patchApplyResult: null,
  patchValidationResult: null,
  pendingJobContextHint: null,
  activeWebSearches: [],
  activeWebFetches: [],
  webResearchStatus: "idle",
  webResearchError: null,
  webResearchCitations: [],
  webResearchApprovalMode: "ask_once_per_run",
  webResearchApprovedForRun: false,
  patchProposalsById: {},
  patchPreviewsById: {},
  agentActionsById: {},
  setWebResearchApprovalMode: (mode) => {
    set({ webResearchApprovalMode: mode });
  },
  approveWebResearch: () => {
    set({ webResearchApprovedForRun: true });
  },
  rejectWebResearch: () => {
    set({ webResearchApprovedForRun: false, webResearchStatus: "cancelled" });
  },
  setToolProfile: (profile) => {
    saveToolProfile(profile);
    set({ toolProfile: profile });
  },

  receivePatchProposal: async (proposal) => {
    await receivePatchProposalAction(set, get, proposal);
  },

  previewPatch: async (proposal = get().activePatchProposal) => {
    return previewPatchAction(set, get, proposal);
  },

  approvePatch: async () => {
    await approvePatchAction(set, get);
  },

  rejectPatch: async () => {
    await rejectPatchAction(set, get);
  },

  applyPatch: async () => {
    await applyPatchAction(set, get);
  },

  rollbackPatch: async (restorePointId?: string) => {
    await rollbackPatchAction(set, get, restorePointId);
  },

  validatePatch: async () => {
    return validatePatchAction(set, get);
  },

  clearPatchState: () => clearPatchStateAction(set),

  continueAgentRunAfterPlanApproval: async ({ runId, planProposalId, messageId }) =>
    continueAgentRunAfterPlanApprovalAction(set, get, { runId, planProposalId, messageId }),

  handleChatAction: async (actionId, messageId, approve, workspaceId) =>
    handleChatActionAction(set, get, actionId, messageId, approve, workspaceId),

  submitAssistantAnswer: async (actionId, messageId, answer, workspaceId) =>
    submitAssistantAnswerAction(set, get, actionId, messageId, answer, workspaceId),

  checkForPendingQuestion: async (workspaceRoot) => checkForPendingQuestionAction(set, workspaceRoot),

  handoffJobContext: (input) => {
    handoffJobContextAction(set, input);
  },

  consumeJobContextHint: () => consumeJobContextHintAction(set, get),

  loadToolCatalog: async () => {
    await loadToolCatalogAction(set);
  },

  toggleSkill: (skillId) => {
    toggleSkillAction(set, get, skillId);
  },

  setToolsEnabled: (enabled) => {
    setToolsEnabledAction(set, enabled, TOOLS_ENABLED_STORAGE_KEY);
  },

  cancelSend: (runId?: string) => {
    cancelSendAction(set, get, runId, runsAbortControllers);
  },

  sendMessage: async (
    content,
    runtimeStatus,
    activeFile,
    workspaceContext,
    contextHint,
    targetAgent = "runtime_chat",
    sendOptions
  ) => {
    if (get().isSending) {
      return false;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return false;
    }
    const executionIntentForTurn = classifyUserExecutionIntent(trimmedContent);
    const contextMentionsForTurn = parseContextMentions(trimmedContent);
    const contextMentionPathsForTurn = contextMentionsForTurn.map((mention) => mention.path);

    const workspaceRootEarly =
      sendOptions?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath ?? null;
    const preflight = await handleSendPreflightAction(set, get, content, sendOptions);
    if (preflight.handled) {
      return preflight.result;
    }

    const taskClassification = classifyTaskForSend({
      trimmedContent,
      targetAgent,
      activeFileHasContent: !!activeFile?.content,
      contextHint,
      sendOptions,
      enabledSkillIds: get().enabledSkillIds,
      jobContextHint: get().consumeJobContextHint(),
      storeToolsEnabled: get().toolsEnabled
    });
    let skillIds = taskClassification.skillIds;
    let effectiveAgent = taskClassification.effectiveAgent;
    let activeSkillContext: ActiveSkillRuntimeContext | null = null;
    const toolsEnabled = taskClassification.toolsEnabled;
    const resolvedContextHint = taskClassification.resolvedContextHint;
    const isAutoTrivial = taskClassification.isAutoTrivial;
    const includeWorkspaceContext = taskClassification.includeWorkspaceContext;
    let intentClassification = taskClassification.intentClassification;
    let taskType: RuntimeTaskType = taskClassification.taskType;

    const workflowPrelude = await resolveWorkflowPreludeAction({
      set,
      get,
      trimmedContent,
      targetAgent,
      sendOptions,
      isAutoTrivial,
      taskType,
      effectiveAgent,
      intentClassification,
      activeFileHasContent: !!activeFile?.content,
      workspaceRootEarly
    });
    if (workflowPrelude.handled) {
      return workflowPrelude.result;
    }

    taskType = workflowPrelude.taskType;
    effectiveAgent = workflowPrelude.effectiveAgent;
    intentClassification = workflowPrelude.intentClassification;
    let activeTaskContract = workflowPrelude.activeTaskContract;
    const executionIntent = workflowPrelude.executionIntent;
    const workflowAssignment = workflowPrelude.workflowAssignment;
    const workspaceRootForWorkflow = workflowPrelude.workspaceRootForWorkflow;
    const continuation = workflowPrelude.continuation;
    const preferPlannerFirst = workflowPrelude.preferPlannerFirst;

    const requestCapabilities = {
      hasImageInput: sendOptions?.hasImageInput === true,
      hasAudioInput: false,
      requiresVision: sendOptions?.requiresVision === true
    };
    const runtimeFlags = useSettingsStore.getState().settings;
    const contextStage: ContextStage = resolveContextStage({
      taskType,
      isInterviewOnly: false,
      hasApprovedPlan:
        activeTaskContract?.currentPhase === "awaiting_plan_approval" ||
        activeTaskContract?.currentPhase === "executing",
      isCodingExecution:
        activeTaskContract?.currentPhase === "implementation" ||
        activeTaskContract?.currentPhase === "executing"
    });

    activeSkillContext = await prepareSkillRuntime({
      userMessage: trimmedContent,
      executionIntent: executionIntentForTurn,
      workspaceRoot: sendOptions?.workspaceRoot ?? undefined,
      activeFile: activeFile?.path,
      activeTaskType: taskType,
      targetAgent: mapWorkflowAgentToShared(workflowAssignment.effectiveAgent),
      enabledSkillIds: skillIds,
      profile: sendOptions?.toolProfile ?? get().toolProfile ?? loadToolProfile(),
      toolsEnabled,
      runtimeRunId: `skill-chat-${Date.now().toString(36)}`
    });
    if (activeSkillContext) {
      skillIds = activeSkillContext.capsules.map((capsule) => capsule.skillId);
      effectiveAgent = activeSkillContext.run.selectedAgent;
    } else {
      skillIds = [];
      effectiveAgent = targetAgent;
    }

    const {
      startedAt,
      activity: initialActivity,
      sessionId,
      initialRun,
      safeTraceEvents,
      runAbortController,
      userMessage,
      nextMessages
    } = initializeSendRun({
      set,
      get,
      trimmedContent,
      attachments: sendOptions?.attachments,
      effectiveAgent,
      taskType,
      includeWorkspaceContext,
      workspaceRoot: sendOptions?.workspaceRoot ?? null,
      activeFile,
      agentMode: sendOptions?.agentMode ?? "auto"
    });
    const attachmentPrompt = buildRuntimeChatAttachmentPrompt(sendOptions?.attachments ?? []);
    const requestUserContent = attachmentPrompt
      ? `${trimmedContent}\n\n${attachmentPrompt}`
      : trimmedContent;
    const requestUserImages = collectAttachmentImageDataUrls(sendOptions?.attachments ?? []);
    let activity = initialActivity;
    let ragResult: RagRetrievalResponse | null = null;
    runsAbortControllers[initialRun.id] = runAbortController;
    const {
      timeoutManager,
      totalTimeout,
      updateActiveRun,
      resetFirstTokenTimeout,
      startFirstTokenTimeout,
      onStreamTokenActivity
    } = createTimeoutLifecycle({
      set,
      get,
      taskType,
      activeFile,
      workspaceRootPathLength: workspaceContext?.rootPath?.length ?? 0,
      runAbortController
    });

    const syncActiveRunBindingPatch = (patch: Partial<RuntimeChatRun>) => {
      updateActiveRun((run) => ({
        ...run,
        ...patch
      }));
    };

    const buildRunTurnSnapshot = (input: {
      turnNumber: number;
      prompt: string;
      response?: string | null;
      startedAt?: string;
      finishedAt?: string;
    }): RuntimeChatTurn => buildRunTurnSnapshotHelper(initialRun.id, get, input);

    const activityController = createActivityController(set, activity);
    const updateActivity = activityController.updateActivity;
    const beginStep = activityController.beginStep;
    const finishStep = activityController.finishStep;
    const failStep = activityController.failStep;
    const appendStepDetail = activityController.appendStepDetail;

    beginStep("runtime-check", "Runtime-Status pruefen");
    updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "preparing"), "runtime.check.started", "Runtime-Status pruefen"));

    // Lazy Runtime: Backend muss erreichbar sein; Arbeitsmodelle starten erst nach Routing+Budget.
    const runWorkspaceRoot = sendOptions?.workspaceRoot ?? null;
    const { backendReachable, currentStatus } = await ensureBackendReachable(runtimeStatus);
    if (!backendReachable) {
      failStep("runtime-check", "Runtime-Status pruefen", "Backend nicht erreichbar.");
      activityController.completeAsOfflineFailure();
      finalizeOfflineBackendFailure(set, get, activityController.getActivity(), updateActiveRun);
      return false;
    }

    const runtimeCheckDetail =
      currentStatus.state === "running"
        ? `Backend online · Residenter Slotstatus: ${currentStatus.model_name ?? currentStatus.model_id ?? "Slot aktiv"}`
        : "Backend online · Arbeitsmodell: nicht geladen";
    finishStep("runtime-check", "Runtime-Status pruefen", runtimeCheckDetail);
    updateActiveRun((r) => appendRunEvent(r, "runtime.check.completed", runtimeCheckDetail));

    beginStep("model-route", "Modell-Routing");
    updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "routing"), "routing.started", "Modell-Routing"));

    let routing: RuntimeChatRoutingInfo;
    let brokerDecisionFull: import("@/services/modelSelectionBroker").ModelSelectionDecision | undefined;
    let bindingDecision: RuntimeBindingDecision | null = null;
    let shadowMatch: boolean | null = null;
    // Resolved model's real context window (from the running slot's resource
    // plan) — feeds the Context Spooler's token budget. Falls back to 4096
    // if no slot status is available yet.
    let resolvedContextWindowTokens: number | null = null;
    const routingPhase = await runRoutingPhaseAction({
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
      activeTaskContract,
      workflowAssignment,
      runWorkspaceRoot,
      initialRunId: initialRun.id,
      safeTraceEvents,
      callbacks: {
        failStep,
        finishStep,
        appendStepDetail,
        updateActiveRun,
        updateActivity,
        getActivity: () => activity
      },
      resetFirstTokenTimeout,
      clearTotalTimeout: () => clearTimeout(totalTimeout)
    });
    if (routingPhase.handled) {
      return routingPhase.result;
    }
    routing = routingPhase.routing!;
    brokerDecisionFull = routingPhase.brokerDecisionFull ?? undefined;
    bindingDecision = routingPhase.bindingDecision;
    activeTaskContract = routingPhase.activeTaskContract;
    let contextSlotId = routingPhase.contextSlotId as "quality_cpu" | "fast_gpu" | "utility" | "vision_gpu";
    const displayModelLabel = routingPhase.displayModelLabel!;
    shadowMatch = routingPhase.shadowMatch;

    // Repository Review Orchestrator: multi-step review instead of single chat turn.
    const reviewTargetAnswer =
      activeTaskContract?.answeredFields?.review_target?.answer ??
      activeTaskContract?.answeredFields?.["review_target"]?.answer ??
      null;
    const repositoryReviewScope =
      taskType === "review"
        ? resolveRepositoryReviewScope(trimmedContent, reviewTargetAnswer) ??
          (matchesCompleteRepositoryReviewIntent(trimmedContent) ? "full_repository" : null)
        : null;

    if (
      taskType === "review" &&
      repositoryReviewScope &&
      runWorkspaceRoot &&
      brokerDecisionFull?.targetAgent === "reviewer"
    ) {
      beginStep("repo-review", "Repository Review Orchestrator");
      const workspaceId = workspaceScopeId(runWorkspaceRoot);
      const reviewRequest = buildRepositoryReviewRequest({
        workspaceId,
        workspaceRoot: runWorkspaceRoot,
        scope: repositoryReviewScope,
        selectedPaths:
          repositoryReviewScope !== "full_repository" && activeFile?.path
            ? [activeFile.path]
            : undefined,
        includeBuildChecks: true
      });

      updateActiveRun((r) =>
        appendRunEvent(
          {
            ...r,
            workflowLabel: REPOSITORY_REVIEW_WORKFLOW_ID,
            phaseLabel: "review",
            targetAgentLabel: "reviewer",
            repositoryReview: {
              reviewId: "pending",
              scope: repositoryReviewScope,
              status: "planned",
              intentLabel: CODE_REVIEW_INTENT_LABEL,
              workflowId: REPOSITORY_REVIEW_WORKFLOW_ID,
              totalBatches: 0,
              completedBatches: 0,
              checks: []
            }
          },
          "context.started",
          `Repository Review gestartet · Scope ${repositoryReviewScope} · Intent ${CODE_REVIEW_INTENT_LABEL}`
        )
      );

      const orchestrator = new RepositoryReviewOrchestrator({
        io: createElectronReviewWorkspaceIO(),
        runtimeContextLimit: resolvedContextWindowTokens ?? 8192,
        executionAllowed: toolsEnabled === true,
        approveInstall: false,
        batchAnalyzer: createHybridBatchAnalyzer({
          heuristic: createHeuristicBatchAnalyzer(),
          llm: createLlmBatchAnalyzer(async ({ system, user }) => {
            const response = await agentRunService.sendChat(
              {
                messages: [
                  { id: createMessageId("review-sys"), role: "system", content: system },
                  { id: createMessageId("review-user"), role: "user", content: user }
                ],
                model_id: routing.modelId ?? brokerDecisionFull?.resolvedModelId ?? null,
                slot_id: (contextSlotId as RuntimeSlotId | null) ?? null,
                decision_id: brokerDecisionFull?.decisionId ?? null,
                run_id: initialRun.id,
                routing_reason: "repository_review_batch",
                max_tokens: 1024,
                temperature: 0.1
              },
              runAbortController.signal
            );
            return response.message?.content ?? "";
          })
        }),
        onProgress: (progress) => {
          updateActiveRun((r) => ({
            ...appendRunEvent(
              r,
              "context.completed",
              `Review ${progress.completedBatches}/${progress.totalBatches}` +
                (progress.currentBatchTitle ? ` · ${progress.currentBatchTitle}` : ""),
              { repositoryReview: progress }
            ),
            repositoryReview: progress
          }));
        }
      });

      const reviewResult = await orchestrator.start(reviewRequest);
      const durationSeconds = Math.max(
        0,
        Math.round((Date.now() - new Date(initialRun.startedAt).getTime()) / 1000)
      );
      const summaryLines = buildChatReviewSummaryLines(reviewResult, durationSeconds);
      const success = isSuccessfulReviewOutcome(reviewResult.outcome);

      if (success) {
        finishStep("repo-review", "Repository Review Orchestrator", summaryLines.join(" · "));
      } else {
        failStep("repo-review", "Repository Review Orchestrator", summaryLines.join(" · "));
      }

      const assistantId = createMessageId("assistant");
      const assistantContent = summaryLines.join("\n");
      const resultMessages: RuntimeChatMessage[] = [
        ...nextMessages,
        {
          id: assistantId,
          role: "assistant",
          content: assistantContent,
          visibleContent: assistantContent
        }
      ];

      updateActiveRun((r) =>
        appendRunEvent(
          {
            ...updateRunStatus(r, success ? "completed" : "failed"),
            outcome: success ? "success" : "generation_failed",
            repositoryReview: reviewResult.progress,
            assistantMessageId: assistantId
          },
          success ? "chat.completed" : "chat.failed",
          assistantContent
        )
      );

      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary: assistantContent.slice(0, 240)
        })
      );

      const finishedRun = get().activeRun;
      clearTimeout(totalTimeout);
      resetFirstTokenTimeout();
      set((state) => ({
        messages: resultMessages,
        error: success ? null : assistantContent,
        isSending: false,
        lastActivity: activity,
        currentActivity: null,
        activeRun: null,
        historicalRuns: finishedRun
          ? { ...state.historicalRuns, [finishedRun.id]: finishedRun }
          : state.historicalRuns
      }));
      return success;
    }

    // Read-only slot probe for context-window estimate — never starts a work model here.
    const slotValidationEnabled = runtimeFlags.runtimeChatEnableSlotValidation ?? true;
    if (slotValidationEnabled && contextSlotId && routing.modelId) {
      beginStep("slot-validation", "Slot-Status lesen");
      try {
        const slotId = contextSlotId as RuntimeSlotId;
        const currentSlotStatus = await runtimeSlotManager.getSlotStatus(slotId);
        if (currentSlotStatus?.context_size) {
          resolvedContextWindowTokens = currentSlotStatus.context_size;
        }
        // If the slot has no context_size yet (common before first start), use resource-plan preview
        // so the budget gate does not assume 4096 and falsely trigger overflow fallback.
        if (!resolvedContextWindowTokens && routing.modelId) {
          const plan = await runtimeSlotManager.previewResourcePlan(
            slotId,
            routing.modelId,
            sendOptions?.runtimeProfileOverride ?? "balanced"
          );
          const planCtx = Number((plan as { context_size?: number } | null)?.context_size ?? 0);
          if (Number.isFinite(planCtx) && planCtx > 0) {
            resolvedContextWindowTokens = planCtx;
          }
        }
        finishStep(
          "slot-validation",
          "Slot-Status lesen",
          `Slot ${contextSlotId}: ${currentSlotStatus?.state ?? "unknown"} · Kontextfenster ${resolvedContextWindowTokens ?? 4096} (Start erst nach Budget)`
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Slot-Status nicht lesbar";
        finishStep("slot-validation", "Slot-Status lesen", errMsg);
      }
    }

    const orchestrationMessages: string[] = [];
    const memorySnippets: string[] = [];
    const verifiedEvidence = createVerifiedWorkspaceEvidence();
    collectEvidenceFromActiveFile(verifiedEvidence, activeFile?.path, sendOptions?.workspaceRoot);
    try {
      const indexed = codeIndexService.getIndexedFiles();
      collectEvidenceFromIndexedFiles(verifiedEvidence, indexed, sendOptions?.workspaceRoot);
    } catch {
      // index optional
    }

    if (toolsEnabled && sendOptions?.workspaceRoot && !isAutoTrivial) {
      beginStep("runtime-context", "Runtime-Kontext");
      updateActiveRun((r) =>
        appendRunEvent(r, "context.started", `Runtime-Kontext vorbereiten (Stufe ${contextStage})`)
      );

      if (!shouldLoadRuntimeSignalPipeline(contextStage)) {
        finishStep(
          "runtime-context",
          "Runtime-Kontext",
          contextStage === 1
            ? "Stufe 1: Planungsbasis ohne Struktur-Signale"
            : `Stufe ${contextStage}: Signal-Pipeline übersprungen`
        );
        updateActiveRun((r) =>
          appendRunEvent(
            r,
            "context.completed",
            contextStage === 1
              ? "Stufe 1 aktiv — keine pauschalen Workspace-Signale"
              : `Stufe ${contextStage} — Signal-Pipeline übersprungen`
          )
        );
      } else {
      try {
        await withTimeout(
          bootstrapRuntimeLayer(),
          timeoutManager.getBootstrap(),
          "Runtime-Bootstrap",
          runAbortController.signal
        );

        const kernel = getRuntimeKernel();
        const promptContext = await withTimeout(
          kernel.context.buildPromptContext({
            userGoal: trimmedContent,
            maxTokens: contextStage >= 3 ? 5000 : 2000
          }),
          timeoutManager.getContext(),
          "Prompt-Kontext aufbauen",
          runAbortController.signal
        );
        const blocks = kernel.promptContext.build(promptContext);
        orchestrationMessages.push(blocks.contextBlock);
        finishStep(
          "runtime-context",
          "Runtime-Kontext",
          `${promptContext.signals.length} Signale gerankt (Stufe ${contextStage})`
        );
        updateActiveRun((r) => appendRunEvent(r, "context.completed", `${promptContext.signals.length} Signale in Kontext geladen`));
      } catch (error) {
        finishStep(
          "runtime-context",
          "Runtime-Kontext",
          error instanceof Error ? error.message : "Kontext-Pipeline uebersprungen"
        );
        updateActiveRun((r) => appendRunEvent(r, "context.completed", "Kontext uebersprungen"));
      }
      }

      beginStep("orchestration", "Tools & Orchestrierung");
      try {
        const prepared = await withTimeout(
          orchestrationClient.prepareContext({
            user_request: trimmedContent,
            workspace: {
              root_path: sendOptions.workspaceRoot,
              project_name: sendOptions.workspaceName ?? null,
              active_file_path: activeFile?.path ?? null,
              indexed_file_count: sendOptions.indexedFileCount ?? 0
            }
          }),
          timeoutManager.getContext(),
          "Orchestrierung",
          runAbortController.signal
        );

        if (contextStage >= 1) {
          orchestrationMessages.push(
            [
              "[Orchestrierung]",
              `Intent: ${prepared.intent_summary}`,
              "Schritte:",
              ...prepared.decomposition_steps.map((step) => `- ${step}`),
              "Kontext:",
              ...prepared.context_hints.slice(0, contextStage === 1 ? 3 : prepared.context_hints.length).map((hint) => `- ${hint}`)
            ].join("\n")
          );
        }

        appendStepDetail("orchestration", `Intent: ${prepared.intent_summary.slice(0, 120)}`);

        if (shouldRunRecursiveListFiles(contextStage) && shouldRunWorkspaceListTool(trimmedContent)) {
          appendStepDetail("orchestration", "Tool: list_files (Desktop) …");
          try {
            const desktopList = await useRuntimeAgentStore.getState().runTool(
              buildRuntimeToolRequest("list_files", sendOptions.workspaceRoot, {
                path: "",
                recursive: true
              })
            );
            collectEvidenceFromToolResult(
              verifiedEvidence,
              "list_files",
              desktopList.output,
              sendOptions.workspaceRoot
            );
            orchestrationMessages.push(
              `[Desktop Tool list_files]\n${JSON.stringify(desktopList.output, null, 2).slice(0, 4000)}`
            );
            appendStepDetail(
              "orchestration",
              desktopList.status === "ok" ? "✓ Desktop-Verzeichnis geladen" : "✗ Desktop-List fehlgeschlagen"
            );
          } catch {
            appendStepDetail("orchestration", "Tool: filesystem.list_dir (Backend) …");
            const listResult = await orchestrationClient.executeTool({
              tool_id: "filesystem.list_dir",
              scope: "read",
              workspace_root: sendOptions.workspaceRoot,
              params: { path: "." }
            });
            collectEvidenceFromToolResult(
              verifiedEvidence,
              "filesystem.list_dir",
              listResult,
              sendOptions.workspaceRoot
            );
            orchestrationMessages.push(formatToolResultForContext(listResult));
            appendStepDetail(
              "orchestration",
              listResult.status === "ok" ? "✓ Verzeichnis geladen" : `✗ ${listResult.message}`
            );
          }
        }

        finishStep("orchestration", "Tools & Orchestrierung", `${prepared.work_items.length} Arbeitspakete`);
      } catch (error) {
        finishStep(
          "orchestration",
          "Tools & Orchestrierung",
          error instanceof Error ? error.message : "Orchestrierung uebersprungen"
        );
      }
    }

    let resolvedWorkspaceContext = workspaceContext ?? null;
    const workspaceContextPhase = await loadWorkspaceContextPhaseAction({
      set,
      get,
      sendOptions,
      workspaceContext,
      activeFile,
      isAutoTrivial,
      sessionId,
      trimmedContent,
      contextMentionPaths: contextMentionPathsForTurn,
      skillIds,
      timeoutMs: timeoutManager.getContext(),
      signal: runAbortController.signal,
      callbacks: {
        beginStep,
        finishStep,
        failStep,
        appendStepDetail,
        updateActiveRun,
        updateActivity,
        getActivity: () => activity
      },
      resetFirstTokenTimeout,
      clearTotalTimeout: () => clearTimeout(totalTimeout)
    });
    if (workspaceContextPhase.handled) {
      return workspaceContextPhase.result;
    }
    resolvedWorkspaceContext = workspaceContextPhase.resolvedWorkspaceContext;

    try {
      const workspaceMessage = buildWorkspaceContextSystemMessage(resolvedWorkspaceContext);

      // Mandatory lane: system prompt / agent role / safety rules / current
      // task / tool contracts / approval rules — never trimmed by the spooler.
      const mandatoryContents: string[] = [];

      const goalCapsule = buildGoalCapsule({
        runId: initialRun.id,
        workspaceRoot: sendOptions?.workspaceRoot ?? "",
        originalUserMessage: trimmedContent,
        targetAgent: effectiveAgent,
        phase: activeTaskContract?.currentPhase,
        activeFile: activeFile?.path,
        acceptanceCriteria: activeTaskContract?.acceptanceCriteria,
        executionIntent: executionIntentForTurn
      });
      mandatoryContents.push(formatGoalCapsuleBlock(goalCapsule));
      // Current user instruction is P0 non-droppable (never only in recent_conversation).
      mandatoryContents.push(`[CURRENT USER MESSAGE — P0_NON_DROPPABLE]\n${trimmedContent}`);

      if (activeTaskContract) {
        mandatoryContents.push(
          formatActiveTaskContractBlock(activeTaskContract, trimmedContent)
        );
        if (activeTaskContract.reviewRemediation) {
          mandatoryContents.push(
            formatReviewRemediationCapsule(activeTaskContract.reviewRemediation)
          );
        }
      }

      mandatoryContents.push(...buildSkillSystemMessages(skillIds));

      if (toolsEnabled) {
        mandatoryContents.push(RUNTIME_TOOLS_SYSTEM_HINT);
      }

      if (resolvedContextHint && resolvedContextHint.trim().length > 0) {
        mandatoryContents.push(resolvedContextHint.trim());
      }

      for (const block of orchestrationMessages) {
        mandatoryContents.push(block);
      }

      // Active Task lane: current/active file & workspace state.
      const activeTaskContents: string[] = workspaceMessage ? [workspaceMessage] : [];
      const activeTaskLaneItems = buildWorkspaceLaneItems(resolvedWorkspaceContext, workspaceMessage);

      // Memory retrieval (local SQLite) -> Retrieved Memory lane.
      try {
        if (sendOptions?.workspaceRoot && !isAutoTrivial) {
          const kernel = getRuntimeKernel();
          const memory = kernel.memory;
          // simple keyword-based scan as fallback (embeddings not exposed)
          const matches = await memory.list(sendOptions.workspaceRoot, "project");
          const filtered = matches
            .filter((m) => m.content.toLowerCase().includes(trimmedContent.toLowerCase().slice(0, 24)))
            .slice(0, 4);
          if (filtered.length > 0) {
            const memLines = ["[Project Memory]"];
            for (const hit of filtered) {
              memLines.push(
                `- ${hit.tags.join(", ") || "memory"}: ${hit.content.slice(0, 240)}`
              );
            }
            memorySnippets.push(memLines.join("\n"));
          }
        }
      } catch {
        // Memory optional; ignore errors
      }

      // Relevant Code lane: code-index search hits (excerpts/references, not whole files).
      const codeIndexBlock = (() => {
        if (isAutoTrivial) return null;
        const hits = codeIndexService.search(trimmedContent, 3);
        if (!hits.length) return null;
        const lines = ["[Code Index]", ...hits.map((hit) => `- ${hit.path}: ${hit.reasons.join("; ")}`)];
        return lines.join("\n");
      })();
      const relevantCodeContents: string[] = codeIndexBlock ? [codeIndexBlock] : [];
      const retrievedMemoryContents: string[] = [...memorySnippets];

      let orchestratedContextPack: Awaited<ReturnType<typeof contextOrchestrator.build>> | null = null;
      let activeFilePath = activeFile?.path?.replace(/\\/g, "/");
      let mentionedPaths = contextMentionPathsForTurn.map((path) => path.replace(/\\/g, "/"));
      if (sendOptions?.workspaceRoot && !isAutoTrivial && shouldLoadBroadRag(contextStage)) {
        beginStep("context-orchestrator", "Kontext-Orchestrierung");
        try {
          const rawWorkspaceSelectedFiles = Array.from(
            new Set(
              [
                ...(sendOptions.workspaceFiles?.map((file) => file.relativePath).filter(Boolean) ?? []),
                activeFile?.path
              ].filter((value): value is string => Boolean(value))
            )
          ).slice(0, 12);
          const rawMentionedPaths = contextMentionPathsForTurn;
          const normalizer = window.dbzs.normalizeWorkspaceContextPaths;
          const selectedNormalization = await normalizeWorkspaceContextPathCandidates(
            sendOptions.workspaceRoot,
            rawWorkspaceSelectedFiles,
            normalizer
          );
          const mentionedNormalization = rawMentionedPaths.length > 0
            ? await normalizeWorkspaceContextPathCandidates(sendOptions.workspaceRoot, rawMentionedPaths, normalizer)
            : { normalized: [], rejected: [] };
          const activeNormalization = activeFile?.path
            ? await normalizeWorkspaceContextPathCandidates(sendOptions.workspaceRoot, [activeFile.path], normalizer)
            : { normalized: [], rejected: [] };
          activeFilePath = activeNormalization.normalized[0] ?? activeFilePath;
          mentionedPaths = mentionedNormalization.normalized;
          const selectedFiles = Array.from(new Set([
            ...selectedNormalization.normalized,
            ...mentionedNormalization.normalized
          ]));
          const rejectedContextPaths = Array.from(new Set([
            ...selectedNormalization.rejected,
            ...mentionedNormalization.rejected,
            ...activeNormalization.rejected
          ]));
          if (rejectedContextPaths.length > 0) {
            const detail = `${rejectedContextPaths.length} Pfad(e) wurden nicht als Workspace-Kontext verwendet: ${rejectedContextPaths.slice(0, 5).join(", ")}`;
            mandatoryContents.push(`[Context Gap]\n${detail}\nGrund: Pfad konnte nicht kanonisch innerhalb des aktiven Workspace validiert werden.`);
            safeTraceEvents.push(createTraceEvent(initialRun.id, "context_gap", "Context-Lücke erkannt", detail, "failed"));
          }

          orchestratedContextPack = await contextOrchestrator.build(
            {
              taskId: initialRun.id,
              taskType,
              userQuery: trimmedContent,
              workspaceRoot: sendOptions.workspaceRoot,
              activeFile: activeFilePath,
              selectedFiles,
              maxTokens: Math.max(512, Math.round((resolvedContextWindowTokens ?? 4096) * 0.35)),
              modelId: routing.modelId ?? "unknown",
              slotId: contextSlotId
            },
            runAbortController.signal
          );

          safeTraceEvents.push(createTraceEvent(initialRun.id, "context_pack_built", "Kontext-Pack erzeugt", `${orchestratedContextPack?.items.length ?? 0} Einträge · ${orchestratedContextPack?.totalTokens ?? 0} Tokens`));
          finishStep("context-orchestrator", "Kontext-Orchestrierung", `${orchestratedContextPack?.items.length ?? 0} Einträge`);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Kontext-Orchestrierung nicht verfügbar";
          safeTraceEvents.push(createTraceEvent(initialRun.id, "context_pack_failed", "Kontext-Orchestrierung fehlgeschlagen", detail, "failed"));
          failStep("context-orchestrator", "Kontext-Orchestrierung", detail);
          console.info("Context orchestrator unavailable; continuing with existing retrieval pipeline:", error);
        }
      }

      if (runtimeFlags.ragEnabled !== false && sendOptions?.workspaceRoot && !isAutoTrivial && shouldLoadBroadRag(contextStage)) {
        beginStep("rag-retrieval", "Repository-Kontext suchen");
        safeTraceEvents.push(createTraceEvent(initialRun.id, "retrieval_started", "RAG-Suche gestartet", "Workspace-Index und Hybrid Retrieval werden abgefragt", "running"));
        try {
          const sync = await ragClient.syncIndex(sendOptions.workspaceRoot, { reason: "chat_request" });
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const status = await ragClient.status(sync.workspace_id);
            if (status.state !== "indexing") break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const intent = taskType === "planning" || taskType === "architecture" ? "planning"
            : taskType === "debugging" ? "debugging"
            : taskType === "review" ? "review"
            : taskType === "casual_chat" || taskType === "normal_chat" ? "chat" : "coding";
          ragResult = await ragClient.retrieve({
            id: `query-${crypto.randomUUID()}`,
            workspaceId: sync.workspace_id,
            workspaceRoot: sendOptions.workspaceRoot,
            query: trimmedContent,
            intent,
            activeFilePath,
            mentionedPaths,
            maxCandidates: 30,
            maxFinalItems: 5,
            tokenBudget: Math.max(256, Math.round((resolvedContextWindowTokens ?? 4096) * 0.3)),
            createdAt: new Date().toISOString()
          });
          if (runtimeFlags.hybridRetrievalEnabled !== false && ragResult.candidates.length > 0) {
            try {
              const modelId = embeddingService.defaultEmbeddingModel;
              const missingIds = new Set(await ragClient.missingEmbeddings(modelId, ragResult.candidates));
              const missing = ragResult.candidates.filter((item) => missingIds.has(item.id));
              const texts = [trimmedContent, ...missing.map((item) => item.content)];
              const embedded = await embeddingService.createEmbeddings({ texts, modelId });
              if (missing.length > 0) {
                await ragClient.upsertEmbeddings(missing.map((item, index) => ({
                  id: item.id, contentHash: item.contentHash, modelId: embedded.modelId,
                  vector: embedded.embeddings[index + 1] ?? [], tokenCount: item.tokenCount
                })).filter((entry) => entry.vector.length > 0));
              }
              const queryVector = embedded.embeddings[0];
              if (queryVector?.length) {
                ragResult = await ragClient.retrieve({
                  id: `query-${crypto.randomUUID()}`, workspaceId: sync.workspace_id,
                  workspaceRoot: sendOptions.workspaceRoot, query: trimmedContent, intent,
                  activeFilePath, mentionedPaths,
                  maxCandidates: 30, maxFinalItems: 5,
                  tokenBudget: Math.max(256, Math.round((resolvedContextWindowTokens ?? 4096) * 0.3)),
                  createdAt: new Date().toISOString(), queryEmbedding: queryVector, embeddingModelId: embedded.modelId
                });
              }
            } catch (error) {
              console.info("Embedding retrieval unavailable; lexical RAG remains active:", error);
            }
          }
          safeTraceEvents[safeTraceEvents.length - 1] = createTraceEvent(initialRun.id, "retrieval_completed", "RAG-Suche abgeschlossen", `${ragResult.manifest.candidateCount} Kandidaten gefunden`);
          safeTraceEvents.push(createTraceEvent(initialRun.id, "sources_selected", "Quellen ausgewählt", `${ragResult.manifest.selectedCount} Quellen · ${ragResult.manifest.totalTokens} Tokens`));
          finishStep("rag-retrieval", "Repository-Kontext suchen", `${ragResult.manifest.selectedCount} von ${ragResult.manifest.candidateCount} Treffern`);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "RAG nicht verfügbar";
          safeTraceEvents[safeTraceEvents.length - 1] = createTraceEvent(initialRun.id, "retrieval_completed", "RAG-Fallback", detail, "failed");
          failStep("rag-retrieval", "Repository-Kontext suchen", detail);
        }
      }

      const retrievedContextItems: SpoolerLaneItem[] = [
        ...(orchestratedContextPack?.items ?? []).map((item) => ({
          id: item.id,
          source: item.sourcePath,
          symbol: item.symbol,
          dedupeContent: item.content,
          content: `[Context Pack]\nSource: ${item.sourcePath ?? item.id}\nReasons: ${item.reasons.join("; ")}\n${item.content}`,
          estimatedTokens: item.tokenEstimate
        })),
        ...(ragResult?.items ?? []).map((item) => ({
          id: item.id,
          source: item.sourcePath,
          symbol: item.symbol,
          dedupeContent: item.content,
          content: `[Retrieved Context]\nSource: ${item.sourcePath ?? item.title ?? item.id}${item.symbol ? ` · ${item.symbol}` : ""}\nLines: ${item.startLine ?? 1}-${item.endLine ?? 1}\n${item.content}`,
          estimatedTokens: item.tokenCount
        }))
      ];

      const contextSpoolerEnabled = runtimeFlags.contextSpoolerEnabled ?? true;
      let systemMessages: RuntimeChatMessage[];
      let requestMessages: RuntimeChatMessage[];
      let spoolerManifest: ContextManifest | null = null;

      const toSystemMessage = (content: string, index: number): RuntimeChatMessage => ({
        id: `msg-${Date.now().toString(36)}-sys-${index}`,
        role: "system",
        content
      });

      const latestUserMessage = [...nextMessages].reverse().find((message) => message.role === "user");
      if (contextSpoolerEnabled) {
        const tokenBudget = buildTokenBudget(resolvedContextWindowTokens ?? 4096, {
          outputReserveRatio: runtimeFlags.tokenBudgetOutputReserveRatio,
          toolReserveRatio: runtimeFlags.tokenBudgetToolReserveRatio,
          safetyReserveRatio: runtimeFlags.tokenBudgetSafetyReserveRatio
        });
        const spooler = new ContextSpooler(tokenBudget);

        const toLaneItems = (contents: string[], prefix: string): SpoolerLaneItem[] =>
          contents.map((content, index) => ({
            id: `${prefix}-${index}`,
            content,
            estimatedTokens: estimateTokensCharHeuristic(content)
          }));
        // Current user turn is already in mandatory (P0) — do not place it in droppable history.
        const conversationItems: SpoolerLaneItem[] = nextMessages
          .filter((message) => message.id !== latestUserMessage?.id)
          .map((message) => ({
            id: message.id,
            content: message.content,
            estimatedTokens: estimateTokensCharHeuristic(message.content)
          }));

        const { lanes, manifest } = spooler.assemble({
          requestId: `req-${Date.now().toString(36)}`,
          modelId: routing.modelId ?? "unknown",
          role: effectiveAgent,
          mandatory: toLaneItems(mandatoryContents, "mandatory"),
          activeTask: activeTaskLaneItems,
          relevantCode: toLaneItems(relevantCodeContents, "relevant-code"),
          retrievedContext: retrievedContextItems,
          recentConversation: conversationItems,
          projectMemory: toLaneItems(retrievedMemoryContents, "memory")
        });
        spoolerManifest = manifest;

        const nonHistoryLanes = lanes.filter((lane) => lane.lane !== "recent_conversation" && lane.lane !== "overflow");
        systemMessages = nonHistoryLanes.flatMap((lane) => lane.included.map((item, index) => toSystemMessage(item.content, index)));

        const includedConversationIds = new Set(
          lanes.find((lane) => lane.lane === "recent_conversation")?.included.map((item) => item.id) ?? []
        );
        // Always keep the current user message in the request.
        requestMessages = nextMessages.filter(
          (message) => includedConversationIds.has(message.id) || message.id === latestUserMessage?.id
        );
      } else {
        // Legacy path, preserved behind the contextSpoolerEnabled flag.
        requestMessages = nextMessages.slice(-MAX_HISTORY_MESSAGES);
        systemMessages = [
          ...mandatoryContents,
          ...activeTaskContents,
          ...relevantCodeContents,
          ...retrievedContextItems.map((item) => item.content),
          ...retrievedMemoryContents
        ].map(toSystemMessage);
      }

      requestMessages = requestMessages.map((message) =>
        message.id === latestUserMessage?.id
          ? {
              ...message,
              content: requestUserContent,
              images: requestUserImages.length > 0 ? requestUserImages : undefined
            }
          : message
      );

      const messagesForRequestPreFallback =
        systemMessages.length > 0 ? [...systemMessages, ...requestMessages] : requestMessages;
      let messagesForRequest = messagesForRequestPreFallback;

      // Phase 2B: hard final-request budget gate on the *serialized* request only
      // (systemMessages already contain memory/file/RAG — do not double-count).
      // Tool catalog that the agent loop would inject MUST be counted/frozen here.
      const runtimeLimit = resolvedContextWindowTokens ?? 4096;
      let contextFallbackApplied = false;
      let droppedSources: string[] = [];
      const profile = sendOptions?.toolProfile ?? get().toolProfile ?? loadToolProfile();
      const remediationToolPhase =
        activeTaskContract?.workflowId === REVIEW_REMEDIATION_WORKFLOW_ID
          ? resolveReviewRemediationToolPhase(activeTaskContract.currentPhase)
          : null;
      const genericPhaseAllowedToolNames = resolveWorkflowPhaseToolNames({
        taskType,
        phase: activeTaskContract?.currentPhase ?? workflowAssignment.phase,
        skillAllowedNames: activeSkillContext?.effectiveAllowedTools
      });
      const phaseAllowedToolNames = remediationToolPhase
        ? resolveReviewRemediationPhaseToolNames(
            activeTaskContract?.currentPhase ?? "planning",
            genericPhaseAllowedToolNames
          )
        : genericPhaseAllowedToolNames;
      const toolEstimate = estimateProviderToolBudget({
        toolsEnabled,
        providerId: routing.providerId ?? brokerDecisionFull?.providerId ?? sendOptions?.provider,
        profile,
        workspaceRoot: sendOptions?.workspaceRoot ?? runWorkspaceRoot,
        skillAllowedNames: phaseAllowedToolNames
      });
      const outputReserveTokens = outputReserveForTurn({
        taskType,
        currentPhase: activeTaskContract?.currentPhase ?? workflowAssignment.phase,
        runtimeContextLimit: runtimeLimit,
        protocolMode: toolEstimate.protocolMode
      });
      const phaseToolLimit =
        remediationToolPhase
          ? REVIEW_REMEDIATION_PHASE_TOOL_LIMITS[remediationToolPhase]
          : resolveWorkflowPhaseToolLimit({
              taskType,
              phase: activeTaskContract?.currentPhase ?? workflowAssignment.phase
            });
      const effectiveToolPhase =
        remediationToolPhase ??
        resolveWorkflowToolPhase({
          taskType,
          phase: activeTaskContract?.currentPhase ?? workflowAssignment.phase
        });
      if (
        phaseToolLimit !== null &&
        toolEstimate.toolCount > phaseToolLimit
      ) {
        throw new Error(
          `workflow_tool_limit_exceeded:${effectiveToolPhase}:${toolEstimate.toolCount}`
        );
      }
      if (
        toolEstimate.toolSystemMessages.length > 0 &&
        !messagesAlreadyIncludeToolCatalog(systemMessages)
      ) {
        systemMessages = [...systemMessages, ...toolEstimate.toolSystemMessages];
      }
      messagesForRequest =
        systemMessages.length > 0 ? [...systemMessages, ...requestMessages] : requestMessages;
      const messagesForRequestPreFallbackBound = messagesForRequest;
      // Tool-Kataloge werden unabhängig vom Transportmodus separat attribuiert.
      const toolsTextForBudget = toolEstimate.toolsText;
      const toolMessageIds = new Set(toolEstimate.toolSystemMessages.map((message) => message.id));
      const systemTextWithoutToolCatalog = () =>
        systemMessages
          .filter((message) => !toolMessageIds.has(message.id))
          .map((message) => message.content)
          .join("\n\n");
      let finalBudget = computeFinalRequestTokenBudget({
        runtimeContextLimit: runtimeLimit,
        systemText: systemTextWithoutToolCatalog(),
        chatText: requestMessages.map((m) => m.content).join("\n\n"),
        toolsText: toolsTextForBudget,
        outputReserveTokens
      });
      const tokensBeforeFallback = finalBudget.totalRequiredTokens;
      const budgetGate = evaluateFinalBudgetGate(finalBudget, 0);

      if (!budgetGate.ok) {
        const dropIds = dedupeDroppedSourceIds([
          ...(spoolerManifest?.droppedSections ?? []),
          "orchestration_signals",
          "broad_rag"
        ]);
        droppedSources = dropIds;
        const requiredArtifacts = buildRequiredContextArtifactBlock({
          workspace: resolvedWorkspaceContext,
          approvalState: activeTaskContract
            ? `phase=${activeTaskContract.currentPhase}; assigned=${activeTaskContract.assignedAgent}; goal=${activeTaskContract.confirmedGoal ?? ""}`
            : null
        });
        const minimal = buildMinimalPlanningContext({
          taskSummary: trimmedContent.slice(0, 2000),
          successCriteria: activeTaskContract?.acceptanceCriteria?.join("; ")
        });
        // Keep Goal Capsule + current user message + required project summaries + real tool catalog.
        systemMessages = [
          toSystemMessage(formatGoalCapsuleBlock(goalCapsule), 0),
          ...(activeTaskContract?.reviewRemediation
            ? [toSystemMessage(formatReviewRemediationCapsule(activeTaskContract.reviewRemediation), 1)]
            : []),
          toSystemMessage(`[CURRENT USER MESSAGE — P0_NON_DROPPABLE]\n${trimmedContent}`, 1),
          toSystemMessage(requiredArtifacts.text, 2),
          toSystemMessage(minimal.fileContextText, 3),
          ...toolEstimate.toolSystemMessages
        ];
        requestMessages = nextMessages.slice(-4).map((message) =>
          message.id === latestUserMessage?.id
            ? {
                ...message,
                content: requestUserContent,
                images: requestUserImages.length > 0 ? requestUserImages : undefined
              }
            : message
        );
        messagesForRequest =
          systemMessages.length > 0 ? [...systemMessages, ...requestMessages] : requestMessages;
        finalBudget = computeFinalRequestTokenBudget({
          runtimeContextLimit: runtimeLimit,
          systemText: systemTextWithoutToolCatalog(),
          chatText: requestMessages.map((m) => m.content).join("\n\n"),
          toolsText: toolsTextForBudget,
          outputReserveTokens
        });
        const tokensRemovedById = allocateTokensRemoved(
          dropIds,
          tokensBeforeFallback,
          finalBudget.totalRequiredTokens
        );
        const droppedContextSources = [
          ...buildDroppedContextSources(
            dropIds,
            budgetGate.reason === "low_safety_margin" ? "safety_margin" : "context_overflow",
            tokensRemovedById,
            { tokensBefore: tokensBeforeFallback, tokensAfter: finalBudget.totalRequiredTokens }
          ),
          ...buildDroppedContextSources(
            requiredArtifacts.replacedBySummary,
            "replaced_by_summary",
            undefined,
            { tokensBefore: tokensBeforeFallback, tokensAfter: finalBudget.totalRequiredTokens }
          )
        ];
        contextFallbackApplied = true;
        const fallbackReason =
          budgetGate.reason === "low_safety_margin" ? "low_safety_margin" : "context_overflow";
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...r,
              contextFallbackApplied: true,
              droppedSources: droppedSources.filter(
                (id) => !/goal|P0_NON_DROPPABLE|CURRENT USER/i.test(id)
              ),
              droppedContextSources,
              tokenBudget: finalBudget,
              contextStage
            },
            "context.completed",
            `context_fallback_applied reason=${fallbackReason} tokens_before=${tokensBeforeFallback} tokens_after=${finalBudget.totalRequiredTokens} tool_tokens=${finalBudget.toolTokens}`
          )
        );

        if (!isFinalBudgetWithinLimit(finalBudget, 0) && finalBudget.overflowTokens > 0) {
          const overflowMsg = `Context-Overflow: Bedarf ${finalBudget.totalRequiredTokens} > Limit ${finalBudget.runtimeContextLimit} (Overflow ${finalBudget.overflowTokens})`;
          failStep("history", "Anfrage vorbereiten", overflowMsg);
          updateActiveRun((r) =>
            appendRunEvent(
              {
                ...updateRunStatus(r, "failed"),
                outcome: "context_overflow" satisfies RuntimeRunOutcome,
                tokenBudget: finalBudget,
                contextStage,
                contextFallbackApplied: true,
                droppedSources,
                droppedContextSources,
                error: { code: "context_overflow", message: overflowMsg, phase: "context" }
              },
              "chat.failed",
              overflowMsg
            )
          );
          const finishedRun = get().activeRun;
          resetFirstTokenTimeout();
          clearTimeout(totalTimeout);
          set((state) => ({
            error: overflowMsg,
            isSending: false,
            lastActivity: activity,
            currentActivity: null,
            activeRun: null,
            historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
          }));
          return false;
        }
      } else {
        updateActiveRun((r) => ({
          ...r,
          contextStage,
          tokenBudget: finalBudget,
          droppedSources: dedupeDroppedSourceIds(spoolerManifest?.droppedSections ?? []),
          contextFallbackApplied: false
        }));
      }

      // Authoritative post-fallback freeze — only this payload may hit the provider.
      const preparedTools = toolEstimate.exposedNames.map((name) => ({ name }));
      if (!bindingDecision) {
        throw new Error("request_binding_mismatch: binding_decision_missing");
      }
      const preparedRequest: PreparedRuntimeRequest = freezePreparedRuntimeRequest({
        runId: initialRun.id,
        turnIndex: 0,
        bindingDecisionId: bindingDecision.decisionId,
        workflowKind: bindingDecision.workflowKind,
        phase: bindingDecision.phase,
        targetAgent: bindingDecision.targetAgent,
        modelRole: bindingDecision.modelRole,
        toolProfile: bindingDecision.toolProfile,
        modelId: bindingDecision.resolvedModelId,
        modelName: bindingDecision.resolvedModelName,
        slotId: bindingDecision.slotId,
        providerId: bindingDecision.providerId,
        protocolMode: bindingDecision.protocolMode,
        messages: messagesForRequest,
        tools: preparedTools,
        contextVersion: contextFallbackApplied ? 2 : 1,
        contextStage,
        outputReserveTokens: finalBudget.outputReserveTokens,
        safetyMarginTokens: Math.max(
          0,
          finalBudget.runtimeContextLimit - finalBudget.totalRequiredTokens
        ),
        toolsHash: toolEstimate.toolsHash,
        promptTokens: Math.max(
          0,
          estimatePromptTokens(messagesForRequest) - finalBudget.toolTokens
        ),
        toolPayloadTokens: finalBudget.toolTokens
      });
      messagesForRequest = [...preparedRequest.messages];
      const promptBinding: PromptBindingDiagnostics = buildPromptBindingDiagnostics({
        preFallbackMessages: messagesForRequestPreFallbackBound,
        postFallbackMessages: preparedRequest.messages,
        sentMessages: preparedRequest.messages,
        attributedToolTokens: finalBudget.toolTokens
      });
      const bindingCheck = assertPromptBindingMatches(preparedRequest, promptBinding);
      const preparedReady = assertPreparedRequestReady(
        preparedRequest,
        finalBudget.runtimeContextLimit
      );
      if (!bindingCheck.ok || !preparedReady.ok) {
        const mismatchMsg = `request_binding_mismatch: ${
          !bindingCheck.ok
            ? bindingCheck.reason
            : !preparedReady.ok
              ? preparedReady.reason
              : "unknown"
        }`;
        failStep("history", "Anfrage vorbereiten", mismatchMsg);
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...updateRunStatus(r, "failed"),
              outcome: "request_binding_mismatch" satisfies RuntimeRunOutcome,
              tokenBudget: finalBudget,
              promptBindingDiagnostics: promptBinding as unknown as Record<string, unknown>,
              error: { code: "request_binding_mismatch", message: mismatchMsg, phase: "context" }
            },
            "chat.failed",
            mismatchMsg
          )
        );
        const finishedRun = get().activeRun;
        resetFirstTokenTimeout();
        clearTimeout(totalTimeout);
        set((state) => ({
          error: mismatchMsg,
          isSending: false,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: finishedRun
            ? { ...state.historicalRuns, [finishedRun.id]: finishedRun }
            : state.historicalRuns
        }));
        return false;
      }
      const boundInputTokens =
        preparedRequest.promptTokens + preparedRequest.toolPayloadTokens;
      const boundRequiredTokens =
        boundInputTokens + preparedRequest.outputReserveTokens;
      const promptAccountingDelta = boundInputTokens - finalBudget.totalInputTokens;
      finalBudget = {
        ...finalBudget,
        systemTokens: Math.max(0, finalBudget.systemTokens + promptAccountingDelta),
        totalInputTokens: boundInputTokens,
        totalRequiredTokens: boundRequiredTokens,
        overflowTokens: Math.max(0, boundRequiredTokens - finalBudget.runtimeContextLimit)
      };
      updateActiveRun((r) => ({
        ...r,
        promptBindingDiagnostics: promptBinding as unknown as Record<string, unknown>,
        tokenBudget: finalBudget
      }));

      // Lazy Runtime: start work model only after confirmed routing + budget fit.
      if (slotValidationEnabled && contextSlotId && routing.modelId) {
        const assertStartStillValid = () => {
          if (runAbortController.signal.aborted) {
            throw new Error("runtime_start_discarded: run_aborted");
          }
          const active = get().activeRun;
          if (!active || active.id !== initialRun.id) {
            throw new Error("runtime_start_discarded: run_superseded");
          }
          const currentWorkspace =
            useWorkspaceStore.getState().state.projectPath ?? sendOptions?.workspaceRoot ?? null;
          if ((runWorkspaceRoot ?? null) !== (currentWorkspace ?? null)) {
            throw new Error("runtime_start_discarded: workspace_changed");
          }
        };

        beginStep("runtime-ondemand", "Arbeitsmodell laden");
        assertStartStillValid();
        const settingsState = useSettingsStore.getState();
        if (!brokerDecisionFull || !bindingDecision) {
          throw new Error("request_binding_mismatch: binding_decision_missing");
        }
        if (bindingDecision.settingsRevision !== settingsState.settingsRevision) {
          throw new Error(
            `request_binding_mismatch: settings_revision_changed old=${bindingDecision.settingsRevision} new=${settingsState.settingsRevision}`
          );
        }
        appendStepDetail(
          "runtime-ondemand",
          [
            `Workflow: ${continuation.reason}`,
            `Agent: ${bindingDecision.targetAgent}`,
            `Settings Revision aktuell: ${settingsState.settingsRevision}`,
            `Decision Revision: ${bindingDecision.settingsRevision}`,
            `Plan-Rollenmodell: ${settingsState.settings.defaultPlannerModelId || "(leer)"}`,
            `Configured: ${bindingDecision.configuredModelId}`,
            `Resolved ID: ${bindingDecision.resolvedModelId}`,
            `Resolved Name: ${bindingDecision.resolvedModelName}`,
            `Slot: ${bindingDecision.slotId}`,
            `Quelle: ${bindingDecision.source}`
          ].join(" · ")
        );
        routing.modelId = bindingDecision.resolvedModelId;
        routing.modelName = bindingDecision.resolvedModelName;
        routing.configuredModelId = bindingDecision.configuredModelId;
        routing.selectionSource = bindingDecision.source;
        routing.settingsRevision = bindingDecision.settingsRevision;
        routing.targetAgent = mapBrokerAgentToShared(brokerDecisionFull.targetAgent);
        contextSlotId = resolveContextSlotId(taskType, bindingDecision.slotId);
        routing.slotId = contextSlotId;
        set({ lastRouting: routing, lastBrokerDecision: brokerDecisionFull });
        syncActiveRunBindingPatch({
          provider: routing.providerId ?? undefined,
          modelId: routing.modelId ?? undefined,
          modelName: routing.modelName ?? undefined,
          slotId: routing.slotId ?? undefined,
          configuredModelId: routing.configuredModelId ?? undefined,
          selectionSource: routing.selectionSource ?? undefined,
          settingsRevision: routing.settingsRevision ?? undefined,
          targetAgentLabel: bindingDecision.targetAgent
        });

        const preparation = await prepareOnDemandRuntimeAction({
          set,
          get,
          sendOptions,
          taskType,
          effectiveAgent,
          workflowAssignment,
          initialRunId: initialRun.id,
          userMessage,
          activity,
          nextMessages,
          routing,
          bindingDecision,
          brokerDecisionFull,
          contextSlotId,
          trimmedContent,
          resetFirstTokenTimeout,
          clearTotalTimeout: () => clearTimeout(totalTimeout),
          timeoutManager,
          callbacks: {
            appendStepDetail,
            failStep,
            updateActiveRun,
            syncActiveRunBindingPatch,
            updateActivitySummary: (summary) =>
              updateActivity(
                patchActivityRun(activity, {
                  finishedAt: new Date().toISOString(),
                  summary
                })
              )
          }
        });
        if (preparation.handled) {
          return preparation.result;
        }
        routing = preparation.routing;
        bindingDecision = preparation.bindingDecision;
        contextSlotId = preparation.contextSlotId;
        let slotId: RuntimeSlotId = preparation.slotId as RuntimeSlotId;
        const currentSlotStatus = preparation.currentSlotStatus;
        let modelToStart = preparation.modelToStart;
        const launchProfile = preparation.launchProfile;
        const slotNeedsStart = preparation.slotNeedsStart;
        const backendUrl = preparation.backendUrl;
        const onDemandResult = await executeOnDemandRuntimeAction({
          taskType,
          requestCapabilities: {
            requiresVision: requestCapabilities.requiresVision,
            hasImageInput: requestCapabilities.hasImageInput
          },
          activitySummary: {
            appendStepDetail,
            failStep,
            finishStep
          },
          runtime: {
            routing,
            bindingDecision,
            brokerDecisionFull,
            contextSlotId,
            slotId,
            currentSlotStatus,
            modelToStart,
            launchProfile,
            slotNeedsStart,
            backendUrl,
            finalBudget,
            resolvedContextWindowTokens
          },
          controls: {
            assertStartStillValid,
            touchWorkModelActivity,
            runAbortSignal: runAbortController.signal,
            timeoutManager: {
              getEndpointReady: () => timeoutManager.getEndpointReady(),
              getModelLoad: () => timeoutManager.getModelLoad(),
              getWarmup: () => timeoutManager.getWarmup(),
              getRouting: () => timeoutManager.getRouting()
            }
          },
          callbacks: {
            updateActiveRun,
            syncActiveRunBindingPatch,
            setLastRouting: (nextRouting) => set({ lastRouting: nextRouting }),
            handleFailure: async (error, executionStartedThisRun, failureContextSlotId) => {
              const errMsg =
                error instanceof BindingModelError
                  ? `${error.message}${error.options.length ? ` Optionen: ${error.options.join(" · ")}` : ""}`
                  : error instanceof Error
                    ? error.message
                    : "On-Demand-Start fehlgeschlagen";
              if (executionStartedThisRun && errMsg.startsWith("runtime_start_discarded:")) {
                try {
                  await runtimeSlotManager.stopSlot(failureContextSlotId);
                } catch {
                  // best effort — do not fail harder on discard cleanup
                }
              }
              const onDemandOutcome: RuntimeRunOutcome =
                /workflow_state_invalid/i.test(errMsg)
                  ? "workflow_state_invalid"
                  : error instanceof BindingModelError
                    ? error.code === "runtime_oom"
                      ? "runtime_oom"
                      : "warmup_failed"
                    : /endpoint_ready_timeout|target_slot_ondemand_timeout/i.test(errMsg)
                      ? "endpoint_ready_timeout"
                    : /process_start|runtime_start_failed/i.test(errMsg)
                        ? "runtime_start_failed"
                        : "runtime_start_failed";
              const userFacingOnDemandError =
                onDemandOutcome === "runtime_oom"
                  ? "Das aktuelle Modell oder der Kontext passt gerade nicht in den gewählten Slot. Ich kann mit kleinerem Profil oder anderem Modell weitermachen."
                  : onDemandOutcome === "endpoint_ready_timeout"
                    ? "Das Modell wurde gestartet, aber nicht rechtzeitig bereit. Ein Retry oder ein kleineres Profil ist jetzt sinnvoll."
                    : error instanceof BindingModelError
                      ? error.message
                      : "Das Arbeitsmodell konnte nicht sauber starten. Ich kann als Nächstes einen Retry, ein anderes Profil oder ein anderes Modell anbieten.";
              appendGenericRunFailure({
                updateActiveRun,
                outcome: onDemandOutcome,
                summary: userFacingOnDemandError,
                error: {
                  code: onDemandOutcome,
                  message: errMsg,
                  phase: onDemandOutcome === "workflow_state_invalid" ? "routing" : "runtime"
                }
              });
              finalizeSendState({
                set,
                get,
                activity: markActivityFailure(activity, userFacingOnDemandError),
                errorMessage: userFacingOnDemandError
              });
              return false;
            }
          }
        });
        if (!onDemandResult.ok) {
          return false;
        }
        routing = onDemandResult.routing;
        contextSlotId = onDemandResult.contextSlotId;
        slotId = onDemandResult.slotId;
        modelToStart = onDemandResult.modelToStart;
        finalBudget = onDemandResult.finalBudget;
        resolvedContextWindowTokens = onDemandResult.resolvedContextWindowTokens;
      }

      beginStep(
        "history",
        "Anfrage vorbereiten",
        `${requestMessages.length} Verlaufsnachrichten, ${systemMessages.length} Kontextnachrichten · Bedarf ${finalBudget.totalRequiredTokens}/${finalBudget.runtimeContextLimit}`
      );
      finishStep(
        "history",
        "Anfrage vorbereiten",
        `Prompt bereit · Outputreserve ${finalBudget.outputReserveTokens} · Stufe ${contextStage}`
      );

      const useTurnLoopEnabled = runtimeFlags.runtimeChatEnableAgentTurnLoop ?? true;
      const conversationControlV2Enabled = runtimeFlags.conversationControlV2 ?? true;
      // P1 Req 7: Use fallback_policy from broker decision (or relaxed via flag)
      const strictFallbackEnabled = runtimeFlags.runtimeChatEnableStrictFallback ?? true;
      const fallbackPolicy = strictFallbackEnabled
        ? brokerDecisionFull?.fallbackPolicy ?? "strict"
        : "allow_local_fallback";
      const useTurnLoop =
        useTurnLoopEnabled &&
        (sendOptions?.useAgentTurnLoop ??
          shouldUseAgentTurnLoop(toolsEnabled, profile, effectiveAgent, sendOptions?.agentMode === "agent", trimmedContent));

      const finalizeSendFailure = (message: string, userError = message) => {
        finalizeSendState({
          set,
          get,
          activity: markActivityFailure(activity, `Abgebrochen: ${message}`),
          errorMessage: userError
        });
        return false;
      };

      const { providerRequestDiagnostics, providerPreflight } = buildProviderRequestPrelude({
        preparedRequest,
        toolEstimate,
        finalBudgetRuntimeContextLimit: finalBudget.runtimeContextLimit,
        taskType,
        hasImageInput: requestCapabilities.hasImageInput,
        currentPhase: bindingDecision?.phase ?? activeTaskContract?.currentPhase ?? workflowAssignment.phase,
        providerId: bindingDecision?.providerId ?? routing.providerId ?? brokerDecisionFull?.providerId ?? sendOptions?.provider,
        endpoint: useSettingsStore.getState().settings.backendUrl || "http://127.0.0.1:8876",
        providerFallback: String(sendOptions?.provider ?? routing.providerId ?? brokerDecisionFull?.providerId ?? "runtime"),
        updateActiveRun
      });

      if (
        !handleProviderPreflightFailure({
          providerRequestDiagnostics,
          providerPreflight,
          failStep,
          updateActiveRun,
          finishFailureState: finalizeSendFailure
        })
      ) {
        return false;
      }

      if (useTurnLoop && sendOptions?.workspaceRoot) {
        beginStep("llm-request", "Agent-Turn starten", "Tools + Follow-up erlaubt");
        const bindingPrelude = await validateRequestExecutionBinding({
          stepLabel: "Agent-Turn starten",
          slotValidationEnabled,
          contextSlotId: contextSlotId as RuntimeSlotId | null,
          routingModelId: routing.modelId,
          initialRunId: initialRun.id,
          preparedRequest,
          bindingDecision: bindingDecision!,
          providerRequestDiagnostics,
          providerPreflight,
          updateActiveRun,
          failStep,
          finishFailureState: finalizeSendFailure,
          timeoutManagerConfig: timeoutManager.config,
          settings: useSettingsStore.getState().settings
        });
        if (!bindingPrelude.ok) {
          return finalizeSendFailure(
            "request_binding_mismatch",
            "request_binding_mismatch"
          );
        }
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "streaming"), "model.request.started", "Agent-Turn Loop gestartet"));
        set({
          messages: [...nextMessages, { id: `msg-${Date.now().toString(36)}-assistant`, role: "assistant", content: "", toolCalls: [] }],
          isStreaming: true,
          error: null
        });

        const runId = `run-${Date.now().toString(36)}`;
        const agentTurnCallbacks = createAgentTurnLoopCallbacks({
          set,
          get,
          initialRunId: initialRun.id,
          brokerDecisionId: brokerDecisionFull?.decisionId ?? undefined,
          workspaceRoot: sendOptions.workspaceRoot ?? undefined,
          updateActiveRun,
          updateActivity,
          activity,
          safeTraceEvents,
          conversationControlV2Enabled,
          streamingUiThrottleMs: STREAMING_UI_THROTTLE_MS,
          onStreamTokenActivity,
          appendStepDetail
        });

        // P0 Phase 2: Start first-token timer at HTTP boundary
        startFirstTokenTimeout(timeoutManager.getFirstToken());

        const agentResult = await runAgentChatTurnLoop({
          runId,
          goal: trimmedContent,
          targetAgent: effectiveAgent,
          profile,
          workspaceRoot: sendOptions.workspaceRoot,
          systemMessages,
          historyMessages: requestMessages,
          providerId: preparedRequest.providerId,
          modelId: preparedRequest.modelId,
          slotId: preparedRequest.slotId as RuntimeSlotId,
          fallbackPolicy,
          decisionId: bindingDecision?.decisionId ?? brokerDecisionFull?.decisionId ?? initialRun.id,
          fileContext: buildFileContext(activeFile),
          signal: runAbortController.signal,
          activeSkill: activeSkillContext ?? undefined,
          allowedToolNames: phaseAllowedToolNames,
          requestAssistant: requestAssistantResponse,
          ...agentTurnCallbacks
        });

        // AbortController wird im finally-Block bereinigt
        set({ isStreaming: false });

        finishStep(
          "llm-request",
          "Modell-Anfrage senden",
          `Agent-Loop fertig · ${agentResult.turnsExecuted ?? 0} Turns`
        );

        const agentTurnFinalization = await finalizeAgentTurnResult({
          agentResult,
          currentMessages: get().messages,
          trimmedContent,
          executionIntentForTurn,
          toolsEnabled,
          workspaceRoot: sendOptions?.workspaceRoot ?? null,
          initialRunId: initialRun.id,
          routing,
          contextSlotId: contextSlotId as RuntimeSlotId | null,
          safeTraceEvents,
          ragManifest: ragResult?.manifest,
          ragSourceReferences: ragResult?.sourceReferences,
          spoolerManifest,
          tokenBudget: get().activeRun?.tokenBudget,
          firstTokenAt: get().activeRun?.firstTokenAt,
          taskType,
          activeTaskPhase: activeTaskContract?.currentPhase ?? null,
          reasoningTraceEnabled: runtimeFlags.reasoningTraceEnabled !== false,
          applyPlanningRelevanceGate: async (answer) => {
            const verifiedPaths = verifiedPathsList(verifiedEvidence);
            return applyPlanningRelevanceGate({
              answer,
              confirmedGoal: activeTaskContract?.confirmedGoal ?? trimmedContent,
              acceptanceCriteria: activeTaskContract?.acceptanceCriteria ?? [],
              verifiedPaths,
              toolResultCount: verifiedPaths.length + (agentResult.systemMessages?.length ?? 0),
              runId: initialRun.id,
              userQuestion: trimmedContent,
              contractBlock: activeTaskContract
                ? formatActiveTaskContractBlock(activeTaskContract, trimmedContent)
                : `[ACTIVE TASK]\n${trimmedContent}`,
              routing,
              slotId: contextSlotId as RuntimeSlotId | null,
              decisionId: brokerDecisionFull?.decisionId ?? initialRun.id,
              signal: runAbortController.signal,
              traceEvents: safeTraceEvents
            });
          },
          persistTraceEvents: (events) => traceClient.append(initialRun.id, events),
          startedAt: get().activeRun?.startedAt
        });
        const {
          resultMessages,
          finalizedAssistantMessage,
          finalization,
          persistedAgentTurn
        } = agentTurnFinalization;
        const activitySummary = buildSendCompletionSummary({
          startedAt,
          outcome: finalization.outcome,
          userMessage: finalization.userMessage
        });

        updateActiveRun((r) =>
        appendRunEvent(
          {
            ...updateRunStatus(r, finalization.status),
            outcome: finalization.outcome,
            turns: upsertRunTurn(r, persistedAgentTurn).turns,
            finalAnswerDiagnostics: finalization.diagnostics as unknown as Record<string, unknown>
          },
          finalization.outcome === "success"
            ? "chat.completed"
            : finalization.outcome === "needs_user_input"
                ? "chat.accepted"
                : "chat.failed",
            finalization.userMessage
          )
        );

        updateActivity(
          patchActivityRun(activity, {
            finishedAt: new Date().toISOString(),
            summary: activitySummary
          })
        );

        if (activeSkillContext && sendOptions.workspaceRoot) {
          activeSkillContext.run = await validateAndFinishSkillRun(
            sendOptions.workspaceRoot,
            activeSkillContext,
            agentResult.terminalReason === "skill_tool_policy_violation"
          );
        }
        if (
          finalizedAssistantMessage.planProposal &&
          sendOptions.workspaceRoot &&
          activeTaskContract?.workflowId === REVIEW_REMEDIATION_WORKFLOW_ID
        ) {
          upsertActiveTaskContract(sendOptions.workspaceRoot, {
            originalRequest: activeTaskContract.originalRequest,
            confirmedGoal: activeTaskContract.confirmedGoal,
            acceptanceCriteria: activeTaskContract.acceptanceCriteria,
            taskType: "planning",
            assignedAgent: "planner",
            currentPhase: "awaiting_plan_approval",
            reviewRemediation: activeTaskContract.reviewRemediation
          });
          await finishReviewRemediationSelection(sendOptions.workspaceRoot, "consumed");
        }
        finalizeSendState({
          set,
          get,
          activity: markActivityFailure(activity, activitySummary),
          errorMessage: shouldClearSendError(finalization.outcome) ? null : finalization.userMessage,
          statePatch: (state) => {
            const nextPlanProposalsById =
              finalizedAssistantMessage.planProposal && !state.planProposalsById[finalizedAssistantMessage.planProposal.id]
                ? { ...state.planProposalsById, [finalizedAssistantMessage.planProposal.id]: finalizedAssistantMessage.planProposal }
                : state.planProposalsById;
            const syncedRuntimeActions = syncRuntimeAgentActions(resultMessages, nextPlanProposalsById);
            const messagesWithFollowUps = attachFollowUpActionsToMessages({
              messages: syncedRuntimeActions.messages,
              finalizedAssistantMessage,
              run: state.activeRun,
              taskType,
              hasPlanProposal: Boolean(finalizedAssistantMessage.planProposal),
              hasPatchProposal: Boolean(finalizedAssistantMessage.patchProposalId),
              workspaceRoot: sendOptions?.workspaceRoot ?? null
            });
            return {
              messages: messagesWithFollowUps,
              agentActionsById: syncedRuntimeActions.agentActionsById,
              lastTrajectory: agentResult.trajectory,
              toolProfile: profile,
              planProposalsById: nextPlanProposalsById
            };
          }
        });
        return agentTurnFinalization.success;
      }

      beginStep("llm-request", "Modell-Anfrage senden", "Streaming-Antwort wird empfangen ...");
      const streamBindingPrelude = await validateRequestExecutionBinding({
        stepLabel: "Modell-Anfrage senden",
        slotValidationEnabled,
        contextSlotId: contextSlotId as RuntimeSlotId | null,
        routingModelId: routing.modelId,
        initialRunId: initialRun.id,
        preparedRequest,
        bindingDecision: bindingDecision!,
        providerRequestDiagnostics,
        providerPreflight,
        updateActiveRun,
        failStep,
        finishFailureState: finalizeSendFailure,
        timeoutManagerConfig: timeoutManager.config,
        settings: useSettingsStore.getState().settings
      });
      if (!streamBindingPrelude.ok) {
        return finalizeSendFailure(
          "request_binding_mismatch",
          "request_binding_mismatch"
        );
      }
      updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "streaming"), "model.request.started", "Streaming gestartet"));

      set({
        messages: [...nextMessages, { id: `msg-${Date.now().toString(36)}-asst`, role: "assistant", content: "" }],
        isStreaming: true
      });

      const streamingCallbacks = createStreamingResponseCallbacks({
        set,
        updateActiveRun,
        updateActivity,
        activity,
        conversationControlV2Enabled,
        streamingUiThrottleMs: STREAMING_UI_THROTTLE_MS,
        onStreamTokenActivity
      });

      // P0 Phase 2: Start first-token timer at HTTP boundary (transport layer)
      startFirstTokenTimeout(timeoutManager.getFirstToken());

      const response = await requestAssistantResponse(
        {
          messages: messagesForRequest,
          file_context: buildFileContext(activeFile),
          temperature: 0.2,
          max_tokens: Math.min(2048, Math.max(256, preparedRequest.outputReserveTokens)),
          model_id: preparedRequest.modelId,
          slot_id: preparedRequest.slotId as RuntimeSlotId,
          provider: preparedRequest.providerId,
          fallback_policy: fallbackPolicy,
          routing_reason:
            brokerDecisionFull?.reason.join("; ") ??
            `slot:${contextSlotId};provider:${routing.providerId ?? "runtime"}`,
          decision_id: bindingDecision?.decisionId ?? brokerDecisionFull?.decisionId ?? initialRun.id,
          run_id: initialRun.id
        },
        streamingCallbacks.onDelta,
        runAbortController.signal
      );
      const streamedContent = streamingCallbacks.getStreamedContent();
      syncActiveRunBindingPatch({
        provider: sendOptions?.provider ?? routing.providerId ?? brokerDecisionFull?.providerId ?? undefined,
        modelId: response.model_id ?? routing.modelId ?? undefined,
        modelName: response.model_name ?? routing.modelName ?? undefined,
        slotId: contextSlotId ?? undefined,
        configuredModelId: routing.configuredModelId ?? response.model_id ?? undefined,
        selectionSource: routing.selectionSource ?? undefined,
        warmupStatus: routing.warmupStatus ?? undefined,
      });

      // AbortController wird im finally-Block bereinigt
      set({ isStreaming: false });

      finishStep(
        "llm-request",
        "Modell-Anfrage senden",
        `Streaming abgeschlossen (${response.message.content.length} Zeichen) · ${response.model_name ?? response.model_id ?? routing.modelName ?? "Modell"}`
      );

      const streamProcessing = await processStreamingResponseArtifacts({
        response,
        currentMessages: get().messages,
        workspaceRoot: resolvedWorkspaceContext?.rootPath ?? sendOptions?.workspaceRoot ?? null,
        routing,
        taskType,
        activeTaskPhase: activeTaskContract?.currentPhase ?? null,
        initialRunId: initialRun.id,
        startedAt,
        requestMessages,
        systemMessages,
        resolvedWorkspaceContext,
        activeFile,
        sendOptions: sendOptions ?? {},
        ragManifest: ragResult?.manifest,
        ragSourceReferences: ragResult?.sourceReferences,
        spoolerManifest,
        traceEvents: safeTraceEvents,
        verifiedEvidence,
        callbacks: {
          beginStep,
          finishStep,
          appendStepDetail,
          updateActiveRun,
          setMessagesAndActions: (
            messages: RuntimeChatMessage[],
            finalizedAssistantMessage: RuntimeChatMessage | null
          ) => {
            set((state) => {
              const nextPlanProposalsById =
                finalizedAssistantMessage?.planProposal &&
                !state.planProposalsById[finalizedAssistantMessage.planProposal.id]
                  ? {
                      ...state.planProposalsById,
                      [finalizedAssistantMessage.planProposal.id]: finalizedAssistantMessage.planProposal
                    }
                  : state.planProposalsById;
              const syncedRuntimeActions = syncRuntimeAgentActions(messages, nextPlanProposalsById);
              return {
                messages: syncedRuntimeActions.messages,
                agentActionsById: syncedRuntimeActions.agentActionsById,
                planProposalsById: nextPlanProposalsById
              };
            });
          },
          applyPlanningRelevanceGate: async (answer, toolResultCount) => {
            const verifiedPaths = verifiedPathsList(verifiedEvidence);
            const gated = await applyPlanningRelevanceGate({
              answer,
              confirmedGoal: activeTaskContract?.confirmedGoal ?? trimmedContent,
              acceptanceCriteria: activeTaskContract?.acceptanceCriteria ?? [],
              verifiedPaths,
              toolResultCount,
              runId: initialRun.id,
              userQuestion: trimmedContent,
              contractBlock: activeTaskContract
                ? formatActiveTaskContractBlock(activeTaskContract, trimmedContent)
                : `[ACTIVE TASK]\n${trimmedContent}`,
              routing,
              slotId: contextSlotId as RuntimeSlotId | null,
              decisionId: brokerDecisionFull?.decisionId ?? initialRun.id,
              signal: runAbortController.signal,
              traceEvents: safeTraceEvents
            });
            if (gated.outcome === "answer_relevance_failed") {
              updateActiveRun((r) => ({
                ...r,
                outcome: "answer_relevance_failed",
                status: "failed"
              }));
            }
            return gated;
          }
        }
      });
      const {
        resultMessages,
        finalizedAssistantMessage,
        assistantContent,
        patchDetected,
        patchCount,
        runtimeToolSummaries,
        streamToolNames
      } = streamProcessing;

      const streamFinalizationResult = await finalizeStreamingResponseArtifacts({
        initialRunId: initialRun.id,
        response,
        resultMessages,
        finalizedAssistantMessage,
        assistantContent,
        streamToolNames,
        completedToolCalls: runtimeToolSummaries.length,
        routing,
        contextSlotId: contextSlotId as RuntimeSlotId | null,
        executionIntentForTurn,
        trimmedContent,
        toolsEnabled,
        workspaceRoot: sendOptions?.workspaceRoot ?? null,
        priorOutcome: get().activeRun?.outcome ?? null,
        firstTokenAt: get().activeRun?.firstTokenAt,
        tokenBudget: get().activeRun?.tokenBudget,
        safeTraceEvents,
        ragManifest: ragResult?.manifest,
        ragSourceReferences: ragResult?.sourceReferences,
        spoolerManifest,
        reasoningTraceEnabled: runtimeFlags.reasoningTraceEnabled !== false,
        persistTraceEvents: (events) => traceClient.append(initialRun.id, events),
        startedAt: get().activeRun?.startedAt
      });
      const {
        resultMessages: finalizedResultMessages,
        finalization: streamFinalization,
        persistedStreamTurn
      } = streamFinalizationResult;
      const streamSummary = buildSendCompletionSummary({
        startedAt,
        outcome: streamFinalization.outcome,
        userMessage: streamFinalization.userMessage
      });

      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary: streamSummary
        })
      );

      updateActiveRun((r) =>
        appendRunEvent(
          {
            ...updateRunStatus(r, streamFinalization.status),
            outcome: streamFinalization.outcome,
            provider: sendOptions?.provider ?? routing.providerId ?? brokerDecisionFull?.providerId ?? r.provider,
            modelId: response.model_id ?? routing.modelId ?? r.modelId,
            modelName: response.model_name ?? routing.modelName ?? r.modelName,
            slotId: contextSlotId ?? r.slotId,
            configuredModelId: routing.configuredModelId ?? response.model_id ?? r.configuredModelId,
            selectionSource: routing.selectionSource ?? r.selectionSource,
            warmupStatus: routing.warmupStatus ?? r.warmupStatus,
            turns: upsertRunTurn(r, persistedStreamTurn).turns,
            finalAnswerDiagnostics: streamFinalization.diagnostics as unknown as Record<string, unknown>
          },
          streamFinalization.outcome === "success"
            ? "chat.completed"
            : streamFinalization.outcome === "needs_user_input"
              ? "chat.accepted"
              : "chat.failed",
          streamFinalization.userMessage
        )
      );
      finalizeSendState({
        set,
        get,
        activity: markActivityFailure(activity, streamSummary),
        errorMessage: shouldClearSendError(streamFinalization.outcome)
          ? null
          : streamFinalization.userMessage,
        statePatch: (state) => {
          const syncedRuntimeActions = syncRuntimeAgentActions(
            finalizedResultMessages,
            state.planProposalsById
          );
          const streamTargetMessage =
            streamFinalizationResult.assistantIndex >= 0
              ? finalizedResultMessages[streamFinalizationResult.assistantIndex]
              : null;
          const messagesWithFollowUps = streamTargetMessage
            ? attachFollowUpActionsToMessages({
                messages: syncedRuntimeActions.messages,
                finalizedAssistantMessage: streamTargetMessage,
                run: state.activeRun,
                taskType,
                hasPlanProposal: Boolean(streamTargetMessage.planProposal),
                hasPatchProposal: Boolean(streamTargetMessage.patchProposalId),
                workspaceRoot: sendOptions?.workspaceRoot ?? null
              })
            : syncedRuntimeActions.messages;
          return {
            messages: messagesWithFollowUps,
            agentActionsById: syncedRuntimeActions.agentActionsById
          };
        }
      });
      return streamFinalizationResult.success;
    } catch (error) {
      safeTraceEvents.push(createTraceEvent(initialRun.id, "run_failed", "Ausführung fehlgeschlagen", error instanceof Error ? error.message : "Unbekannter Fehler", "failed"));
      if (useSettingsStore.getState().settings.reasoningTraceEnabled !== false) {
        void traceClient.append(initialRun.id, safeTraceEvents).catch(() => undefined);
      }
      if (initialRun.id && runsAbortControllers[initialRun.id]) {
        delete runsAbortControllers[initialRun.id];
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const phaseTimeoutMatch = errorMessage.match(
        /(Prompt-Eval-Timeout|First-Token-Timeout|Stream-Idle-Timeout|Generation-Timeout)/i
      );
      const phaseTimeoutKind: PhaseTimeoutKind | null = /Prompt-Eval-Timeout/i.test(errorMessage)
        ? "prompt_eval_timeout"
        : /First-Token-Timeout/i.test(errorMessage)
          ? "first_token_timeout"
          : /Stream-Idle-Timeout/i.test(errorMessage)
            ? "stream_idle_timeout"
            : /Generation-Timeout/i.test(errorMessage)
              ? "generation_timeout"
              : null;
      const isAbortLike =
        error instanceof Error && (
          error.name === "AbortError" ||
          error.message === "aborted" ||
          /aborted/i.test(error.message) ||
          Boolean(phaseTimeoutKind)
        );
      if (isAbortLike) {
        if (phaseTimeoutKind) {
          failStep("llm-request", "Modell-Anfrage senden", errorMessage);
          const partialContentExists =
            phaseTimeoutKind === "stream_idle_timeout" &&
            get().messages.some(
              (message) => message.role === "assistant" && message.content.trim().length > 0
            );
          const outcome: RuntimeRunOutcome = partialContentExists
            ? "partial_output_stream_incomplete"
            : outcomeForPhaseTimeout(phaseTimeoutKind);
          const finalized = finalizePhaseTimeoutRun({
            runId: initialRun.id,
            outcome,
            modelId: routing?.modelId,
            modelName: routing?.modelName,
            slotId: routing?.slotId,
            firstTokenReceived:
              Boolean(get().activeRun?.firstTokenAt) ||
              phaseTimeoutKind === "stream_idle_timeout" ||
              phaseTimeoutKind === "generation_timeout"
          });
          appendTimeoutFailure({
            updateActiveRun,
            outcome: finalized.outcome,
            userMessage: finalized.userMessage
          });
          finalizeSendState({
            set,
            get,
            activity: markActivityFailure(activity, finalized.userMessage),
            errorMessage: finalized.userMessage
          });
          return false;
        }
        failStep("llm-request", "Modell-Anfrage senden", "Abgebrochen");
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "cancelled"), "chat.cancelled", "Abgebrochen"));
        finalizeSendState({
          set,
          get,
          activity: markActivityFailure(activity, "Abgebrochen"),
          errorMessage: null
        });
        return false;
      }

      if (error instanceof BindingModelError) {
        const errMsg = `${error.message}${error.options.length ? ` Optionen: ${error.options.join(" · ")}` : ""}`;
        failStep("llm-request", "Modell-Anfrage senden", errMsg);
        const outcome: RuntimeRunOutcome =
          error.code === "runtime_oom"
            ? "runtime_oom"
            : error.code === "slot_busy"
              ? "runtime_error"
              : error.code === "binding_mismatch"
                ? "runtime_start_failed"
                : "warmup_failed";
        appendGenericRunFailure({
          updateActiveRun,
          outcome,
          summary: errMsg,
          error: { code: error.code, message: errMsg, phase: "runtime" }
        });
        finalizeSendState({
          set,
          get,
          activity: markActivityFailure(activity, errMsg),
          errorMessage: errMsg
        });
        return false;
      }

      if (isRuntimeNotRunningError(error)) {
        await refreshRuntimeStatus(null);
        failStep("llm-request", "Modell-Anfrage senden", "Runtime nicht mehr aktiv");
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "failed"), "chat.failed", "Runtime offline"));
        finalizeSendState({
          set,
          get,
          activity: markActivityFailure(activity, "Fehler: Runtime gestoppt"),
          errorMessage: "Runtime ist nicht mehr aktiv. Bitte Modell im Runtime-Panel erneut starten."
        });
        return false;
      }

      failStep(
        "llm-request",
        "Modell-Anfrage senden",
        error instanceof Error ? error.message : "Unbekannter Fehler"
      );
      const backendErrorDetail = extractRuntimeBackendErrorDetail(error);
      
      const runError: import("@dbzs/shared").RuntimeChatError = {
        code: backendErrorDetail?.code ?? (isTransientChatTransportError(error) ? "TRANSPORT_ERROR" : "UNKNOWN_ERROR"),
        message: backendErrorDetail?.message ?? (error instanceof Error ? error.message : "Unbekannter Fehler"),
        phase: backendErrorDetail?.stage ?? "llm-request",
        provider: routing?.providerId ?? undefined,
        endpoint: routing?.modelId ?? undefined,
        requestId: backendErrorDetail?.diagnosticId ?? undefined
      };

      appendGenericRunFailure({
        updateActiveRun,
        outcome: "runtime_error",
        summary: backendErrorDetail?.code ? `${runError.message} [${backendErrorDetail.code}]` : runError.message,
        error: runError
      });

      const userFacingError = isTransientChatTransportError(error)
        ? "Verbindung zum Backend war kurz unterbrochen. Bitte Nachricht erneut senden."
        : genericSendErrorMessage(error);

      finalizeSendState({
        set,
        get,
        activity: markActivityFailure(
          activity,
          `Fehler: ${error instanceof Error ? error.message : "unbekannt"}`
        ),
        errorMessage: userFacingError,
        messagesOverride: buildTrimmedFailureMessages(get().messages)
      });
      return false;
    } finally {
      if (initialRun.id && runsAbortControllers[initialRun.id]) {
        delete runsAbortControllers[initialRun.id];
      }
      resetFirstTokenTimeout();
      clearTimeout(totalTimeout);
    }
  },

  sendPresetPrompt: async (preset, runtimeStatus, activeFile, workspaceContext, contextHint, sendOptions) => {
    const presetMessage = PRESET_MESSAGES[preset];
    return get().sendMessage(
      presetMessage,
      runtimeStatus,
      activeFile,
      workspaceContext,
      contextHint,
      targetAgentForPreset(preset),
      sendOptions
    );
  },

  compactConversation: () => {
    const currentMessages = get().messages;
    if (currentMessages.length < 6) {
      return;
    }

    const keepTail = currentMessages.slice(-4);
    const candidates = currentMessages.slice(0, -4);
    const significant = candidates.filter(isSignificantConversationTurn);
    const droppedCount = candidates.length - significant.length;

    const topics = significant.slice(-6).map((message) => message.content.slice(0, 60).replace(/\s+/g, " ").trim());
    const digestLines = [`Conversation compacted: ${droppedCount} Nachrichten zusammengefasst, ${significant.length} wichtige Nachrichten beibehalten.`];
    if (topics.length > 0) {
      digestLines.push("Beibehaltene Themen:", ...topics.map((topic) => `- ${topic}`));
    }
    const summary: RuntimeChatMessage = {
      id: `msg-${Date.now().toString(36)}-system`,
      role: "system",
      content: digestLines.join("\n")
    };

    const compactedMessages = [summary, ...significant, ...keepTail];
    const syncedRuntimeActions = syncRuntimeAgentActions(compactedMessages, get().planProposalsById);
    set({ messages: syncedRuntimeActions.messages, agentActionsById: syncedRuntimeActions.agentActionsById, error: null });
  },

  clear: () =>
    set({
      messages: [],
      agentActionsById: {},
      planProposalsById: {},
      patchProposalsById: {},
      patchPreviewsById: {},
      activePatchProposal: null,
      activePatchPreview: null,
      patchState: null,
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null,
      pendingJobContextHint: null,
      activeWebSearches: [],
      activeWebFetches: [],
      webResearchStatus: "idle",
      webResearchError: null,
      webResearchCitations: [],
      error: null,
      isSending: false,
      isStreaming: false,
      currentActivity: null,
      lastActivity: null,
      lastRouting: null,
      lastBrokerDecision: null,
      activeRun: null,
      historicalRuns: {}
    }),

  clearActivityHistory: () =>
    set({
      lastActivity: null,
      activeRun: null,
      historicalRuns: {}
    })
}));

registerIdleEvictionActiveRunGuard(() => {
  const state = useRuntimeChatStore.getState();
  return state.isSending || Boolean(state.activeRun && !state.activeRun.finishedAt);
});
startWorkModelIdleWatcher();
startRuntimeProcessSupervisor();
