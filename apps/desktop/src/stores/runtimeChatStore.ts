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
  applyCpuSafeTimeoutOverrides,
  applySettingsTimeoutOverrides,
  residentSlotTimeoutOverrides,
  selectTimeoutProfile,
  shouldApplySlowInferenceTimeouts,
  TimeoutManager
} from "@/services/timeoutConfig";
import { classifyRuntimeChatError, formatChatErrorForUser } from "@/services/runtimeChatErrorClassifier";
import { approvalCoordinator } from "@/services/approvalCoordinator";
import { questionCoordinator } from "@/services/questionCoordinator";
import { clearPendingQuestion, readPendingQuestion } from "@/services/pendingQuestionPersistence";
import { buildRuntimeAgentActionRegistry } from "@/services/runtimeAgentActions";
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
  mapWorkflowScopeTextAlias,
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
import {
  assessResourcePlanRisk,
  buildResourceRiskQuestion,
  hasAcceptedResourceRisk,
  markResourceRiskAccepted,
  requiresExplicitResourceRiskDecision
} from "@/services/runtimeResourceRisk";
import { gateSlotForRequest } from "@/services/runtimeSlotExecutionState";
import { checkMissingInformation, workflowForTaskType } from "@/services/missingInformationPolicy";
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
import { verifySlotForRequest } from "@/services/runtimeSlotValidator";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { modelRouterService } from "@/services/modelRouterService";
import { residentModelFromStatus } from "@/services/residentModelHelpers";
import { directIntentClassifier } from "@/services/directIntentClassifier";
import { classifyTaskForSend } from "@/services/runtimeChat/taskClassificationPhase";
import { resolveWorkflowContinuationForSend } from "@/services/runtimeChat/workflowContinuationPhase";
import { runReviewRemediationPhase } from "@/services/runtimeChat/reviewRemediationPhase";
import { mapBrokerAgentToShared, mapWorkflowAgentToShared } from "@/services/runtimeChat/agentMapping";
import { isClarificationFieldBlockedInMessages } from "@/services/runtimeChat/clarificationGuards";
import { useModelIndexStore } from "@/stores/modelIndexStore";
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
  serializeMessagesForHash,
  type PreparedRuntimeRequest,
  type PromptBindingDiagnostics,
  type ProviderRequestDiagnostics
} from "@/services/preparedRuntimeRequest";
import {
  assertRuntimeBindingConsistency,
  createRuntimeBindingDecision,
  type RuntimeBindingDecision
} from "@/services/runtimeBinding";
import { assertValidPhaseAgentPair } from "@/services/phaseAgentInvariant";
import { isModelContentDelta } from "@/services/providerRuntimeEvents";
import {
  estimateProviderToolBudget,
  messagesAlreadyIncludeToolCatalog
} from "@/services/providerToolBudget";
import { evaluateProviderRequestPreflight } from "@/services/providerRequestPreflight";
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
import { handleResidentFallback } from "@/services/fallbackHandler";
import { pathValidatorService } from "@/services/pathValidatorService";
import { RUNTIME_SLOT_DEFINITIONS, type ContextManifest, type RuntimeTaskType, type RuntimeSlotId, type ContextStage, type RuntimeRunOutcome } from "@dbzs/shared";
import { WORKFLOW_POLICY_VERSION } from "@/runtime/workflow/workflowPolicyRegistry";

const MAX_CONTEXT_CHARS = 16_000;
const MAX_HISTORY_MESSAGES = 50;
const TOOLS_ENABLED_STORAGE_KEY = "dbzs-runtime-chat-tools-enabled";
const STREAMING_UI_THROTTLE_MS = 40;

const runsAbortControllers: Record<string, AbortController> = {};

interface WorkspaceContextPathNormalizationResult {
  normalized: string[];
  rejected: string[];
}

function summarizeRejectedContextPath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, "/");
  if (!normalized) return "<empty>";
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//") || normalized.startsWith("/")) {
    return "<absolute path rejected>";
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export async function normalizeWorkspaceContextPathCandidates(
  workspaceRoot: string,
  values: string[],
  normalizer?: (workspaceRoot: string, candidates: string[]) => Promise<string[]>
): Promise<WorkspaceContextPathNormalizationResult> {
  const normalized: string[] = [];
  const rejected: string[] = [];
  for (const value of values) {
    try {
      const [result] = normalizer
        ? await normalizer(workspaceRoot, [value])
        : [value.replace(/\\/g, "/")];
      if (result) normalized.push(result);
      else rejected.push(summarizeRejectedContextPath(value));
    } catch {
      rejected.push(summarizeRejectedContextPath(value));
    }
  }
  return { normalized, rejected };
}

function loadToolsEnabled(): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }
  return localStorage.getItem(TOOLS_ENABLED_STORAGE_KEY) !== "0";
}

const STOPPED_RUNTIME_STATUS: RuntimeStatus = {
  state: "stopped",
  provider: null,
  model_id: null,
  model_name: null,
  port: null,
  pid: null,
  endpoint: null,
  message: ""
};

export interface RuntimeChatSendOptions {
  includeWorkspaceContext?: boolean;
  workspaceRoot?: string | null;
  workspaceName?: string | null;
  workspaceFiles?: WorkspaceProjectFile[];
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


function resolveContextSlotId(taskType: string, slotId?: string | null): "quality_cpu" | "fast_gpu" | "utility" {
  if ((slotId === "quality_cpu" || slotId === "fast_gpu" || slotId === "utility") &&
      RUNTIME_SLOT_DEFINITIONS[slotId].supportedTasks.includes(taskType as never)) {
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

function isImplementationWorkflowPhase(phase: string | null | undefined): boolean {
  return phase === "implementation" || phase === "executing" || phase === "awaiting_patch_approval";
}

function normalizeImplementationTaskType(
  taskType: RuntimeTaskType,
  contractTaskType?: RuntimeTaskType
): RuntimeTaskType {
  const candidate =
    contractTaskType && contractTaskType !== "planning" && contractTaskType !== "architecture"
      ? contractTaskType
      : taskType;
  switch (candidate) {
    case "large_code_change":
    case "small_code_change":
    case "refactoring":
      return candidate;
    default:
      return "small_code_change";
  }
}

export function normalizeImplementationContinuationRouting(input: {
  phase?: string | null;
  taskType: RuntimeTaskType;
  contractTaskType?: RuntimeTaskType;
  targetAgent: ModelTargetAgent;
  preferPlannerFirst: boolean;
}): {
  taskType: RuntimeTaskType;
  targetAgent: ModelTargetAgent;
  preferPlannerFirst: boolean;
  normalized: boolean;
} {
  if (!isImplementationWorkflowPhase(input.phase)) {
    return {
      taskType: input.taskType,
      targetAgent: input.targetAgent,
      preferPlannerFirst: input.preferPlannerFirst,
      normalized: false
    };
  }

  return {
    taskType: normalizeImplementationTaskType(input.taskType, input.contractTaskType),
    targetAgent: "coder",
    preferPlannerFirst: false,
    normalized: true
  };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${label} hat länger als ${timeoutMs / 1000}s gedauert`));
    }, timeoutMs);
  });

  if (signal) {
    if (signal.aborted) {
      if (timeoutId) clearTimeout(timeoutId);
      return Promise.reject(signal.reason || new Error("Cancelled"));
    }

    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(signal.reason || new Error("Cancelled"));
      });
    });

    return Promise.race([promise, timeoutPromise, abortPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function refreshRuntimeStatus(fallback: RuntimeStatus | null): Promise<RuntimeStatus> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const status = await backendClient.getRuntimeStatus();
      useRuntimeStore.setState({ status });
      return status;
    } catch {
      if (attempt < 2) {
        await sleep(200 * (attempt + 1));
      }
    }
  }

  try {
    const slots = await runtimeSlotManager.getAllSlotsStatus();
    const readySlot = slots.find((slot) => runtimeSlotManager.isSlotReady(slot));
    const runningSlot = readySlot ?? slots.find((slot) => slot.state === "running");
    if (runningSlot) {
      const status: RuntimeStatus = {
        state: runningSlot.state,
        provider: runningSlot.provider === "llama.cpp" || runningSlot.provider === "ollama" ? runningSlot.provider : null,
        model_id: runningSlot.model_id,
        model_name: runningSlot.model_name,
        port: runningSlot.port,
        pid: runningSlot.pid,
        endpoint: runningSlot.endpoint,
        message: runningSlot.message ?? `Slot ${runningSlot.slot_id} ist aktiv.`,
        stderr_tail: runningSlot.stderr_tail ?? undefined,
        stdout_tail: runningSlot.stdout_tail ?? undefined
      };
      useRuntimeStore.setState({ status });
      return status;
    }
  } catch {
    // Slot-Fallback ist best effort; darunter greifen bestehende Fallbacks.
  }

  const storeStatus = useRuntimeStore.getState().status;
  if (storeStatus?.state === "running") {
    return storeStatus;
  }

  if (fallback?.state === "running") {
    return fallback;
  }

  return fallback ?? STOPPED_RUNTIME_STATUS;
}

interface RuntimeChatState {
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

function buildFileContext(activeFile: WorkspaceFile | null) {
  if (!activeFile) {
    return null;
  }

  return {
    path: activeFile.path,
    language: activeFile.language,
    content: activeFile.content.slice(0, MAX_CONTEXT_CHARS)
  };
}

function buildWorkspaceLaneItems(
  workspaceContext: RuntimeChatWorkspaceContext | null | undefined,
  fallbackMessage: string | null
): SpoolerLaneItem[] {
  if (!workspaceContext) {
    return fallbackMessage
      ? [{
          id: "active-task-workspace",
          content: fallbackMessage,
          estimatedTokens: estimateTokensCharHeuristic(fallbackMessage)
        }]
      : [];
  }

  const fileTreePreview = workspaceContext.fileTree
    .slice(0, 40)
    .map((entry) => `- ${entry}`)
    .join("\n");
  const summary = [
    "[Workspace Context]",
    `Name: ${workspaceContext.name}`,
    `Root: ${workspaceContext.rootPath}`,
    "",
    "Project file tree (preview):",
    fileTreePreview || "- (leer)"
  ].join("\n");

  return [
    {
      id: "active-task-workspace-summary",
      content: summary,
      estimatedTokens: estimateTokensCharHeuristic(summary)
    },
    ...workspaceContext.sampledFiles.map((file, index) => {
      const content = `### ${file.relativePath} (${file.language})\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
      return {
        id: `active-task-workspace-file-${index}`,
        source: file.relativePath,
        dedupeContent: file.content,
        content,
        estimatedTokens: estimateTokensCharHeuristic(content),
        pinned: true
      };
    })
  ];
}

const PRESET_MESSAGES: Record<"plan" | "refactor" | "review" | "summarize" | "next_steps", string> = {
  plan: "Erstelle einen klaren Implementierungsplan mit konkreten Schritten, Risiken und Tests.",
  refactor: "Schlage einen sicheren Refactor vor (kleine Schritte, Diff-freundlich, mit Validierung).",
  review: "Fuehre ein fokussiertes Code-Review durch: Risiken, Regressionen, fehlende Tests.",
  summarize: "Fasse den aktuellen Stand knapp zusammen: Fortschritt, offene Punkte, naechster Schritt.",
  next_steps: "Gib die naechsten 3 priorisierten Schritte inklusive kurzer Begruendung an."
};

function looksLikeAgentChangeJson(content: string): boolean {
  return looksLikeAgentChangePayload(content);
}

const SIGNIFICANT_TURN_PATTERN = /\b(fehler|error|falsch|nicht funktioniert|bug|failed|exception|korrektur|correct(ed|ion)?|achtung|warnung|warning)\b/i;

/**
 * Decisions, corrections, and errors survive conversation compaction as
 * literal messages; everything else gets folded into the one-line digest
 * compactConversation produces. Not just "keep the last N" — a plain chat
 * turn from 20 messages ago is compactable, but an approval decision or a
 * failed-test result from the same point is not.
 */
function isSignificantConversationTurn(message: RuntimeChatMessage): boolean {
  if (message.actions && message.actions.length > 0) {
    return true; // plan/patch approval decisions
  }
  if (message.toolCalls?.some((call) => call.status === "error")) {
    return true;
  }
  return SIGNIFICANT_TURN_PATTERN.test(message.content);
}

function createMessageId(prefix: string): string {
  return `msg-${Date.now().toString(36)}-${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}

function appendSystemPatchMessage(
  set: (updater: (state: RuntimeChatState) => Partial<RuntimeChatState>) => void,
  content: string,
  actions?: import("@dbzs/shared").ChatActionRequest[]
): string {
  const messageId = createMessageId("patch");
  set((state) => ({
    messages: [
      ...state.messages,
      {
        id: messageId,
        role: "system",
        content,
        actions
      }
    ]
  }));
  return messageId;
}

function syncRuntimeAgentActions(
  messages: RuntimeChatMessage[],
  planProposalsById: Record<string, AgentPlanProposal>
): Pick<RuntimeChatState, "messages" | "agentActionsById"> {
  return buildRuntimeAgentActionRegistry(messages, { planProposalsById });
}

function validationCommandIds(commands: string[] | undefined): string[] {
  const allowed = new Set(["pnpm_typecheck", "pnpm_test", "npm_run_typecheck", "npm_test"]);
  return [...new Set((commands ?? []).filter((command) => allowed.has(command)))];
}

async function runPatchValidation(
  workspaceRoot: string,
  proposal: AgentPatchProposal
): Promise<PatchValidationResult | null> {
  const executeSafeCommand = window.dbzs.executeSafeCommand;
  const getSafeCommandRunStatus = window.dbzs.getSafeCommandRunStatus;
  const streamSafeCommandLogs = window.dbzs.streamSafeCommandLogs;
  const commands = validationCommandIds(proposal.validationCommands);
  if (!executeSafeCommand || !getSafeCommandRunStatus || commands.length === 0) {
    return null;
  }

  const results: PatchValidationResult["commands"] = [];
  for (const commandId of commands) {
    let run = await executeSafeCommand(workspaceRoot, commandId);
    
    // Poll until the command is finished (no longer 'running')
    const pollIntervalMs = 250;
    while (run.status === "running") {
      await sleep(pollIntervalMs);
      run = await getSafeCommandRunStatus(run.runId);
    }

    let stdout = "";
    let stderr = "";
    if (streamSafeCommandLogs) {
      try {
        const logs = await streamSafeCommandLogs(run.runId);
        stdout = logs.stdout ?? "";
        stderr = logs.stderr ?? "";
      } catch {
        // Command status remains the source of truth.
      }
    }
    results.push({
      commandId,
      exitCode: typeof run.exitCode === "number" ? run.exitCode : null,
      stdout,
      stderr
    });
  }

  return {
    proposalId: proposal.id,
    success: results.every((result) => result.exitCode === 0),
    commands: results
  };
}


async function refreshWorkspaceAfterPatch(workspaceRoot: string, filePaths: string[]): Promise<void> {
  try {
    await Promise.allSettled([
      useWorkspaceStore.getState().scanFiles(),
      useGitStore.getState().refreshGitStatus()
    ]);
  } catch {
    // Refresh after patching should never block the approval flow.
  }

  const editor = useEditorStore.getState();
  const tabs = editor?.tabs ?? [];
  for (const filePath of filePaths) {
    try {
      const absolutePath = filePath.includes(":") ? filePath : `${workspaceRoot.replace(/[\\/]+$/, "")}\\${filePath.replace(/\//g, "\\")}`;
      const openTab = tabs.find((tab) => tab.type === "file" && (tab.path === absolutePath || tab.path.endsWith(filePath)));
      if (openTab?.type === "file") {
        await editor.openWorkspaceFile(openTab.path);
      }
    } catch {
      // Best-effort refresh only.
    }
  }
}

export const REASONING_SYSTEM_HINT = `
Du musst jede finale Antwort oder Aktion mit einer strukturierten Begründung und Ablaufzusammenfassung in folgendem XML-Format beginnen:
<reasoning-summary>
{
  "title": "Kurzer, prägnanter Titel der Aktion oder Strategie",
  "summary": "1 bis 3 Sätze Zusammenfassung, warum dieser Weg gewählt wird",
  "steps": ["Schritt 1", "Schritt 2"],
  "assumptions": ["Optionale Annahme 1"],
  "risks": ["Optionales Risiko 1"],
  "nextAction": "Optionale nächste geplante Aktion oder Tool-Name"
}
</reasoning-summary>

Wenn ein ausführbarer Plan erforderlich ist, muss zusätzlich ein separater <plan>-Block erzeugt werden:
<plan>
{
  "type": "agent_plan_proposal",
  "version": 1,
  "id": "plan-123",
  "runId": "run-123",
  "title": "Geplanter Ablauf",
  "summary": "Kurze Zusammenfassung",
  "steps": [
    {
      "id": "step-1",
      "title": "Dateien analysieren",
      "description": "Relevante Dateien prüfen.",
      "riskLevel": "low"
    }
  ],
  "createdAt": "2026-07-02T00:00:00.000Z",
  "state": "proposed"
}
</plan>

WICHTIG:
- Reasoning Summary ist kein Plan.
- Planinformationen dürfen nicht in reasoning-summary.steps versteckt werden.
- Wenn ein ausführbarer Plan erforderlich ist, muss zusätzlich ein separater <plan>-Block erzeugt werden.
- Ein Coding-Auftrag darf nicht nur mit reasoning-summary enden.
- Wenn direkte Dateiänderungen erforderlich sind, muss zusätzlich propose_file_changes verwendet werden.
- Gib keinen unvollständigen oder provisorischen Plan frei.
- Erzeuge niemals Roh-CoT, private Tokens oder Secrets im XML-Block.

Beispiele:
- Gut: reasoning-summary + separater plan-Block bei komplexen oder mehrstufigen Aufgaben.
- Gut: nur reasoning-summary bei trivialen Antworten ohne zusätzlichen Plan.
- Schlecht: Planinformationen als JSON in reasoning-summary.steps.
- Schlecht: nur allgemeine Planbeschreibung ohne gültigen <plan>-Block bei einem echten Coding- oder Ausführungsplan.
`;

export function extractReasoningSummary(content: string): {
  reasoningSummary: import("@dbzs/shared").AgentReasoningSummary | undefined;
  planProposal: import("@dbzs/shared").AgentPlanProposal | undefined;
  cleanContent: string;
} {
  const payload = parseAssistantPayload(content);
  return {
    // Legacy blocks are parsed only so they can be removed from visible text.
    // They are deliberately not persisted: safe summaries come from real trace events.
    reasoningSummary: undefined,
    planProposal: payload.planProposal,
    cleanContent: payload.visibleText
  };
}

export function mergeAssistantMessageState(
  existingMessage: RuntimeChatMessage,
  incomingMessage: Partial<RuntimeChatMessage> & Pick<RuntimeChatMessage, "content"> & { planProposal?: import("@dbzs/shared").AgentPlanProposal },
  options?: { allowActionCreation?: boolean; structuredParse?: "final" | "none"; workspaceRoot?: string }
): RuntimeChatMessage {
  const shouldParseStructured = options?.structuredParse !== "none";
  const incomingRawContent = incomingMessage.rawContent ?? incomingMessage.content ?? existingMessage.rawContent ?? existingMessage.content;
  const incomingVisibleContent = incomingMessage.visibleContent ?? incomingMessage.content ?? existingMessage.visibleContent ?? existingMessage.content;
  const payload = shouldParseStructured
    ? parseAssistantPayload(incomingRawContent)
    : {
        visibleText: incomingVisibleContent || incomingRawContent || existingMessage.visibleContent || existingMessage.content,
        reasoningSummary: undefined,
        planProposal: undefined,
        parseState: "none" as const,
        toolCalls: [],
        warnings: []
      };
  const mergedContent = shouldParseStructured
    ? payload.visibleText || incomingVisibleContent || incomingRawContent || existingMessage.content
    : incomingVisibleContent || incomingRawContent || existingMessage.visibleContent || existingMessage.content;
  const mergedRawContent = incomingRawContent ?? existingMessage.rawContent ?? mergedContent;
  const mergedVisibleContent = shouldParseStructured
    ? incomingVisibleContent || payload.visibleText || existingMessage.visibleContent || mergedContent
    : incomingVisibleContent || incomingRawContent || existingMessage.visibleContent || mergedContent;
  const toolCalls: RuntimeChatToolCallRecord[] | undefined =
    incomingMessage.toolCalls ?? existingMessage.toolCalls ??
    (shouldParseStructured
      ? payload.toolCalls.map((call, index) => ({
          id: `parsed-${index + 1}`,
          name: call.name,
          status: "done",
          input: call.arguments,
          outputSummary: undefined
        }))
      : undefined);

  const planActions = incomingMessage.actions ?? existingMessage.actions ?? [];
  const incomingPlanProposal = incomingMessage.planProposal ?? (incomingMessage as RuntimeChatMessage).planProposal;
  const resolvedPlanProposal = shouldParseStructured ? (payload.planProposal ?? incomingPlanProposal) : incomingPlanProposal;
  const planIsValid = (shouldParseStructured && payload.parseState === "valid") || Boolean(
    resolvedPlanProposal &&
    resolvedPlanProposal.type === "agent_plan_proposal" &&
    resolvedPlanProposal.version === 1 &&
    Boolean(resolvedPlanProposal.id)
  );
  const shouldCreatePlanActions = Boolean(
    shouldParseStructured &&
    options?.allowActionCreation !== false &&
    Boolean(options?.workspaceRoot) &&
    planIsValid &&
    resolvedPlanProposal &&
    resolvedPlanProposal.id &&
    resolvedPlanProposal.type === "agent_plan_proposal" &&
    resolvedPlanProposal.version === 1
  );
  const planProposalId = incomingMessage.planProposalId ?? existingMessage.planProposalId ?? resolvedPlanProposal?.id ?? (shouldParseStructured && payload.planProposal ? payload.planProposal.id : undefined);
  const actionWorkspaceRoot = options?.workspaceRoot ?? "";
  const actionWorkspaceId = actionWorkspaceRoot ? workspaceScopeId(actionWorkspaceRoot) : "";

  const nextActions = shouldCreatePlanActions && planProposalId && (!planActions.some((action) => action.kind === "approve_plan" || action.kind === "reject_plan"))
    ? [
        {
          id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
          runId: resolvedPlanProposal?.runId ?? "",
          messageId: incomingMessage.id ?? existingMessage.id,
          workspaceRoot: actionWorkspaceRoot,
          workspaceId: actionWorkspaceId,
          kind: "approve_plan" as const,
          title: "Plan übernehmen",
          description: "Fortfahren mit diesem Plan",
          riskLevel: "medium" as const,
          payload: { planProposalId },
          state: "pending" as const,
          createdAt: new Date().toISOString()
        },
        {
          id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
          runId: resolvedPlanProposal?.runId ?? "",
          messageId: incomingMessage.id ?? existingMessage.id,
          workspaceRoot: actionWorkspaceRoot,
          workspaceId: actionWorkspaceId,
          kind: "reject_plan" as const,
          title: "Ablehnen",
          description: "Plan abbrechen",
          riskLevel: "low" as const,
          payload: { planProposalId },
          state: "pending" as const,
          createdAt: new Date().toISOString()
        }
      ]
    : planActions;

  return {
    ...existingMessage,
    ...incomingMessage,
    content: mergedContent,
    rawContent: mergedRawContent,
    visibleContent: mergedVisibleContent,
    reasoningSummary: incomingMessage.reasoningSummary ?? existingMessage.reasoningSummary ?? (shouldParseStructured ? payload.reasoningSummary : undefined),
    toolCalls,
    actions: nextActions,
    planProposal: resolvedPlanProposal,
    planProposalId,
    patchProposalId: incomingMessage.patchProposalId ?? existingMessage.patchProposalId,
    patchPreviewId: incomingMessage.patchPreviewId ?? existingMessage.patchPreviewId,
    meta: incomingMessage.meta ?? existingMessage.meta
  };
}

export function mergeStreamingAssistantMessage({
  message,
  content,
  rawContent,
  reasoningSummary,
  planProposal,
  toolCalls
}: {
  message: RuntimeChatMessage;
  content: string;
  rawContent?: string;
  reasoningSummary?: import("@dbzs/shared").AgentReasoningSummary;
  planProposal?: import("@dbzs/shared").AgentPlanProposal;
  toolCalls?: RuntimeChatToolCallRecord[];
}): RuntimeChatMessage {
  const streamingContent = rawContent ?? content;
  return mergeAssistantMessageState(message, {
    id: message.id,
    role: message.role,
    content: streamingContent,
    rawContent,
    visibleContent: streamingContent,
    reasoningSummary,
    planProposal,
    toolCalls,
    planProposalId: planProposal?.id
  }, { allowActionCreation: false, structuredParse: "none" });
}

function hasPendingPlanApproval(message: RuntimeChatMessage): boolean {
  if (message.planProposalId && (message.actionIds?.length ?? 0) > 0) {
    return true;
  }
  return Boolean(message.actions?.some((action) => action.kind === "approve_plan" && action.state === "pending"));
}

/**
 * Prevent duplicate clarification cards for the same required field in one workspace.
 * Matches pending or completed actions by requiredField (not random question ids).
 */
function findPendingWorkflowScopeAction(
  messages: RuntimeChatMessage[],
  workspaceId: string
): { messageId: string; action: import("@dbzs/shared").ChatActionRequest } | null {
  for (const message of messages) {
    for (const action of message.actions ?? []) {
      if (action.kind !== "answer_question") continue;
      if (action.state !== "pending") continue;
      if (action.workspaceId !== workspaceId) continue;
      const question = action.payload?.question as { requiredField?: string } | undefined;
      if (question?.requiredField === "workflow_scope_decision") {
        return { messageId: message.id, action };
      }
    }
  }
  return null;
}

const workflowScopeProcessingIds = new Set<string>();

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

function formatChatError(error: unknown): string {
  // P0 Phase 3: Use explicit error classification
  return formatChatErrorForUser(error);
}

async function requestAssistantResponse(
  request: Parameters<typeof agentRunService.sendChatStream>[0],
  onDelta: (delta: string, totalLength: number) => void,
  signal?: AbortSignal
) {
  let lastError: unknown = null;
  let retryAttempts = 0;

  // P0 Phase 3: Explicit error classification with no retry cascade
  // - transport errors: max 1 retry
  // - timeout/abort/others: 0 retries (fail fast)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const streamed = await agentRunService.sendChatStream(
        request,
        { onDelta },
        signal
      );
      if (
        (streamed as { safe_fallback?: boolean }).safe_fallback === true ||
        Boolean((streamed as { provider_error?: unknown }).provider_error)
      ) {
        return streamed;
      }
      if (streamed.message.content.trim().length > 0) {
        return streamed;
      }

      // Einige lokale Runtime-Setups liefern gelegentlich einen leeren Stream.
      // In dem Fall versuchen wir den non-stream Pfad.
      const fallback = await agentRunService.sendChat(request, signal);
      // Never treat safe_fallback / provider_error text as a model content delta.
      if (
        fallback.message.content &&
        !(fallback as { safe_fallback?: boolean }).safe_fallback &&
        !(fallback as { provider_error?: unknown }).provider_error &&
        isModelContentDelta(fallback.message.content)
      ) {
        onDelta(fallback.message.content, fallback.message.content.length);
      }
      return fallback;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      lastError = error;
      const classified = classifyRuntimeChatError(error);

      // Check if we should retry based on error class
      if (!classified.shouldRetry || retryAttempts >= classified.maxRetries) {
        break;
      }

      retryAttempts += 1;
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Chat-Anfrage konnte nicht ausgefuehrt werden.");
}

function targetAgentForPreset(preset: "plan" | "refactor" | "review" | "summarize" | "next_steps"): ModelTargetAgent {
  switch (preset) {
    case "plan":
      return "planner";
    case "refactor":
      return "coder";
    case "review":
      return "reviewer";
    case "summarize":
    case "next_steps":
    default:
      return "runtime_chat";
  }
}

function patchActivityRun(
  run: RuntimeChatActivityRun,
  patch: Partial<RuntimeChatActivityRun>
): RuntimeChatActivityRun {
  return { ...run, ...patch };
}

function patchActivitySteps(
  run: RuntimeChatActivityRun,
  nextSteps: RuntimeChatActivityStep[]
): RuntimeChatActivityRun {
  return { ...run, steps: nextSteps };
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
    const actionWorkspaceRoot = proposal.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
    if (!actionWorkspaceRoot) {
      set({ patchError: "Patch-Freigabe ohne aktiven Workspace wurde verworfen.", patchState: "FAILED" });
      return;
    }
    const actionWorkspaceId = workspaceScopeId(actionWorkspaceRoot);
    // 1. Clear state
    set({
      activePatchProposal: proposal,
      activePatchPreview: null,
      patchState: "PROPOSED",
      patchError: null,
      patchApplyResult: null,
      patchValidationResult: null
    });

    set((state) => ({
      patchProposalsById: {
        ...state.patchProposalsById,
        [proposal.id]: proposal
      }
    }));

    // 2. Create preview
    const preview = await get().previewPatch(proposal);
    if (!preview) {
      return;
    }

    // 3. Associate with last assistant message in state.messages
    const messages = get().messages;
    const lastMsg = messages[messages.length - 1];
    const targetMessageId = (lastMsg && lastMsg.role === "assistant") ? lastMsg.id : `msg-${Date.now().toString(36)}-patch`;

    // 4. Create actions
    const showDiffAction: import("@dbzs/shared").ChatActionRequest = {
      id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
      runId: proposal.runId,
      messageId: targetMessageId,
      workspaceRoot: actionWorkspaceRoot,
      workspaceId: actionWorkspaceId,
      kind: "show_diff",
      title: "Diff anzeigen",
      riskLevel: "low",
      payload: { proposalId: proposal.id },
      state: "pending",
      createdAt: new Date().toISOString()
    };
    const approveAction: import("@dbzs/shared").ChatActionRequest = {
      id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
      runId: proposal.runId,
      messageId: targetMessageId,
      workspaceRoot: actionWorkspaceRoot,
      workspaceId: actionWorkspaceId,
      kind: "approve_patch",
      title: "Übernehmen",
      riskLevel: "medium",
      payload: { proposalId: proposal.id },
      state: "pending",
      createdAt: new Date().toISOString()
    };
    const rejectAction: import("@dbzs/shared").ChatActionRequest = {
      id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
      runId: proposal.runId,
      messageId: targetMessageId,
      workspaceRoot: actionWorkspaceRoot,
      workspaceId: actionWorkspaceId,
      kind: "reject_patch",
      title: "Ablehnen",
      riskLevel: "low",
      payload: { proposalId: proposal.id },
      state: "pending",
      createdAt: new Date().toISOString()
    };

    // 5. Update store maps & messages
    set((state) => {
      const updatedMessages = state.messages.map((m) => {
        if (m.id === targetMessageId) {
          return {
            ...m,
            patchProposalId: proposal.id,
            patchPreviewId: preview.proposalId,
            actions: [showDiffAction, approveAction, rejectAction]
          };
        }
        return m;
      });

      if (!updatedMessages.some(m => m.id === targetMessageId)) {
        updatedMessages.push({
          id: targetMessageId,
          role: "assistant",
          content: `CODEE hat Dateiänderungen vorbereitet.`,
          patchProposalId: proposal.id,
          patchPreviewId: preview.proposalId,
          actions: [showDiffAction, approveAction, rejectAction]
        });
      }

      const syncedRuntimeActions = syncRuntimeAgentActions(updatedMessages, state.planProposalsById);

      return {
        patchProposalsById: {
          ...state.patchProposalsById,
          [proposal.id]: proposal
        },
        patchPreviewsById: {
          ...state.patchPreviewsById,
          [preview.proposalId]: preview
        },
        messages: syncedRuntimeActions.messages,
        agentActionsById: syncedRuntimeActions.agentActionsById,
        activePatchProposal: proposal,
        activePatchPreview: preview,
        patchState: "WAITING_FOR_APPROVAL"
      };
    });
  },

  previewPatch: async (proposal = get().activePatchProposal) => {
    const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
    const previewAgentPatch = window.dbzs.previewAgentPatch;
    if (!proposal || !previewAgentPatch) {
      set({ patchError: "Patch Preview ist nicht verfuegbar.", patchState: "FAILED" });
      return null;
    }
    try {
      const preview = await previewAgentPatch({
        ...proposal,
        workspaceRoot: proposal.workspaceRoot ?? workspaceRoot ?? undefined
      });
      set({
        activePatchProposal: proposal,
        activePatchPreview: { ...preview, state: "WAITING_FOR_APPROVAL" },
        patchState: "WAITING_FOR_APPROVAL",
        patchError: null
      });
      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Patch Preview fehlgeschlagen.";
      set({ patchError: message, patchState: "FAILED" });
      appendSystemPatchMessage(set, `Patch Preview fehlgeschlagen:\n${message}`);
      return null;
    }
  },

  approvePatch: async () => {
    const preview = get().activePatchPreview;
    const approveAgentPatch = window.dbzs.approveAgentPatch;
    if (!preview || !approveAgentPatch) {
      throw new Error("Keine Patch Preview zur Freigabe vorhanden.");
    }
    const approved = await approveAgentPatch(preview.proposalId, preview.approvalVersion);
    set({ activePatchPreview: approved, patchState: "APPROVED", patchError: null });
  },

  rejectPatch: async () => {
    const proposal = get().activePatchProposal;
    const rejectAgentPatch = window.dbzs.rejectAgentPatch;
    if (!proposal || !rejectAgentPatch) {
      return;
    }
    const rejected = await rejectAgentPatch(proposal.id);
    set({ activePatchPreview: rejected, patchState: "REJECTED", patchError: null });
    appendSystemPatchMessage(set, "Patch-Vorschlag wurde verworfen. Es wurden keine Dateien geaendert.");
  },

  applyPatch: async () => {
    const proposal = get().activePatchProposal;
    const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
    const applyAgentPatch = window.dbzs.applyAgentPatch;
    if (!proposal || !workspaceRoot || !applyAgentPatch) {
      set({ patchError: "Patch Apply ist nicht verfuegbar.", patchState: "FAILED" });
      return;
    }
    if (get().patchState === "APPLYING" || get().patchState === "APPLIED" || get().patchState === "PASSED") {
      return;
    }

    try {
      if (get().patchState !== "APPROVED") {
        await get().approvePatch();
      }
      set({ patchState: "APPLYING", patchError: null });
      const result = await applyAgentPatch(proposal.id);
      const touchedFiles = [...result.changedFiles, ...result.deletedFiles];
      set({ patchApplyResult: result, patchState: result.state, patchError: result.errors[0] ?? null });
      await refreshWorkspaceAfterPatch(workspaceRoot, touchedFiles);

      let validation: PatchValidationResult | null = null;
      if (result.applied) {
        validation = await get().validatePatch();
      }

      const remediationContract = readActiveTaskContract(workspaceRoot);
      const remediationCapsule = remediationContract?.reviewRemediation;
      if (remediationCapsule) {
        const io = createElectronReviewWorkspaceIO();
        const [persisted, originalFindings] = await Promise.all([
          loadRemediationState(io, workspaceRoot, remediationCapsule.reviewId),
          loadFindings(io, workspaceRoot, remediationCapsule.reviewId)
        ]);
        if (persisted && originalFindings) {
          const normalizedTouched = touchedFiles.map((file) => file.replace(/\\/g, "/").toLowerCase());
          const selected = new Set(remediationCapsule.selectedFindingIds);
          const affectedIds = new Set(
            originalFindings
              .filter((finding) =>
                selected.has(finding.id) &&
                normalizedTouched.some((file) =>
                  file === finding.path.toLowerCase() ||
                  file.endsWith(`/${finding.path.toLowerCase()}`)
                )
              )
              .map((finding) => finding.id)
          );
          const verificationCommands = validation?.commands.map((command) => command.commandId) ?? [];
          const resolutions = persisted.resolutions.map((resolution) =>
            affectedIds.has(resolution.findingId)
              ? {
                  ...resolution,
                  status: validation?.success ? "verified" as const : result.applied ? "fixed" as const : "failed" as const,
                  changedFiles: touchedFiles,
                  verificationCommands,
                  verificationResult: validation
                    ? validation.success ? "passed" : "failed"
                    : "not_run"
                }
              : resolution
          );
          const verifiedCount = resolutions.filter((resolution) => resolution.status === "verified").length;
          const allDone =
            resolutions.length > 0 &&
            resolutions.every((resolution) =>
              resolution.status === "verified" || resolution.status === "skipped"
            );
          const now = new Date().toISOString();
          await saveRemediationState(io, workspaceRoot, {
            ...persisted,
            status: allDone ? "completed" : result.applied ? "in_progress" : "failed",
            resolutions,
            updatedAt: now
          });
          await saveRemediationReport(
            io,
            workspaceRoot,
            remediationCapsule.reviewId,
            [
              `# Remediation Report · ${remediationCapsule.reviewId}`,
              "",
              `Status: ${allDone ? "completed" : result.applied ? "in_progress" : "failed"}`,
              `Verifiziert: ${verifiedCount}/${resolutions.length}`,
              "",
              "## Findings",
              ...resolutions.map((resolution) =>
                `- ${resolution.findingId}: ${resolution.status}` +
                (resolution.changedFiles.length ? ` · ${resolution.changedFiles.join(", ")}` : "")
              ),
              "",
              "Das originale `findings.json` bleibt unverändert."
            ].join("\n")
          );
          if (verifiedCount > 0 && remediationContract) {
            upsertActiveTaskContract(workspaceRoot, {
              originalRequest: remediationContract.originalRequest,
              confirmedGoal: remediationContract.confirmedGoal,
              acceptanceCriteria: remediationContract.acceptanceCriteria,
              taskType: remediationContract.taskType,
              assignedAgent: "reviewer",
              currentPhase: "review"
            });
          }
        }
      }

      const messageId = createMessageId("patch");
      const rollbackAction: import("@dbzs/shared").ChatActionRequest = {
        id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
        runId: proposal.runId,
        messageId,
        workspaceRoot,
        workspaceId: workspaceScopeId(workspaceRoot),
        kind: "rollback_patch",
        title: "Rollback",
        riskLevel: "medium",
        payload: { proposalId: proposal.id, restorePointId: result.restorePointId },
        state: "pending",
        createdAt: new Date().toISOString()
      };
      
      const testAction: import("@dbzs/shared").ChatActionRequest = {
        id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
        runId: proposal.runId,
        messageId,
        workspaceRoot,
        workspaceId: workspaceScopeId(workspaceRoot),
        kind: "confirm_continue",
        title: "Tests starten",
        riskLevel: "low",
        payload: { proposalId: proposal.id },
        state: "pending",
        createdAt: new Date().toISOString()
      };

      const openFileAction: import("@dbzs/shared").ChatActionRequest = {
        id: `act-${self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7)}`,
        runId: proposal.runId,
        messageId,
        workspaceRoot,
        workspaceId: workspaceScopeId(workspaceRoot),
        kind: "open_file",
        title: "Datei öffnen",
        riskLevel: "low",
        payload: { filePath: proposal.changes[0]?.filePath, filePaths: proposal.changes.map(c => c.filePath) },
        state: "pending",
        createdAt: new Date().toISOString()
      };

      const followUpActions = result.applied ? [testAction, rollbackAction, openFileAction] : [];

      set((state) => {
        const targetMessageId = state.messages.find(m => m.patchProposalId === proposal.id)?.id || messageId;

        const updatedMessages = state.messages.map((m) => {
          if (m.id === targetMessageId) {
            return {
              ...m,
              content: m.content + (result.applied ? "\n\n✓ Änderung angewendet" : "\n\n✗ Änderung konnte nicht angewendet werden."),
              actions: followUpActions
            };
          }
          return m;
        });

        // fallback if msg not found
        if (!updatedMessages.some(m => m.id === targetMessageId)) {
          updatedMessages.push({
            id: targetMessageId,
            role: "assistant",
            content: result.applied ? "✓ Änderung angewendet" : "✗ Änderung konnte nicht angewendet werden.",
            actions: followUpActions,
            patchProposalId: proposal.id
          });
        }

        const syncedRuntimeActions = syncRuntimeAgentActions(updatedMessages, state.planProposalsById);

        return {
          messages: syncedRuntimeActions.messages,
          agentActionsById: syncedRuntimeActions.agentActionsById
        };
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : "Patch Apply fehlgeschlagen.";
      set({ patchError: message, patchState: "FAILED" });
      appendSystemPatchMessage(set, `Patch Apply fehlgeschlagen:\n${message}`);
    }
  },

  rollbackPatch: async (restorePointId?: string) => {
    const targetRestorePointId = restorePointId ?? get().patchApplyResult?.restorePointId;
    const proposal = get().activePatchProposal;
    const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
    const rollbackAgentPatch = window.dbzs.rollbackAgentPatch;
    if (!targetRestorePointId || !workspaceRoot || !rollbackAgentPatch) {
      set({ patchError: "Rollback ist nicht verfuegbar." });
      return;
    }
    const rollback = await rollbackAgentPatch(targetRestorePointId);
    set({ patchApplyResult: rollback, patchState: rollback.state, patchError: rollback.errors[0] ?? null });
    await refreshWorkspaceAfterPatch(workspaceRoot, [...rollback.changedFiles, ...rollback.deletedFiles]);
    
    if (proposal) {
      const targetMessageId = get().messages.find(m => m.patchProposalId === proposal.id)?.id;
      if (targetMessageId) {
        set((state) => {
          const updatedMessages = state.messages.map((m) => {
            if (m.id === targetMessageId) {
              return {
                ...m,
                content: m.content + "\n\nDie Änderung wurde vollständig zurückgerollt.",
                actions: []
              };
            }
            return m;
          });
          return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
        });
      }
    }
  },

  validatePatch: async () => {
    const proposal = get().activePatchProposal;
    const workspaceRoot = proposal?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath;
    if (!proposal || !workspaceRoot) {
      return null;
    }
    set({ patchState: "VALIDATING" });
    const validation = await runPatchValidation(workspaceRoot, proposal);
    set({
      patchValidationResult: validation,
      patchState: validation ? (validation.success ? "PASSED" : "FAILED") : "APPLIED"
    });
    return validation;
  },

  clearPatchState: () => set({
    activePatchProposal: null,
    activePatchPreview: null,
    patchState: null,
    patchError: null,
    patchApplyResult: null,
    patchValidationResult: null
  }),

  continueAgentRunAfterPlanApproval: async ({ runId, planProposalId, messageId }) => {
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
    const workspaceRoot =
      get().activeRun?.workspaceRoot ??
      useWorkspaceStore.getState().state.projectPath ??
      "";
    const workspaceId = workspaceRoot ? workspaceScopeId(workspaceRoot) : "";
    const coderModelId = settings.defaultCoderModelId || settings.defaultModelId || "";
    const handoffIntent =
      mapExecutionIntentToHandoffIntent(classifyUserExecutionIntent(planProposal.title + " " + planProposal.summary)) ??
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
      ...createChatRun(`msg-${Date.now().toString(36)}-plan`, "agent", "agent", true, get().activeRun?.workspaceRoot),
      id: runId,
      status: "resuming_after_plan_approval" as RuntimeChatRunStatus
    };
    set((state) => ({
      activeRun: state.activeRun
        ? updateRunStatus(
            appendRunEvent(
              appendRunEvent(
                state.activeRun,
                "chat.accepted",
                "Plan freigegeben, Lauf wird fortgesetzt"
              ),
              "routing.completed",
              `Handoff Planner → Coder (${handoff.coderModelId || "defaultCoderModelId"}) · Intent ${handoff.executionIntent}`
            ),
            "resuming_after_plan_approval"
          )
        : nextRun
    }));

    const pendingMessage = get().messages.find((m) => m.id === messageId);
    if (pendingMessage) {
      set((state) => {
        const updatedMessages = state.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                content: `${m.content}\n\n[Plan freigegeben: ${planProposal.title}]\n[Handoff: Planner → Coder]`,
                actions: m.actions?.map<import("@dbzs/shared").ChatActionRequest>((action) =>
                  action.kind === "approve_plan" ? { ...action, state: "running" } : action
                )
              }
            : m
        );
        return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
      });
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
      pendingJobContextHint: state.pendingJobContextHint
        ? `${state.pendingJobContextHint}\n\n${pendingContextHint}`
        : pendingContextHint
    }));

    // Resume execution with coder role (preferPlannerFirst=false).
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
  },

  handleChatAction: async (actionId, messageId, approve, workspaceId) => {
    const msg = get().messages.find(m => m.id === messageId);
    if (!msg || !msg.actions) return;
    
    const action = msg.actions.find(a => a.id === actionId);
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
        set((state) => ({ messages: state.messages.map((entry) => entry.id === messageId
          ? { ...entry, traceEvents: trace.events, safeReasoningSummary: trace.summary }
          : entry) }));
      }).catch((error) => console.warn("Approval trace persistence failed:", error));
    }

    set((state) => {
      const updatedMessages = state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              actions: m.actions?.map<import("@dbzs/shared").ChatActionRequest>((a) =>
                a.id === actionId
                  ? { ...a, state: approve ? "approved" : "rejected" }
                  : { ...a, state: a.state === "pending" ? "expired" : a.state }
              )
            }
          : m
      );
      return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
    });

    try {
      if (approve) {
        if (action.kind === "show_diff") {
          const preview = get().activePatchPreview;
          const proposal = get().activePatchProposal;
          if (preview && proposal) {
            set((state) => {
              const updatedMessages = state.messages.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      content: `${m.content}\n\nDiff für ${proposal.title}:\n${preview.previews.map((p) => p.diff).join("\n\n")}`
                    }
                  : m
              );
              return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
            });
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
              agentActionsById: syncRuntimeAgentActions(state.messages, nextPlanProposalsById).agentActionsById
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
        
        set((state) => {
          const updatedMessages = state.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  actions: m.actions?.map<import("@dbzs/shared").ChatActionRequest>((a) =>
                    a.id === actionId ? { ...a, state: "completed" } : a
                  )
                }
              : m
          );
          return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
        });
      } else {
        if (action.kind === "reject_patch") {
          await get().rejectPatch();
        } else if (action.kind === "reject_plan") {
          set((state) => {
            const nextPlanProposalsById = {
              ...state.planProposalsById,
              [action.payload.planProposalId as string]: {
                ...(state.planProposalsById[action.payload.planProposalId as string] ?? {}),
                state: "rejected"
              } as AgentPlanProposal
            };
            return {
              activeRun: state.activeRun
                ? updateRunStatus(
                    appendRunEvent(state.activeRun, "chat.cancelled", "Plan abgelehnt"),
                    "cancelled"
                  )
                : state.activeRun,
              planProposalsById: nextPlanProposalsById,
              agentActionsById: syncRuntimeAgentActions(state.messages, nextPlanProposalsById).agentActionsById
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
        
        set((state) => {
          const updatedMessages = state.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  actions: m.actions?.map<import("@dbzs/shared").ChatActionRequest>((a) =>
                    a.id === actionId ? { ...a, state: "rejected" } : a
                  )
                }
              : m
          );
          return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
        });
      }
    } catch (err) {
      set((state) => {
        const updatedMessages = state.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                actions: m.actions?.map<import("@dbzs/shared").ChatActionRequest>((a) =>
                  a.id === actionId ? { ...a, state: "failed", description: err instanceof Error ? err.message : String(err) } : a
                )
              }
            : m
        );
        return syncRuntimeAgentActions(updatedMessages, state.planProposalsById);
      });
    }
  },

  submitAssistantAnswer: async (actionId, messageId, answer, workspaceId) => {
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

    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content: isWorkflowScope
                ? `Workflow-Entscheidung:\n✓ ${decisionLabel}`
                : m.content,
              actions: m.actions?.map<import("@dbzs/shared").ChatActionRequest>((a) =>
                a.id === actionId
                  ? {
                      ...a,
                      state: "completed",
                      title: isWorkflowScope ? `Workflow-Entscheidung: ${decisionLabel}` : a.title,
                      description: isWorkflowScope ? decisionLabel : a.description,
                      payload: { ...a.payload, answer }
                    }
                  : a
              )
            }
          : m
      )
    }));

    try {
    const rehydrated = get().rehydratedPendingQuestion;
    if (rehydrated && rehydrated.question.id === question?.id) {
      // The original in-process turn loop no longer exists after an app restart, so we
      // cannot literally unblock the old suspended promise. Instead we continue the
      // conversation for real via the normal sendMessage pipeline (same routing/tool
      // machinery as any message), seeded with the original goal and the answer. This is
      // a genuine continuation, not a cosmetic one — it just re-derives intermediate
      // reasoning rather than replaying the exact pre-restart turn.
      set({ rehydratedPendingQuestion: null, activeRun: null });
      await clearPendingQuestion(rehydrated.workspaceRoot).catch(() => {});

      const answerSummary =
        answer.freeText ?? answer.optionIds?.join(", ") ?? (answer.skipped ? "(keine Antwort)" : "");
      if (!answer.skipped && question) {
        appendContractFieldAnswer(
          rehydrated.workspaceRoot,
          question.requiredField,
          question.id,
          question.prompt,
          answerSummary
        );
      }
      const continuationContent =
        `[Fortsetzung nach Neustart] Rückfrage "${rehydrated.question.prompt}" wurde beantwortet: ${answerSummary}\n\n` +
        `Ursprüngliches Ziel: ${rehydrated.goal}`;

      await get().sendMessage(
        continuationContent,
        useRuntimeStore.getState().status,
        null,
        undefined,
        null,
        rehydrated.targetAgent,
        {
          toolProfile: rehydrated.profile,
          agentMode: "agent",
          useAgentTurnLoop: true,
          workspaceRoot: rehydrated.workspaceRoot
        }
      );
      return;
    }

    const preflight = action.payload?.preflight as
      | {
          originalMessage: string;
          targetAgent: ModelTargetAgent;
          workspaceRoot: string | null;
          workflow: string;
          taskType?: RuntimeTaskType;
        }
      | undefined;
    if (preflight) {
      if (
        question?.requiredField === "review_remediation_selection" &&
        preflight.workspaceRoot
      ) {
        if (answer.skipped) {
          await finishReviewRemediationSelection(preflight.workspaceRoot, "cancelled");
          return;
        }
        const reviewId = answer.optionIds?.[0];
        const scope = answer.optionIds?.[1] as ReviewRemediationSelectionScope | undefined;
        if (
          !reviewId ||
          !scope ||
          !["all", "p0_p1", "p0_p2", "selected"].includes(scope)
        ) {
          return;
        }
        const applied = await applyReviewRemediationSelection(preflight.workspaceRoot, {
          questionId: answer.questionId,
          reviewId,
          scope
        });
        // Eine verspätete Antwort darf den aktuellen Auswahlzustand weder
        // überschreiben noch einen neuen Modell-Turn starten.
        if (!applied) return;
        await get().sendMessage(
          preflight.originalMessage,
          useRuntimeStore.getState().status,
          null,
          undefined,
          null,
          "planner",
          {
            workspaceRoot: preflight.workspaceRoot,
            stickyTaskType: "planning",
            preferPlannerFirst: true,
            forceContinueActiveWorkflow: true
          }
        );
        return;
      }
      if (
        question?.requiredField === "remediation_scope" &&
        preflight.workspaceRoot
      ) {
        const selection = await readReviewRemediationSelection(preflight.workspaceRoot);
        if (selection?.scope === "selected") {
          if (answer.skipped) {
            await finishReviewRemediationSelection(preflight.workspaceRoot, "cancelled");
            return;
          }
          const applied = await applySelectedReviewFindingIds(
            preflight.workspaceRoot,
            answer.questionId,
            answer.optionIds ?? []
          );
          if (!applied) return;
          await get().sendMessage(
            preflight.originalMessage,
            useRuntimeStore.getState().status,
            null,
            undefined,
            null,
            "planner",
            {
              workspaceRoot: preflight.workspaceRoot,
              stickyTaskType: "planning",
              forceContinueActiveWorkflow: true
            }
          );
          return;
        }
      }
      if (answer.skipped) {
        if (preflight.workspaceRoot) {
          await clearPendingQuestion(preflight.workspaceRoot).catch(() => {});
          clearPendingWorkflowScopeDecision(preflight.workspaceRoot);
        }
        return;
      }

      if (isWorkflowScope) {
        const optionId = selectedOptionId;
        if (optionId !== "continue_active_task" && optionId !== "start_new_task") {
          return;
        }
        const pendingDecision =
          (preflight.workspaceRoot ? readPendingWorkflowScopeDecision(preflight.workspaceRoot) : null) ??
          null;
        const originalMessage =
          pendingDecision?.triggeringMessage?.trim() || preflight.originalMessage.trim();
        if (preflight.workspaceRoot) {
          clearPendingWorkflowScopeDecision(preflight.workspaceRoot);
          await clearPendingQuestion(preflight.workspaceRoot).catch(() => {});
        }

        if (optionId === "start_new_task" && preflight.workspaceRoot) {
          pauseActiveTaskContract(preflight.workspaceRoot);
        }

        await get().sendMessage(
          originalMessage,
          useRuntimeStore.getState().status,
          null,
          undefined,
          null,
          preflight.targetAgent,
          {
            workspaceRoot: preflight.workspaceRoot,
            stickyTaskType: optionId === "continue_active_task" ? preflight.taskType : undefined,
            preferPlannerFirst: true,
            hasImageInput: false,
            requiresVision: false,
            forceContinueActiveWorkflow: optionId === "continue_active_task",
            forceNewTask: optionId === "start_new_task"
          }
        );
        return;
      }

      if (question?.requiredField === "resource_risk_decision") {
        const optionId = rawOptionId;
        if (optionId === "abort_start") {
          return;
        }
        if (optionId === "choose_other_model") {
          set((state) => ({
            messages: [
              ...state.messages,
              {
                id: `msg-${Date.now().toString(36)}-choose-model`,
                role: "system",
                content:
                  "Bitte wähle im Settings-/Runtime-Panel ein anderes Rollenmodell und sende die Anfrage erneut. Es erfolgt kein stiller Modellwechsel."
              }
            ]
          }));
          return;
        }
        if (optionId === "continue_with_resident") {
          await get().sendMessage(
            preflight.originalMessage,
            useRuntimeStore.getState().status,
            null,
            undefined,
            null,
            preflight.targetAgent,
            {
              workspaceRoot: preflight.workspaceRoot,
              stickyTaskType: preflight.taskType,
              preferPlannerFirst: true,
              forceUseResidentModel: true,
              acceptResourceRisk: true
            }
          );
          return;
        }
        if (optionId === "smaller_profile") {
          const slotHint =
            (preflight.workspaceRoot ? get().lastRouting?.slotId : null) ?? "fast_gpu";
          const modelHint = get().lastBrokerDecision?.resolvedModelId;
          if (modelHint) {
            markResourceRiskAccepted(String(slotHint), modelHint);
          }
          await get().sendMessage(
            preflight.originalMessage,
            useRuntimeStore.getState().status,
            null,
            undefined,
            null,
            preflight.targetAgent,
            {
              workspaceRoot: preflight.workspaceRoot,
              stickyTaskType: preflight.taskType,
              preferPlannerFirst: true,
              acceptResourceRisk: true,
              runtimeProfileOverride: "hybrid"
            }
          );
          return;
        }
        if (optionId === "cpu_safe_profile") {
          const slotHint =
            (preflight.workspaceRoot ? get().lastRouting?.slotId : null) ?? "fast_gpu";
          const modelHint = get().lastBrokerDecision?.resolvedModelId;
          if (modelHint) {
            markResourceRiskAccepted(String(slotHint), modelHint);
          }
          await get().sendMessage(
            preflight.originalMessage,
            useRuntimeStore.getState().status,
            null,
            undefined,
            null,
            preflight.targetAgent,
            {
              workspaceRoot: preflight.workspaceRoot,
              stickyTaskType: preflight.taskType,
              preferPlannerFirst: true,
              acceptResourceRisk: true,
              runtimeProfileOverride: "cpu_safe"
            }
          );
          return;
        }
        return;
      }

      // Missing-information questions are asked before any run/model call exists (a
      // pre-flight gate, not a paused tool call), so there is no coordinator to resolve —
      // continuing means re-sending the original message enriched with the answer through
      // the normal pipeline, so the same missing-field check can (usually) now find what
      // it was looking for in the enriched text.
      if (preflight.workspaceRoot && question) {
        await recordProjectDecision(
          preflight.workspaceRoot,
          preflight.workflow as import("@dbzs/shared").ClarificationWorkflow,
          question.prompt,
          answer
        ).catch(() => {});
        const answerSummary = answer.freeText ?? answer.optionIds?.join(", ") ?? "";
        const requiredField = question.requiredField;
        appendContractFieldAnswer(
          preflight.workspaceRoot,
          requiredField,
          question.id,
          question.prompt,
          answerSummary
        );
        await clearPendingQuestion(preflight.workspaceRoot).catch(() => {});
        const existing = readActiveTaskContract(preflight.workspaceRoot);
        if (existing) {
          const goalLooksLikeFeature =
            requiredField === "target" ||
            question.prompt.toLowerCase().includes("funktion") ||
            question.prompt.toLowerCase().includes("feature");
          upsertActiveTaskContract(preflight.workspaceRoot, {
            originalRequest: existing.originalRequest,
            confirmedGoal: goalLooksLikeFeature && answerSummary ? answerSummary : existing.confirmedGoal,
            taskType: preflight.taskType ?? existing.taskType,
            assignedAgent: existing.assignedAgent,
            currentPhase: "planning"
          });
        }
      }

      const answerSummary = answer.freeText ?? answer.optionIds?.join(", ") ?? "";
      const continuationContent = `${preflight.originalMessage}\n\n${answerSummary}`.trim();

      await get().sendMessage(
        continuationContent,
        useRuntimeStore.getState().status,
        null,
        undefined,
        null,
        preflight.targetAgent,
        {
          workspaceRoot: preflight.workspaceRoot,
          stickyTaskType: preflight.taskType,
          preferPlannerFirst: true,
          hasImageInput: false,
          requiresVision: false
        }
      );
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
  },

  checkForPendingQuestion: async (workspaceRoot) => {
    const pending = await readPendingQuestion(workspaceRoot);
    if (!pending) return;

    const contract = readActiveTaskContract(workspaceRoot);
    const requiredField = pending.question.requiredField;
    if (requiredField && answeredFieldIds(contract).has(requiredField)) {
      await clearPendingQuestion(workspaceRoot).catch(() => {});
      return;
    }

    const messageId = `msg-${Date.now().toString(36)}-rehydrated-ask`;
    const action: import("@dbzs/shared").ChatActionRequest = {
      id: `act-${Math.random().toString(36).substring(2, 10)}`,
      runId: pending.runId,
      messageId,
      workspaceRoot: pending.workspaceRoot,
      workspaceId: workspaceScopeId(pending.workspaceRoot),
      kind: "answer_question",
      title: pending.question.prompt,
      description: pending.question.context,
      riskLevel: pending.question.riskLevel,
      payload: { question: pending.question, requestId: pending.toolCallRequestId },
      state: "pending",
      createdAt: pending.askedAt
    };

    const rehydratedRun = createChatRun(messageId, "agent", pending.profile, true, pending.workspaceRoot);
    const runWithStatus = updateRunStatus(
      appendRunEvent(rehydratedRun, "chat.question_asked", pending.question.prompt),
      "waiting_for_user_answer"
    );

    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: messageId,
          role: "system",
          content: pending.question.prompt,
          actions: [action]
        }
      ],
      activeRun: { ...runWithStatus, id: pending.runId },
      rehydratedPendingQuestion: pending
    }));
  },

  handoffJobContext: ({ jobId, title, workspaceRoot, description, artifactSummary }) => {
    const hint = [
      "[Job Handoff]",
      `Job: ${title} (${jobId})`,
      `Workspace: ${workspaceRoot}`,
      description ? `Beschreibung: ${description}` : "",
      artifactSummary ? `Artefakte:\n${artifactSummary}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    set({ pendingJobContextHint: hint });
  },

  consumeJobContextHint: () => {
    const hint = get().pendingJobContextHint;
    if (hint) {
      set({ pendingJobContextHint: null });
    }
    return hint;
  },

  loadToolCatalog: async () => {
    const fallbackDesktopTools = listRuntimeToolNames();
    try {
      await bootstrapRuntimeLayer();
      const catalog = await orchestrationClient.listTools();
      set({
        availableTools: catalog.tools.filter((tool) => tool.enabled),
        desktopToolNames: listRuntimeToolNames()
      });
    } catch {
      // Backend orchestration optional during startup.
      // Keep desktop runtime tools visible even when backend catalog is unavailable.
      set((state) => ({
        availableTools: state.availableTools,
        desktopToolNames: fallbackDesktopTools
      }));
    }
  },

  toggleSkill: (skillId) => {
    const current = get().enabledSkillIds;
    const next = current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId];
    saveEnabledSkillIds(next);
    setSkillEnabled(skillId, next.includes(skillId));
    set({ enabledSkillIds: next });
  },

  setToolsEnabled: (enabled) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TOOLS_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
    }
    set({ toolsEnabled: enabled });
  },

  cancelSend: (runId?: string) => {
    const targetRunId = runId ?? get().activeRun?.id;
    if (targetRunId && runsAbortControllers[targetRunId]) {
      runsAbortControllers[targetRunId].abort();
      delete runsAbortControllers[targetRunId];
    }
    void backendClient.cancelRuntimeChatStream?.();
    const run = get().activeRun;
    if (run && (!runId || run.id === runId)) {
      const updated = updateRunStatus(appendRunEvent(run, "chat.cancelled", "Vorgang abgebrochen"), "cancelled");
      set((state) => ({
        activeRun: null,
        historicalRuns: { ...state.historicalRuns, [updated.id]: updated }
      }));
    }
    set({ isSending: false, isStreaming: false, currentActivity: null });
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

    const workspaceRootEarly =
      sendOptions?.workspaceRoot ?? useWorkspaceStore.getState().state.projectPath ?? null;
    const workspaceIdEarly = workspaceRootEarly ? workspaceScopeId(workspaceRootEarly) : "";
    if (workspaceIdEarly) {
      const pendingScope = findPendingWorkflowScopeAction(get().messages, workspaceIdEarly);
      if (pendingScope) {
        const alias = mapWorkflowScopeTextAlias(trimmedContent);
        if (alias) {
          await get().submitAssistantAnswer(
            pendingScope.action.id,
            pendingScope.messageId,
            {
              questionId:
                (pendingScope.action.payload?.question as { id?: string } | undefined)?.id ??
                pendingScope.action.id,
              answeredAt: new Date().toISOString(),
              optionIds: [alias]
            },
            workspaceIdEarly
          );
          return true;
        }
        // While a scope decision is open, do not start a parallel chat turn.
        set((state) => ({
          messages: [
            ...state.messages,
            { id: createMessageId("user-scope-alias"), role: "user", content: trimmedContent },
            {
              id: createMessageId("system-scope-alias"),
              role: "system",
              content: "Bitte wähle eine der beiden Optionen."
            }
          ],
          error: null
        }));
        return false;
      }
    }

    // Direct Intent Classifier: deterministic workspace queries (count/find files)
    // are answered straight from the already-scanned workspace file list, ahead
    // of the agent-router/model pipeline — no LLM warm-up for a file count.
    const directIntent = directIntentClassifier(trimmedContent);
    if (directIntent) {
      let workspaceFilesForIntent = useWorkspaceStore.getState().files;
      if (workspaceFilesForIntent.length === 0 && workspaceRootEarly) {
        await useWorkspaceStore.getState().scanFiles();
        workspaceFilesForIntent = useWorkspaceStore.getState().files;
      }
      const pattern = directIntent.pattern.replace(/\*/g, "").toLowerCase();
      const matches = workspaceFilesForIntent.filter((file) => {
        const lowerPath = file.relativePath.toLowerCase();
        if (directIntent.operation === "count_files" || directIntent.operation === "list_files") {
          return lowerPath.endsWith(pattern);
        }
        if (directIntent.operation === "search_files") {
          return lowerPath.includes(pattern);
        }
        return false;
      });

      let responseText = `Keine Dateien passend zu \`${directIntent.pattern}\` im Workspace gefunden.`;
      if (directIntent.operation === "count_files") {
        responseText = `${matches.length} Datei${matches.length === 1 ? "" : "en"} passend zu \`${directIntent.pattern}\` im Workspace gefunden.`;
      } else if (directIntent.operation === "search_files" && matches.length > 0) {
        responseText = `Ich habe ${matches.length} Datei(en) gefunden, die auf \`${directIntent.pattern}\` passen:\n\n- ${matches.map((file) => file.relativePath).join("\n- ")}`;
      } else if (directIntent.operation === "list_files" && matches.length > 0) {
        responseText = `Hier sind die ${matches.length} gefundenen Dateien für \`${directIntent.pattern}\`:\n\n- ${matches.map((file) => file.relativePath).join("\n- ")}`;
      }

      set((state) => ({
        messages: [
          ...state.messages,
          { id: createMessageId("user"), role: "user", content: trimmedContent },
          { id: createMessageId("assistant"), role: "assistant", content: responseText }
        ],
        error: null
      }));
      return true;
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

    const workflowOutcome = resolveWorkflowContinuationForSend({
      trimmedContent,
      sendOptions,
      isAutoTrivial,
      taskType,
      effectiveAgent,
      intentClassification,
      messages: get().messages,
      lastRouting: get().lastRouting,
      lastBrokerDecision: get().lastBrokerDecision,
      lastActivitySummary: get().lastActivity?.summary ?? null,
      activeRunStatus: get().activeRun?.status ?? null
    });

    if (workflowOutcome.kind === "summarize_active_task") {
      set((state) => ({
        messages: [...state.messages, workflowOutcome.userMessage, workflowOutcome.assistantMessage],
        error: null,
        isSending: false,
        isStreaming: false
      }));
      return true;
    }

    if (workflowOutcome.kind === "ambiguity_silent") {
      return false;
    }

    if (workflowOutcome.kind === "ambiguity_ask") {
      writePendingWorkflowScopeDecision(workflowOutcome.pendingDecision);
      set((state) => ({
        messages: [...state.messages, workflowOutcome.userMessage, workflowOutcome.systemMessage]
      }));
      return false;
    }

    taskType = workflowOutcome.taskType;
    effectiveAgent = workflowOutcome.effectiveAgent;
    intentClassification = workflowOutcome.intentClassification;
    let activeTaskContract = workflowOutcome.activeTaskContract;
    const executionIntent = workflowOutcome.executionIntent;
    let workflowAssignment = workflowOutcome.workflowAssignment;
    const workspaceRootForWorkflow = workflowOutcome.workspaceRootForWorkflow;
    const continuation = {
      useActiveContract: workflowOutcome.continuationUseActiveContract,
      reason: workflowOutcome.continuationReason
    };

    const reviewRemediationOutcome = await runReviewRemediationPhase({
      trimmedContent,
      workspaceRootForWorkflow,
      workspaceRootEarly,
      executionIntent,
      activeTaskContract,
      intentClassification,
      appendMessages: (newMessages) => {
        set((state) => ({ messages: [...state.messages, ...newMessages] }));
      },
      markActionRemediationReviews: (questionId, reviews) => {
        set((state) => ({
          messages: state.messages.map((message) => ({
            ...message,
            actions: message.actions?.map((action) =>
              (action.payload?.question as { id?: string } | undefined)?.id === questionId
                ? { ...action, payload: { ...action.payload, remediationReviews: reviews } }
                : action
            )
          }))
        }));
      }
    });
    if (reviewRemediationOutcome.kind === "handled") {
      return false;
    }
    if (reviewRemediationOutcome.kind === "continue") {
      activeTaskContract = reviewRemediationOutcome.activeTaskContract;
      effectiveAgent = reviewRemediationOutcome.effectiveAgent;
      taskType = reviewRemediationOutcome.taskType;
      intentClassification = reviewRemediationOutcome.intentClassification;
    }

    let preferPlannerFirst = true;
    if (sendOptions?.preferPlannerFirst === false) {
      preferPlannerFirst = false;
    } else if (
      activeTaskContract?.currentPhase === "executing" ||
      activeTaskContract?.currentPhase === "implementation" ||
      activeTaskContract?.currentPhase === "awaiting_patch_approval" ||
      activeTaskContract?.assignedAgent === "coder"
    ) {
      preferPlannerFirst = false;
    }
    const implementationRouting = normalizeImplementationContinuationRouting({
      phase: activeTaskContract?.currentPhase,
      taskType,
      contractTaskType: activeTaskContract?.taskType,
      targetAgent: effectiveAgent,
      preferPlannerFirst
    });
    if (implementationRouting.normalized) {
      taskType = implementationRouting.taskType;
      effectiveAgent = implementationRouting.targetAgent;
      preferPlannerFirst = implementationRouting.preferPlannerFirst;
      intentClassification = { ...intentClassification, taskType };
    }

    const requestCapabilities = {
      hasImageInput: sendOptions?.hasImageInput === true,
      hasAudioInput: false,
      requiresVision: sendOptions?.requiresVision === true
    };
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

    const clarificationWorkflow = workflowForTaskType(taskType);
    if (clarificationWorkflow && !isAutoTrivial) {
      const workspaceRootForClarification = sendOptions?.workspaceRoot ?? null;
      const contractForClarification =
        activeTaskContract ?? readActiveTaskContract(workspaceRootForClarification);
      const answeredFields = answeredFieldIds(contractForClarification);
      const missingFields = checkMissingInformation(
        clarificationWorkflow,
        taskType,
        trimmedContent,
        !!activeFile?.content,
        {
          answeredFields,
          confirmedGoal: contractForClarification?.confirmedGoal,
          acceptanceCriteria: contractForClarification?.acceptanceCriteria
        }
      );

      const workspaceIdForClarification = workspaceRootForClarification
        ? workspaceScopeId(workspaceRootForClarification)
        : "";

      const unresolvedFields: typeof missingFields = [];
      for (const field of missingFields) {
        if (field.present) continue;
        if (answeredFields.has(field.field)) continue;
        if (
          workspaceIdForClarification &&
          isClarificationFieldBlockedInMessages(get().messages, workspaceIdForClarification, field.field)
        ) {
          continue;
        }
        const remembered = workspaceRootForClarification
          ? await lookupProjectDecision(workspaceRootForClarification, clarificationWorkflow, field.askIfMissing.prompt)
          : null;
        if (!remembered) {
          unresolvedFields.push(field);
        }
      }

      const riskLevel: "low" | "medium" | "high" =
        clarificationWorkflow === "coding" &&
        (taskType === "large_code_change" || taskType === "refactoring")
          ? "high"
          : clarificationWorkflow === "coding" && taskType === "small_code_change"
            ? "medium"
            : "low";

      const questionsAskedThisRun = get().messages.filter((m) =>
        m.actions?.some(
          (a) =>
            a.kind === "answer_question" &&
            (a.payload as { question?: { toolCallId?: string } } | undefined)?.question?.toolCallId ===
              "missing-information-policy"
        )
      ).length;

      const clarification = decideClarification({
        intent: intentClassification,
        missingFields: unresolvedFields,
        riskLevel,
        questionsAskedThisTurn: 0,
        questionsAskedThisRun
      });

      if (clarification.shouldAsk && clarification.question) {
        const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const messageId = `msg-${Date.now().toString(36)}-preflight-ask`;
        const question = clarification.question;
        const actionWorkspaceRoot = workspaceRootForClarification ?? "";
        if (workspaceRootForClarification) {
          const existingContract = readActiveTaskContract(workspaceRootForClarification);
          activeTaskContract = upsertActiveTaskContract(workspaceRootForClarification, {
            originalRequest: existingContract?.originalRequest ?? trimmedContent,
            confirmedGoal: existingContract?.confirmedGoal || trimmedContent,
            taskType: existingContract?.taskType ?? taskType,
            assignedAgent: existingContract?.assignedAgent ?? effectiveAgent,
            currentPhase: "clarification",
            workflowKind: workflowAssignment.workflowKind,
            effectiveAgent: workflowAssignment.effectiveAgent,
            requestedAgent: workflowAssignment.requestedAgent ?? undefined,
            policyVersion: workflowAssignment.policyVersion,
            modelRole: workflowAssignment.modelRole,
            toolProfile: workflowAssignment.toolProfile,
            runId
          });
        }
        const action: import("@dbzs/shared").ChatActionRequest = {
          id: `act-${Math.random().toString(36).substring(2, 10)}`,
          runId,
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
              targetAgent: workflowAssignment.effectiveAgent,
              workspaceRoot: workspaceRootForClarification,
              workflow: clarificationWorkflow,
              taskType
            }
          },
          state: "pending",
          createdAt: new Date().toISOString()
        };
        set((state) => ({
          messages: [
            ...state.messages,
            { id: `msg-${Date.now().toString(36)}-user-preflight`, role: "user", content: trimmedContent },
            { id: messageId, role: "system", content: question.prompt, actions: [action] }
          ]
        }));
        return false;
      }
    }

      activeSkillContext = await prepareSkillRuntime({
      userMessage: trimmedContent,
      executionIntent: classifyUserExecutionIntent(trimmedContent),
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

    const startedAt = Date.now();
    let activity = createActivityRun(trimmedContent, effectiveAgent);
    
    // Observability: Start session trace
    const sessionId = startChatSession(
      sendOptions?.workspaceRoot ?? null,
      effectiveAgent,
      { id: `msg-${Date.now().toString(36)}-start`, role: "user", content: trimmedContent }
    );
    
    const userMsgId = `msg-${Date.now().toString(36)}-user`;
    const initialRun = createChatRun(
      userMsgId,
      sendOptions?.agentMode ?? "auto",
      useSettingsStore.getState().settings.defaultModelId ? "full" : "ask",
      includeWorkspaceContext,
      sendOptions?.workspaceRoot ?? undefined,
      activeFile?.path
    );
    const safeTraceEvents: ReasoningTraceEvent[] = [
      createTraceEvent(initialRun.id, "intent_detected", "Auftrag erkannt", `Intent: ${taskType}`)
    ];
    let ragResult: RagRetrievalResponse | null = null;

    const runAbortController = new AbortController();
    runsAbortControllers[initialRun.id] = runAbortController;
    const userMessage: RuntimeChatMessage = { id: `msg-${Date.now().toString(36)}-user`, role: "user", content: trimmedContent };
    const nextMessages = [...get().messages, userMessage];

    set({ 
      messages: nextMessages, 
      currentActivity: activity, 
      isSending: true, 
      error: null,
      activeRun: appendRunEvent(initialRun, "chat.accepted", "Nachricht angenommen")
    });

    // P0 Phase 2: Use dynamic timeout configuration (task profile + user settings)
    const timeoutManager = new TimeoutManager(
      applySettingsTimeoutOverrides(
        selectTimeoutProfile(
          taskType,
          (buildFileContext(activeFile)?.content?.length ?? 0) +
            (workspaceContext?.rootPath?.length ?? 0)
        ),
        useSettingsStore.getState().settings
      )
    );

    // Separated phase timeouts: prompt-eval / first-token / stream-idle / generation
    const phaseTimeouts = createPhaseTimeoutController({
      isAborted: () => runAbortController.signal.aborted,
      hasFirstToken: () => Boolean(get().activeRun?.firstTokenAt),
      onTimeout: (_kind, message) => {
        if (runAbortController.signal.aborted) return;
        // Die Catch-Finalisierung ist die einzige Stelle, die das terminale
        // Timeout-Event persistiert. So entsteht pro Run exakt ein Event.
        runAbortController.abort(new Error(message));
        set({
          isSending: false,
          isStreaming: false,
          error: message
        });
      }
    });
    const resetFirstTokenTimeout = () => {
      // kept for call-site compatibility; full clear happens via phaseTimeouts
      phaseTimeouts.clearAll();
    };
    const startFirstTokenTimeout = (timeoutMs: number) => {
      phaseTimeouts.startPreTokenWatchdogs({
        promptEvalTimeoutMs: Math.min(timeoutManager.getPromptEval(), timeoutMs),
        firstTokenTimeoutMs: timeoutMs
      });
    };
    const onStreamTokenActivity = () => {
      phaseTimeouts.onFirstToken({
        streamIdleTimeoutMs: timeoutManager.getStreamIdle(),
        generationTimeoutMs: timeoutManager.getGeneration()
      });
    };
    
    // Do NOT start first-token timeout here — it starts at HTTP boundary

    // Gesamt-Timeout: Absolute cap on entire request lifecycle
    const totalTimeout = setTimeout(() => {
      if (!runAbortController.signal.aborted) {
        runAbortController.abort(new Error("Gesamt-Timeout: Laufzeit überschritten"));
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...updateRunStatus(r, "timeout"),
              outcome: "generation_timeout" satisfies RuntimeRunOutcome
            },
            "chat.timeout",
            "Gesamt-Timeout"
          )
        );
        set({ isSending: false, isStreaming: false, error: `Gesamtlaufzeit überschritten (${timeoutManager.getTotal() / 1_000 / 60}m). Bitte Anfrage vereinfachen.` });
      }
    }, timeoutManager.getTotal());

    const updateActiveRun = (updater: (run: RuntimeChatRun) => RuntimeChatRun) => {
      set((state) => ({
        activeRun: state.activeRun ? updater(state.activeRun) : null
      }));
    };

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
    }): RuntimeChatTurn => ({
      id: `turn-${initialRun.id}-${input.turnNumber}`,
      turnNumber: Math.max(1, input.turnNumber),
      prompt: input.prompt,
      response: input.response ?? undefined,
      startedAt: input.startedAt ?? get().activeRun?.startedAt ?? new Date().toISOString(),
      finishedAt: input.finishedAt ?? new Date().toISOString(),
      durationMs: Date.now() - new Date(input.startedAt ?? get().activeRun?.startedAt ?? new Date().toISOString()).getTime()
    });

    const updateActivity = (nextRun: RuntimeChatActivityRun) => {
      activity = nextRun;
      set({ currentActivity: nextRun });
    };

    const beginStep = (id: string, label: string, detail = "") => {
      updateActivity(
        patchActivitySteps(activity, upsertActivityStep(activity.steps, id, label, "running", detail))
      );
    };

    const finishStep = (id: string, label: string, detail = "") => {
      updateActivity(
        patchActivitySteps(activity, upsertActivityStep(activity.steps, id, label, "done", detail))
      );
    };

    const failStep = (id: string, label: string, detail: string) => {
      updateActivity(
        patchActivitySteps(activity, upsertActivityStep(activity.steps, id, label, "error", detail))
      );
    };

    const appendStepDetail = (id: string, line: string) => {
      updateActivity(patchActivitySteps(activity, appendActivityStepDetail(activity.steps, id, line)));
    };

    beginStep("runtime-check", "Runtime-Status pruefen");
    updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "preparing"), "runtime.check.started", "Runtime-Status pruefen"));

    // Lazy Runtime: Backend muss erreichbar sein; Arbeitsmodelle starten erst nach Routing+Budget.
    const runWorkspaceRoot = sendOptions?.workspaceRoot ?? null;
    let backendReachable = false;
    let currentStatus = await refreshRuntimeStatus(runtimeStatus);
    try {
      await runtimeSlotManager.getAllSlotsStatus();
      backendReachable = true;
    } catch {
      backendReachable = currentStatus.state === "running";
    }
    if (!backendReachable) {
      await sleep(250);
      currentStatus = await refreshRuntimeStatus(currentStatus);
      try {
        await runtimeSlotManager.getAllSlotsStatus();
        backendReachable = true;
      } catch {
        backendReachable = false;
      }
    }
    if (!backendReachable) {
      failStep("runtime-check", "Runtime-Status pruefen", "Backend nicht erreichbar.");
      updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "failed"), "chat.failed", "Backend nicht erreichbar"));
      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary: "Abgebrochen: Backend offline"
        })
      );
      const finishedRun = get().activeRun;
      set((state) => ({
        error: "Backend nicht erreichbar. Starte zuerst das Backend.",
        isSending: false,
        lastActivity: activity,
        currentActivity: null,
        activeRun: null,
        historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
      }));
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
    try {
      const settings = useSettingsStore.getState().settings;
      const canaryPercent = settings.runtimeChatCanaryPercent ?? 100;
      const shadowMode = settings.runtimeChatShadowMode ?? false;
      const stopOnShadowMismatch = settings.runtimeChatStopOnShadowMismatch ?? false;
      const canaryStage = canaryStageLabel(canaryPercent);
      // Binding mode: broker is the only authoritative router for Runtime Chat.
      const buildBrokerShadowDecision = () => {
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
        return brokerDecision(
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
      };

      appendStepDetail(
        "model-route",
        `binding_broker=yes rollout_stage=${canaryStage} workflow=${continuation.reason}`
      );

      let decision = buildBrokerShadowDecision();
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
          appendStepDetail(
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
            appendStepDetail("model-route", "[shadow] mismatch stop ignored outside strict rollout gate");
          }
        } else {
          appendStepDetail("model-route", "[shadow] legacy decision unavailable");
        }
      }

      if (workspaceRootForWorkflow) {
        const assignedAgent = mapBrokerAgentToShared(decision.targetAgent);
        activeTaskContract = upsertActiveTaskContract(workspaceRootForWorkflow, {
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
          runId: initialRun.id,
          answeredQuestions: activeTaskContract?.answeredQuestions
        });
      }
    } catch (error) {
      if (error instanceof BindingModelError) {
        const errMsg = `${error.message}${error.options.length ? ` Optionen: ${error.options.join(" · ")}` : ""}`;
        failStep("model-route", "Modell-Routing", errMsg);
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "failed"), "chat.failed", errMsg));
        updateActivity(
          patchActivityRun(activity, {
            finishedAt: new Date().toISOString(),
            summary: `Abgebrochen: ${errMsg}`
          })
        );
        const finishedRun = get().activeRun;
        resetFirstTokenTimeout();
        clearTimeout(totalTimeout);
        set((state) => ({
          error: errMsg,
          isSending: false,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
        }));
        return false;
      }
      const errMsg = error instanceof Error ? error.message : "Routing fehlgeschlagen";
      failStep("model-route", "Modell-Routing", errMsg);
      updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "failed"), "chat.failed", errMsg));
      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary: `Abgebrochen: ${errMsg}`
        })
      );
      const finishedRun = get().activeRun;
      resetFirstTokenTimeout();
      clearTimeout(totalTimeout);
      set((state) => ({
        error: errMsg,
        isSending: false,
        lastActivity: activity,
        currentActivity: null,
        activeRun: null,
        historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
      }));
      return false;
    }
    const runtimeFlags = useSettingsStore.getState().settings;
    let contextSlotId = resolveContextSlotId(taskType, routing.slotId);
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
      createTraceEvent(initialRun.id, "model_selected", "Modell gewählt", `${displayModelLabel} · ${contextSlotId}`)
    );
    const diagnosticsEnabled = runtimeFlags.runtimeChatEnableDiagnostics ?? true;
    if (routing) {
      routing.shadowMatch = shadowMatch;
    }
    // P1 Req 7: Store complete broker decision (optional via flag)
    set({ lastRouting: routing, lastBrokerDecision: diagnosticsEnabled ? brokerDecisionFull ?? null : null });
    updateActivity(
      patchActivityRun(activity, {
        modelId: routing.modelId ?? undefined,
        modelName: displayModelLabel,
        providerId: routing.providerId ?? undefined
      })
    );
    finishStep(
      "model-route",
      "Modell-Routing",
      `Agent ${agentLabel(effectiveAgent)} → ${displayModelLabel} (${routing.providerId ?? "runtime"})`
    );
    updateActiveRun((r) => {
      const updated = appendRunEvent(
        r,
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

    // PRIORITÄT 2: Eindeutige Runtime-Route sicherstellen
    const resolvedRoute: import("@/services/runtimeRouteValidator").ResolvedRuntimeRoute = {
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
      failStep("model-route", "Modell-Routing", validationError);
      updateActiveRun((r) =>
        appendRunEvent(
          {
            ...updateRunStatus(r, "failed"),
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
      return false;
    }

    {
      const phaseAgentGate = assertValidPhaseAgentPair(
        workflowAssignment.phase,
        workflowAssignment.effectiveAgent
      );
      if (!phaseAgentGate.ok) {
        const invalidMsg = `Interner Workflow-Routingfehler. Diagnose-ID: ${initialRun.id}`;
        appendStepDetail("model-route", `policy_error=${phaseAgentGate.reason}`);
        failStep("model-route", "Modell-Routing", invalidMsg);
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...updateRunStatus(r, "failed"),
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
        clearTimeout(totalTimeout);
        set((state) => ({
          error: invalidMsg,
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
    }

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

    if (sendOptions?.includeWorkspaceContext && sendOptions.workspaceRoot && !isAutoTrivial) {
      beginStep("workspace-context", "Workspace-Kontext laden");
      try {
        const buildResult = await withTimeout(
          buildWorkspaceContext(
            sendOptions.workspaceRoot,
            sendOptions.workspaceName ?? null,
            sendOptions.workspaceFiles ?? [],
            activeFile,
            (event) => {
              if (event.type === "start") {
                appendStepDetail(
                  "workspace-context",
                  `Workspace ${event.workspaceName}: ${event.candidateCount} Kandidaten, ${event.treeFileCount} Dateien im Baum`
                );
              }
              if (event.type === "reading") {
                appendStepDetail("workspace-context", `Lese ${event.relativePath} ...`);
              }
              if (event.type === "loaded") {
                appendStepDetail(
                  "workspace-context",
                  `✓ ${event.relativePath} (${event.language}, ${event.charCount} Zeichen)`
                );
              }
              if (event.type === "failed") {
                appendStepDetail("workspace-context", `✗ ${event.relativePath} (Lesefehler)`);
              }
            }
          ),
          timeoutManager.getContext(),
          "Workspace-Kontext",
          runAbortController.signal
        );
        resolvedWorkspaceContext = buildResult.context;

        // Observability: Capture context proof
        if (sessionId && resolvedWorkspaceContext) {
          captureContextProof(sessionId, {
            workspaceRoot: sendOptions.workspaceRoot,
            workspaceName: sendOptions.workspaceName ?? null,
            activeFile: activeFile ? { path: activeFile.path, content: activeFile.content, language: activeFile.language } : null,
            sampledFiles: resolvedWorkspaceContext.sampledFiles,
            fileTree: resolvedWorkspaceContext.fileTree,
            contextMentions: parseContextMentions(trimmedContent).map(m => m.path),
            enabledSkillIds: skillIds,
            toolProfile: sendOptions?.toolProfile ?? get().toolProfile,
            indexedFileCount: sendOptions?.indexedFileCount ?? 0
          });
        }

        finishStep(
          "workspace-context",
          "Workspace-Kontext laden",
          `${buildResult.sampledCount} Dateien geladen${buildResult.failedCount > 0 ? `, ${buildResult.failedCount} fehlgeschlagen` : ""}`
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Workspace-Kontext konnte nicht geladen werden";
        failStep("workspace-context", "Workspace-Kontext laden", errMsg);
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "failed"), "chat.failed", errMsg));
        updateActivity(
          patchActivityRun(activity, {
            finishedAt: new Date().toISOString(),
            summary: `Abgebrochen: ${errMsg}`
          })
        );
        const finishedRun = get().activeRun;
        resetFirstTokenTimeout();
        clearTimeout(totalTimeout);
        set((state) => ({
          error: errMsg,
          isSending: false,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
        }));
        return false;
      }
    } else if (resolvedWorkspaceContext) {
      beginStep("workspace-context", "Workspace-Kontext");
      finishStep(
        "workspace-context",
        "Workspace-Kontext",
        `${resolvedWorkspaceContext.sampledFiles.length} Dateien, ${resolvedWorkspaceContext.fileTree.length} im Baum`
      );
    } else {
      beginStep("workspace-context", "Workspace-Kontext");
      finishStep("workspace-context", "Workspace-Kontext", isAutoTrivial ? "Triviale Nachricht — Fast Path aktiv" : "Nicht eingebunden");
    }

    if (activeFile && !isAutoTrivial) {
      beginStep("file-context", "Aktive Datei");
      finishStep(
        "file-context",
        "Aktive Datei",
        `${activeFile.name} (${activeFile.language}, ${Math.min(activeFile.content.length, MAX_CONTEXT_CHARS)} Zeichen)`
      );
    } else {
      beginStep("file-context", "Aktive Datei");
      finishStep("file-context", "Aktive Datei", isAutoTrivial ? "Fast Path aktiv" : "Keine Datei im Editor aktiv");
    }

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
        executionIntent: classifyUserExecutionIntent(trimmedContent)
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
      let mentionedPaths = parseContextMentions(trimmedContent).map((mention) => mention.path.replace(/\\/g, "/"));
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
          const rawMentionedPaths = parseContextMentions(trimmedContent).map((mention) => mention.path);
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
        const latestUserMessage = [...nextMessages].reverse().find((message) => message.role === "user");
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
        requestMessages = nextMessages.slice(-4);
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
        let startedThisRun = false;
        try {
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

          {
            const phaseAgentGate = assertValidPhaseAgentPair(
              workflowAssignment.phase,
              workflowAssignment.effectiveAgent
            );
            if (!phaseAgentGate.ok) {
              throw new Error(`workflow_state_invalid: internal_policy_error:${initialRun.id}`);
            }
          }

          const backendUrl = useSettingsStore.getState().settings.backendUrl || "http://localhost:8000";
      let finalRoute = routing;
          let slotId: RuntimeSlotId = contextSlotId as RuntimeSlotId;
          const currentSlotStatus = await runtimeSlotManager.getSlotStatus(slotId);
          let modelToStart = bindingDecision.resolvedModelId || routing.modelId;
          if (!modelToStart || modelToStart === "default") {
            throw new Error("runtime_start_failed: binding_model_missing");
          }

          // Explicit user choice: keep the already loaded slot model (no silent swap).
      const residentModelInfo = residentModelFromStatus(currentSlotStatus, useModelIndexStore.getState().index?.models);
      if (sendOptions?.forceUseResidentModel && currentSlotStatus && residentModelInfo?.isReady) {
            modelToStart = currentSlotStatus.model_id ?? modelToStart;
            routing.modelId = modelToStart;
        finalRoute = { ...finalRoute, modelId: modelToStart, modelName: currentSlotStatus.model_name || modelToStart, selectionSource: "resident_continue" };
        bindingDecision = { ...bindingDecision, resolvedModelId: modelToStart, resolvedModelName: currentSlotStatus.model_name || modelToStart, source: "resident_continue" };

            routing.modelName =
              currentSlotStatus.model_name ||
              formatModelDisplayLabel(routing.modelName, modelToStart);
            routing.selectionSource = "resident_continue";
            appendStepDetail(
              "runtime-ondemand",
              `Fortsetzen mit residentem Modell: ${routing.modelName} (${modelToStart})`
            );
        
          } else {
            routing.modelId = modelToStart;
            routing.modelName =
              brokerDecisionFull.resolvedModelName ||
              formatModelDisplayLabel(routing.modelName, modelToStart);
          }
          syncActiveRunBindingPatch({
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
          updateActiveRun((r) =>
            appendRunEvent(
              {
                ...r,
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
            const runId = initialRun.id;
            const actionWorkspaceRoot = sendOptions?.workspaceRoot ?? "";
            const action: import("@dbzs/shared").ChatActionRequest = {
              id: `act-${Math.random().toString(36).substring(2, 10)}`,
              runId,
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
                  taskType
                }
              },
              state: "pending",
              createdAt: new Date().toISOString()
            };
            failStep("runtime-ondemand", "Arbeitsmodell laden", question.prompt);
            updateActiveRun((r) =>
              appendRunEvent(
                {
                  ...updateRunStatus(r, "waiting_for_user_answer"),
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
            clearTimeout(totalTimeout);
            // User message is already in nextMessages — do not duplicate.
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
            return false;
          }

          if (sendOptions?.acceptResourceRisk) {
            markResourceRiskAccepted(slotId, modelToStart);
          }

          // P1-Task: Pfad-Validierung
          const modelIndexEntry = useModelIndexStore.getState().index?.models.find(m => m.id === modelToStart);
          if (modelIndexEntry) {
            const validation = await pathValidatorService.validateModelPaths(modelIndexEntry);
            if (!validation.ok) {
              throw new Error(`Pfad-Validierung fehlgeschlagen: ${validation.errors.join(", ")}`);
            }
          } else {
            // Wenn das Modell nicht im Index ist, können wir den Pfad nicht validieren.
            // Dies kann bei On-the-fly-Modellen (z.B. Ollama) der Fall sein.
          }

          if (!slotNeedsStart) {
            // Resident slot: model already loaded — shorten first-token / warmup budgets.
            Object.assign(timeoutManager.config, residentSlotTimeoutOverrides());
          }

          if (slotNeedsStart) {
            const roleHint =
              taskType === "planning" || taskType === "architecture"
                ? "Planner wird bei Bedarf geladen …"
                : taskType === "review"
                  ? "Review-Modell wird bei Bedarf geladen …"
                  : requestCapabilities.requiresVision || requestCapabilities.hasImageInput
                    ? "Visionmodell wird bei Bedarf geladen …"
                    : "Arbeitsmodell wird bei Bedarf geladen …";
            appendStepDetail("runtime-ondemand", roleHint);
            updateActiveRun((r) =>
              appendRunEvent(r, "runtime.check.started", roleHint, {
                startTrigger: "post_budget_ondemand",
                slotId,
                modelId: modelToStart,
                profile: launchProfile,
                reasons: brokerDecisionFull?.reason ?? (routing.routingPath ? [String(routing.routingPath)] : [])
              })
            );
            const startResult = await runtimeSlotManager.startSlot(
              slotId,
              modelToStart,
              launchProfile
            );
            if (!startResult.success) {
              throw new Error(`target_slot_ondemand_failed: ${startResult.error ?? "unknown"}`);
            }
            startedThisRun = true;
            touchWorkModelActivity();

            const readyStatus = await runtimeSlotManager.waitForSlotReady(
              slotId,
              timeoutManager.getEndpointReady() + timeoutManager.getModelLoad()
            );
            assertStartStillValid();
            if (!readyStatus) {
              throw new Error(`endpoint_ready_timeout: slot=${slotId}`);
            }
            updateActiveRun((r) =>
              appendRunEvent(
                {
                  ...r,
                  readinessStage: "endpoint_reachable"
                },
                "runtime.check.completed",
                "runtime_endpoint_ready",
                {
                  slotId,
                  modelId: readyStatus.model_id ?? modelToStart,
                  readinessStage: "endpoint_reachable"
                }
              )
            );

            routing.modelId = readyStatus.model_id ?? modelToStart;
            routing.modelName = readyStatus.model_name ?? routing.modelName;
            routing.providerId = readyStatus.provider === "llama.cpp" ? "llama-cpp" : routing.providerId;
            if (readyStatus.context_size) {
              resolvedContextWindowTokens = readyStatus.context_size;
              // Keep displayed/finalization budget aligned with the real slot n_ctx once known.
              finalBudget = {
                ...finalBudget,
                runtimeContextLimit: readyStatus.context_size,
                overflowTokens: Math.max(0, finalBudget.totalRequiredTokens - readyStatus.context_size)
              };
              updateActiveRun((r) => ({
                ...r,
                tokenBudget: finalBudget
              }));
            }
            set({ lastRouting: routing });
            syncActiveRunBindingPatch({
              provider: routing.providerId ?? undefined,
              modelId: routing.modelId ?? undefined,
              modelName: routing.modelName ?? undefined,
              slotId: routing.slotId ?? undefined,
              tokenBudget: finalBudget
            });
          } else {
            assertStartStillValid();
            touchWorkModelActivity();
          }

          appendStepDetail("runtime-ondemand", "Inference Warm-up …");
          assertStartStillValid();
          const initialWarmupResult = await runtimeSlotManager.warmupInference(
            slotId,
            routing.modelId ?? modelToStart,
            timeoutManager.getWarmup(),
            runAbortController.signal,
            bindingDecision.decisionId
          );
          assertStartStillValid();

          const fallbackOutcome = await handleResidentFallback({
            initialWarmupResult,
            initialModelToStart: modelToStart,
            initialRoute: routing,
            currentStatus: currentSlotStatus,
            requiresVision: requestCapabilities.requiresVision,
            requiresTools: bindingDecision.protocolMode !== "none",
            signal: runAbortController.signal,
            updateActiveRun,
            appendRunEvent
          });
          const warmupResult = fallbackOutcome.warmupResult;
          if (fallbackOutcome.fallbackInitiated) {
            modelToStart = fallbackOutcome.modelToStart;
            routing = { ...routing, ...fallbackOutcome.finalRoute };
            finalRoute = routing;
            if (fallbackOutcome.finalRoute.slotId && fallbackOutcome.finalRoute.slotId !== "orchestrator_cpu") {
              contextSlotId = fallbackOutcome.finalRoute.slotId;
              slotId = fallbackOutcome.finalRoute.slotId;
            }
            set({ lastRouting: routing });
            syncActiveRunBindingPatch({
              modelId: routing.modelId ?? undefined,
              modelName: routing.modelName ?? undefined,
              slotId: routing.slotId ?? undefined,
              selectionSource: routing.selectionSource ?? undefined
            });
          } else if (fallbackOutcome.fallbackRejection) {
            const fallbackRejection = fallbackOutcome.fallbackRejection;
            updateActiveRun((r) =>
              appendRunEvent(
                { ...r, fallbackRejection },
                "runtime.fallback.initiated",
                `Fallback abgelehnt: ${fallbackRejection.reason}`,
                { modelId: fallbackRejection.modelId }
              )
            );
          }

          if (!warmupResult.ok) {
            // PRIORITÄT 3: Detaillierte Warm-up-Diagnose erfassen
            routing.warmupStatus = "failed";
            set({ lastRouting: routing });
            syncActiveRunBindingPatch({
              warmupStatus: routing.warmupStatus,
              warmupDiagnostics: warmupResult.diagnostics,
              error: {
                code: warmupResult.error === "runtime_oom" ? "runtime_oom" : "warmup_failed",
                message: warmupResult.detail ?? "Warm-up fehlgeschlagen",
                phase: "warmup"
              }
            });
            const roleLabel =
              taskType === "planning" || taskType === "architecture"
                ? "Plan"
                : taskType === "review"
                  ? "Review"
                  : taskType === "debugging"
                    ? "Debug"
                    : "Rollen";
            throw new BindingModelError(
          `Das konfigurierte ${roleLabel}-Modell konnte nicht inferenzbereit gestartet werden.${warmupResult.detail ? ` (${warmupResult.detail})` : ""}`,
          warmupResult.error === "runtime_oom" ? "runtime_oom" : "warmup_failed",
              [
                "A – dasselbe Modell mit kleinerem Runtime-Profil erneut versuchen",
                "B – ein anderes Rollenmodell auswählen",
                "C – abbrechen"
              ]
            );
          }
          routing.warmupStatus = "ready";
          set({ lastRouting: routing });
          syncActiveRunBindingPatch({
            warmupStatus: routing.warmupStatus,
            provider: routing.providerId ?? undefined,
            modelId: routing.modelId ?? undefined,
            modelName: routing.modelName ?? undefined,
            slotId: routing.slotId ?? undefined
          });
          updateActiveRun((r) => ({
            ...appendRunEvent(r, "runtime.check.completed", "runtime_inference_ready", {
              slotId,
              preview: warmupResult.detail,
              readinessStage: "inference_ready",
              tokenVerified: true
            }),
            warmupStatus: "ready",
            readinessStage: "inference_ready",
            warmupDiagnostics: warmupResult.diagnostics
          }));

          const validation = await verifySlotForRequest(
            backendUrl,
            slotId,
            routing.modelId ?? modelToStart,
            timeoutManager.getRouting(),
            runAbortController.signal
          );
          assertStartStillValid();
          if (!validation.ok) {
            throw new Error(validation.error || "Slot validation failed");
          }

          finishStep(
            "runtime-ondemand",
            "Arbeitsmodell laden",
            `Run-Modell: ${routing.modelName ?? routing.modelId} · Slot ${contextSlotId} · Warm-up: ready · Trigger: post_budget_ondemand`
          );
          updateActiveRun((r) =>
            appendRunEvent(r, "runtime.check.completed", `On-Demand bereit: ${routing.modelName ?? routing.modelId}`, {
              startTrigger: "post_budget_ondemand",
              slotId: contextSlotId,
              modelId: routing.modelId,
              reasons: brokerDecisionFull?.reason ?? []
            })
          );
        } catch (error) {
          const errMsg =
            error instanceof BindingModelError
              ? `${error.message}${error.options.length ? ` Optionen: ${error.options.join(" · ")}` : ""}`
              : error instanceof Error
                ? error.message
                : "On-Demand-Start fehlgeschlagen";
          if (startedThisRun && errMsg.startsWith("runtime_start_discarded:")) {
            try {
              await runtimeSlotManager.stopSlot(contextSlotId as RuntimeSlotId);
            } catch {
              // best effort — do not fail harder on discard cleanup
            }
          }
          failStep("runtime-ondemand", "Arbeitsmodell laden", errMsg);
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
          updateActiveRun((r) =>
            appendRunEvent(
              {
                ...updateRunStatus(r, "failed"),
                outcome: onDemandOutcome,
                error: {
                  code: onDemandOutcome,
                  message: errMsg,
                  phase: onDemandOutcome === "workflow_state_invalid" ? "routing" : "runtime"
                }
              },
              "chat.failed",
              errMsg
            )
          );
          updateActivity(
            patchActivityRun(activity, {
              finishedAt: new Date().toISOString(),
              summary: `Abgebrochen: ${errMsg}`
            })
          );
          const finishedRun = get().activeRun;
          resetFirstTokenTimeout();
          clearTimeout(totalTimeout);
          set((state) => ({
            error: errMsg,
            isSending: false,
            lastActivity: activity,
            currentActivity: null,
            activeRun: null,
            historicalRuns: finishedRun ? { ...state.historicalRuns, [finishedRun.id]: finishedRun } : state.historicalRuns
          }));
          return false;
        }
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

      const messageBytes = new TextEncoder().encode(
        serializeMessagesForHash(preparedRequest.messages)
      ).length;
      const reportedToolTokens = preparedRequest.toolPayloadTokens;
      const providerRequestDiagnostics: ProviderRequestDiagnostics = {
        endpoint: useSettingsStore.getState().settings.backendUrl || "http://127.0.0.1:8876",
        provider: bindingDecision?.providerId ?? String(sendOptions?.provider ?? routing.providerId ?? brokerDecisionFull?.providerId ?? "runtime"),
        modelId: preparedRequest.modelId,
        slotId: preparedRequest.slotId,
        sentMessageCount: preparedRequest.messages.length,
        sentToolCount: Math.max(preparedRequest.tools.length, toolEstimate.toolCount),
        sentPromptTokens: preparedRequest.promptTokens,
        sentToolTokens: reportedToolTokens,
        totalEstimatedInputTokens:
          preparedRequest.promptTokens + preparedRequest.toolPayloadTokens,
        totalRequiredTokens:
          preparedRequest.promptTokens +
          preparedRequest.toolPayloadTokens +
          preparedRequest.outputReserveTokens,
        outputReserveTokens: preparedRequest.outputReserveTokens,
        promptHash: preparedRequest.promptHash,
        toolsHash: preparedRequest.toolsHash,
        requestBodyBytes:
          preparedRequest.protocolMode === "native"
            ? messageBytes + toolEstimate.toolBodyBytes
            : messageBytes,
        toolBodyBytes: toolEstimate.toolBodyBytes,
        protocolMode: preparedRequest.protocolMode === "none" ? undefined : preparedRequest.protocolMode,
        stream: true
      };
      const providerPreflight = evaluateProviderRequestPreflight({
        preparedRequest,
        toolEstimate,
        runtimeContextLimit: finalBudget.runtimeContextLimit,
        requestBodyBytes: providerRequestDiagnostics.requestBodyBytes,
        taskType,
        currentPhase: bindingDecision?.phase ?? activeTaskContract?.currentPhase ?? workflowAssignment.phase,
        providerId: bindingDecision?.providerId ?? routing.providerId ?? brokerDecisionFull?.providerId ?? sendOptions?.provider
      });
      updateActiveRun((r) => ({
        ...r,
        providerRequestDiagnostics: {
          ...providerRequestDiagnostics,
          preflight: providerPreflight
        } as unknown as Record<string, unknown>
      }));

      if (!providerPreflight.compatible) {
        const preflightReason = providerPreflight.rejectionReasons[0] ?? "provider_request_rejected";
        const preflightMsg =
          `provider_preflight_blocked:${preflightReason}` +
          ` prompt=${providerPreflight.promptTokens}` +
          ` tools=${providerPreflight.toolTokens}` +
          ` reserve=${providerPreflight.outputReserveTokens}` +
          ` total=${providerPreflight.totalRequiredTokens}` +
          ` bytes=${providerPreflight.requestBodyBytes}`;
        failStep("llm-request", "Modell-Anfrage senden", preflightMsg);
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...updateRunStatus(r, "failed"),
              outcome: "generation_failed" satisfies RuntimeRunOutcome,
              providerRequestDiagnostics: {
                ...providerRequestDiagnostics,
                preflight: providerPreflight
              } as unknown as Record<string, unknown>,
              error: { code: preflightReason, message: preflightMsg, phase: "provider_preflight" }
            },
            "chat.failed",
            preflightMsg
          )
        );
        const finishedRun = get().activeRun;
        resetFirstTokenTimeout();
        clearTimeout(totalTimeout);
        set((state) => ({
          error: formatChatErrorForUser(new Error(preflightReason)),
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

      if (useTurnLoop && sendOptions?.workspaceRoot) {
        beginStep("llm-request", "Agent-Turn starten", "Tools + Follow-up erlaubt");
        let slotBindingState:
          | {
              slotId?: string;
              modelId?: string;
            }
          | null = null;
        if (slotValidationEnabled && contextSlotId && routing.modelId) {
          const preRequestStatus = await runtimeSlotManager.getSlotStatus(contextSlotId as RuntimeSlotId);
          const slotGate = gateSlotForRequest({
            slotId: contextSlotId as RuntimeSlotId,
            status: preRequestStatus,
            expectedModelId: routing.modelId || "",
            activeRunId: initialRun.id,
            otherActiveRunIdOnSlot: null
          });
          updateActiveRun((r) => ({
            ...appendRunEvent(
              r,
              slotGate.ok ? "runtime.check.completed" : "runtime.check.started",
              slotGate.ok ? "slot_execution_ready" : slotGate.message,
              { ...slotGate.state }
            ),
            slotExecutionState: slotGate.state
          }));
          slotBindingState = {
            slotId: slotGate.state.slotId,
            modelId: slotGate.state.modelId
          };
          if (!slotGate.ok) {
            throw new BindingModelError(
              slotGate.message,
              slotGate.code === "binding_mismatch" ? "binding_mismatch" : "slot_busy",
              slotGate.code === "slot_busy"
                ? ["A – warten und erneut senden", "B – anderen Slot wählen", "C – abbrechen"]
                : ["A – Slot neu starten", "B – Rollenmodell prüfen", "C – abbrechen"]
            );
          }
          if (shouldApplySlowInferenceTimeouts(slotGate.state.gpuLayers)) {
            Object.assign(
              timeoutManager.config,
              applyCpuSafeTimeoutOverrides(
                timeoutManager.config,
                useSettingsStore.getState().settings
              )
            );
          }
        }
        const bindingCheck = assertRuntimeBindingConsistency({
          bindingDecision: bindingDecision!,
          preparedRequest,
          slotExecutionState: slotBindingState,
          providerRequest: providerRequestDiagnostics
        });
        updateActiveRun((r) => ({
          ...r,
          providerRequestDiagnostics: {
            ...providerRequestDiagnostics,
            preflight: providerPreflight,
            bindingDiagnostics: bindingCheck.diagnostics
          } as unknown as Record<string, unknown>
        }));
        if (!bindingCheck.ok) {
          const mismatchMsg = `request_binding_mismatch: ${bindingCheck.diagnostics.mismatches.join(",")}`;
          failStep("llm-request", "Agent-Turn starten", mismatchMsg);
          updateActiveRun((r) =>
            appendRunEvent(
              {
                ...updateRunStatus(r, "failed"),
                outcome: "request_binding_mismatch" satisfies RuntimeRunOutcome,
                providerRequestDiagnostics: {
                  ...providerRequestDiagnostics,
                  preflight: providerPreflight,
                  bindingDiagnostics: bindingCheck.diagnostics
                } as unknown as Record<string, unknown>,
                error: { code: "request_binding_mismatch", message: mismatchMsg, phase: "binding" }
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
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "streaming"), "model.request.started", "Agent-Turn Loop gestartet"));
        set({
          messages: [...nextMessages, { id: `msg-${Date.now().toString(36)}-assistant`, role: "assistant", content: "", toolCalls: [] }],
          isStreaming: true,
          error: null
        });

        const runId = `run-${Date.now().toString(36)}`;
        let lastAgentStreamUiUpdateAt = 0;
        
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
          onPatchProposal: async (proposal) => {
            safeTraceEvents.push(createTraceEvent(initialRun.id, "patch_proposed", "Patch vorgeschlagen", `${proposal.changes.length} Dateiänderungen vorbereitet`));
            await get().receivePatchProposal({
              ...proposal,
              runId: initialRun.id,
              decisionId: brokerDecisionFull?.decisionId ?? proposal.decisionId ?? undefined,
              workspaceRoot: sendOptions.workspaceRoot ?? undefined,
              changes: proposal.changes.map((change) => ({
                ...change,
                runId: initialRun.id,
                decisionId: brokerDecisionFull?.decisionId ?? change.decisionId ?? undefined
              }))
            });
            updateActiveRun((r) =>
              appendRunEvent(r, "file.change.proposed", `Patch Proposal ${proposal.id} vorbereitet`)
            );
          },
          onStreamUpdate: (content, turn, toolCalls) => {
            for (const tool of toolCalls ?? []) {
              const eventId = `trace-tool-${tool.id}`;
              const existingIndex = safeTraceEvents.findIndex((event) => event.id === eventId);
              const at = new Date().toISOString();
              const event: ReasoningTraceEvent = {
                id: eventId, runId: initialRun.id,
                kind: tool.status === "running" ? "tool_started" : "tool_completed",
                title: `Tool: ${tool.name}`,
                summary: tool.status === "error" ? (tool.outputSummary ?? "Tool fehlgeschlagen") : tool.status === "running" ? "Ausführung läuft" : "Ausführung abgeschlossen",
                status: tool.status === "error" ? "failed" : tool.status === "running" ? "running" : "completed",
                startedAt: at, completedAt: tool.status === "running" ? undefined : at,
                metadata: { toolName: tool.name }
              };
              if (existingIndex >= 0) safeTraceEvents[existingIndex] = event;
              else safeTraceEvents.push(event);
            }
            updateActiveRun((r) => {
              const shouldCountFirstToken = !r.firstTokenAt && isModelContentDelta(content);
              const withToken = shouldCountFirstToken
                ? { ...r, firstTokenAt: new Date().toISOString(), status: "streaming" as const }
                : r.firstTokenAt
                  ? r
                  : { ...r, status: "streaming" as const };
              const updatedEvents = shouldCountFirstToken
                ? appendRunEvent(r, "model.first_token", "Erstes Token empfangen").events
                : r.events;

              // First-Token: Pre-Token-Watchdogs → Idle/Generation (real model content only)
              if (shouldCountFirstToken) {
                onStreamTokenActivity();
              }

              // Map tools from internal structures
              const mappedTools: RuntimeChatToolCall[] = (toolCalls || []).map((t) => ({
                id: t.id,
                name: t.name,
                toolCallId: t.id,
                status: t.status === "running" ? "running" as const : t.status === "error" ? "failed" as const : "completed" as const,
                arguments: t.input ? JSON.stringify(t.input) : "{}",
                filePath: t.filePath,
                startedAt: r.startedAt
              }));

              return {
                ...withToken,
                events: updatedEvents,
                toolCalls: mappedTools
              };
            });
            updateActivity(
              patchActivitySteps(
                activity,
                upsertActivityStep(
                  activity.steps,
                  "llm-request",
                  "Modell-Anfrage senden",
                  "running",
                  turn > 0 ? `Turn ${turn} · ${content.length} Zeichen` : `Streaming … ${content.length} Zeichen`
                )
              )
            );
            const now = Date.now();
            const shouldRefreshStreamUi =
              !conversationControlV2Enabled ||
              toolCalls.length > 0 ||
              now - lastAgentStreamUiUpdateAt >= STREAMING_UI_THROTTLE_MS;
            if (shouldRefreshStreamUi) {
              if (conversationControlV2Enabled) {
                set((state) => ({
                  messages: state.messages.map((message, index) =>
                    index === state.messages.length - 1 && message.role === "assistant"
                      ? mergeStreamingAssistantMessage({
                          message,
                          content,
                          rawContent: content,
                          toolCalls
                        })
                      : message
                  )
                }));
              } else {
                const { reasoningSummary, planProposal, cleanContent } = extractReasoningSummary(content);
                set((state) => ({
                  messages: state.messages.map((message, index) =>
                    index === state.messages.length - 1 && message.role === "assistant"
                      ? mergeStreamingAssistantMessage({
                          message,
                          content: cleanContent,
                          reasoningSummary,
                          planProposal,
                          toolCalls
                        })
                      : message
                  ),
                  planProposalsById: planProposal && !state.planProposalsById[planProposal.id]
                    ? { ...state.planProposalsById, [planProposal.id]: planProposal }
                    : state.planProposalsById
                }));
              }
              lastAgentStreamUiUpdateAt = now;
            }
          },
          onTurnStart: (turn) => {
            appendStepDetail("llm-request", `Turn ${turn}`);
          },
          onActivityDetail: (line) => appendStepDetail("llm-request", line)
        });

        // AbortController wird im finally-Block bereinigt
        set({ isStreaming: false });

        finishStep(
          "llm-request",
          "Modell-Anfrage senden",
          `Agent-Loop fertig · ${agentResult.turnsExecuted ?? 0} Turns`
        );

        let agentAssistantContent = agentResult.assistantMessage.content;
        const agentPlanningLike =
          taskType === "planning" ||
          taskType === "architecture" ||
          activeTaskContract?.currentPhase === "planning";
        let agentRelevanceFailed = false;
        if (agentPlanningLike && typeof agentAssistantContent === "string") {
          const verifiedPaths = verifiedPathsList(verifiedEvidence);
          const gated = await applyPlanningRelevanceGate({
            answer: agentAssistantContent,
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
          agentAssistantContent = gated.content;
          agentRelevanceFailed = gated.outcome === "answer_relevance_failed";
        }

        const resultMessages: RuntimeChatMessage[] = [...get().messages];
        const lastIndex = resultMessages.length - 1;
        let finalizedAssistantMessage: RuntimeChatMessage;
        const gatedAssistantMessage = {
          ...agentResult.assistantMessage,
          content: agentAssistantContent,
          rawContent: agentResult.assistantMessage.rawContent ?? agentAssistantContent,
          visibleContent: agentAssistantContent
        };
        if (lastIndex >= 0 && resultMessages[lastIndex]?.role === "assistant") {
          finalizedAssistantMessage = mergeAssistantMessageState(
            resultMessages[lastIndex],
            gatedAssistantMessage,
            { workspaceRoot: sendOptions?.workspaceRoot ?? undefined }
          );
          const completedEvent = createTraceEvent(initialRun.id, "run_completed", "Antwort abgeschlossen", `${agentResult.turnsExecuted ?? 0} Agent-Turns ausgeführt`);
          safeTraceEvents.push(completedEvent);
          try {
            const persistedTrace = runtimeFlags.reasoningTraceEnabled === false
              ? null
              : await traceClient.append(initialRun.id, safeTraceEvents);
            resultMessages[lastIndex] = {
              ...finalizedAssistantMessage,
              traceEvents: persistedTrace?.events ?? safeTraceEvents,
              safeReasoningSummary: persistedTrace?.summary,
              retrievalManifest: ragResult?.manifest,
              contextManifest: spoolerManifest ?? undefined,
              sourceReferences: ragResult?.sourceReferences
            };
          } catch (error) {
            console.warn("Execution trace persistence failed:", error);
            resultMessages[lastIndex] = {
              ...finalizedAssistantMessage,
              traceEvents: safeTraceEvents,
              retrievalManifest: ragResult?.manifest,
              contextManifest: spoolerManifest ?? undefined,
              sourceReferences: ragResult?.sourceReferences
            };
          }
        } else {
          finalizedAssistantMessage = mergeAssistantMessageState(
            {
              id: agentResult.assistantMessage.id,
              role: agentResult.assistantMessage.role,
              content: "",
              rawContent: "",
              visibleContent: ""
            },
            gatedAssistantMessage,
            { workspaceRoot: sendOptions?.workspaceRoot ?? undefined }
          );
          resultMessages.push(finalizedAssistantMessage);
        }
        for (const sys of agentResult.systemMessages) {
          resultMessages.push(sys);
        }

        const waitingForPlanApproval = hasPendingPlanApproval(finalizedAssistantMessage);
        const lastResponse = agentResult.lastResponse as
          | {
              safe_fallback?: boolean;
              finish_reason?: string | null;
              provider_error?: unknown;
            }
          | null
          | undefined;
        const completedToolCalls =
          agentResult.toolCallsExecuted ?? agentResult.assistantMessage.toolCalls?.length ?? 0;
        const providerErrorPresent =
          Boolean(lastResponse?.provider_error) || lastResponse?.safe_fallback === true;
        const executionGate = gateExecutionFinalAnswer({
          userMessage: trimmedContent,
          executionIntent: classifyUserExecutionIntent(trimmedContent),
          finalAnswer: agentAssistantContent,
          toolCallsExecuted: completedToolCalls,
          toolNames: (agentResult.assistantMessage.toolCalls ?? []).map((call) => call.name),
          toolsEnabled,
          workspaceRoot: sendOptions?.workspaceRoot ?? null
        });
        const terminalReason = agentResult.terminalReason;
        const terminalOutcome: RuntimeRunOutcome | null =
          terminalReason === "execution_no_action"
            ? "execution_no_action"
            : terminalReason === "invalid_protocol"
              ? "invalid_protocol"
              : terminalReason === "skill_tool_policy_violation"
                ? "skill_tool_policy_violation"
              : null;
        const executionRejected =
          !waitingForPlanApproval &&
          !agentRelevanceFailed &&
          !providerErrorPresent &&
          (Boolean(terminalOutcome) || executionGate.rejectAsInvalid);
        const gatedFinalAnswer = executionRejected
          ? (terminalOutcome
              ? terminalReason === "execution_no_action"
                ? "Im Ausführungsmodus wurden keine Tools, Patches oder Commands ausgeführt."
                : terminalReason === "skill_tool_policy_violation"
                  ? "Der aktive Skill hat einen nicht erlaubten Tool-Aufruf blockiert."
                  : "Die strukturierte Agent-Ausgabe war ungültig (Protocol Failure)."
              : (executionGate.userMessage ?? agentAssistantContent))
          : agentAssistantContent;
        if (executionRejected && lastIndex >= 0 && resultMessages[lastIndex]?.role === "assistant") {
          resultMessages[lastIndex] = {
            ...resultMessages[lastIndex],
            content: gatedFinalAnswer,
            visibleContent: gatedFinalAnswer,
            rawContent: agentAssistantContent
          };
        }
        const finalization = finalizeRuntimeRun({
          runId: initialRun.id,
          outcome: agentRelevanceFailed
            ? "answer_relevance_failed"
            : waitingForPlanApproval
              ? "needs_user_input"
              : providerErrorPresent
                ? "generation_failed"
              : terminalOutcome
                ? terminalOutcome
                : executionRejected
                  ? "agent_output_invalid"
                  : "success",
          finalAnswer: gatedFinalAnswer,
          safeFallback: lastResponse?.safe_fallback === true,
          providerError: providerErrorPresent,
          parserSkippedReason: providerErrorPresent ? "provider_error" : undefined,
          agentTurnCount: agentResult.turnsExecuted ?? 0,
          pendingToolCalls: 0,
          completedToolCalls,
          trajectoryStatus: agentResult.trajectory?.status ?? null,
          modelId: routing.modelId,
          modelName: routing.modelName,
          slotId: contextSlotId,
          finishReason: lastResponse?.finish_reason ?? null,
          rawContent: agentResult.assistantMessage.rawContent ?? agentAssistantContent,
          pipeline: {
            runtimeReady: true,
            inferenceReady: routing.warmupStatus === "ready" || routing.warmupStatus == null,
            firstTokenReceived: Boolean(get().activeRun?.firstTokenAt),
            modelOutputReceived: Boolean((gatedFinalAnswer ?? "").trim() || lastResponse?.safe_fallback),
            outputParsed: providerErrorPresent
              ? false
              : !agentRelevanceFailed && !executionRejected,
            agentLoopCompleted: true,
            finalAnswerDelivered: false
          },
          contextWindowTokens: get().activeRun?.tokenBudget?.runtimeContextLimit ?? null,
          totalRequiredTokens: get().activeRun?.tokenBudget?.totalRequiredTokens ?? null
        });
        const persistedAgentTurn = buildRunTurnSnapshot({
          turnNumber: agentResult.turnsExecuted ?? 1,
          prompt: trimmedContent,
          response: agentResult.assistantMessage.rawContent ?? agentAssistantContent,
          startedAt: get().activeRun?.startedAt,
          finishedAt: new Date().toISOString()
        });

        if (finalization.suppressAssistantSuccess) {
          const errorBubble = finalization.error?.userMessage ?? finalization.userMessage;
          if (lastIndex >= 0 && resultMessages[lastIndex]?.role === "assistant") {
            resultMessages[lastIndex] = {
              ...resultMessages[lastIndex],
              content: "",
              visibleContent: "",
              rawContent: agentAssistantContent
            };
          }
          resultMessages.push({
            id: createMessageId("run-error"),
            role: "system",
            content: [
              `✗ ${errorBubble}`,
              finalization.error?.stage ? `Stufe: ${finalization.error.stage}` : null,
              `Diagnose-ID: ${initialRun.id}`,
              finalization.outcome === "context_overflow"
                ? "Hinweis: Anfrage kürzer erneut senden oder Context-Profil erhöhen."
                : null
            ]
              .filter(Boolean)
              .join("\n")
          });
        }

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
            summary:
              finalization.outcome === "success"
                ? `Fertig in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
                : finalization.userMessage
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
        const finalActiveRun = get().activeRun;
        set((state) => {
          const nextPlanProposalsById =
            finalizedAssistantMessage.planProposal && !state.planProposalsById[finalizedAssistantMessage.planProposal.id]
              ? { ...state.planProposalsById, [finalizedAssistantMessage.planProposal.id]: finalizedAssistantMessage.planProposal }
              : state.planProposalsById;
          const syncedRuntimeActions = syncRuntimeAgentActions(resultMessages, nextPlanProposalsById);
          return {
            messages: syncedRuntimeActions.messages,
            agentActionsById: syncedRuntimeActions.agentActionsById,
            isSending: false,
            isStreaming: false,
            error: finalization.outcome === "success" || finalization.outcome === "needs_user_input"
              ? null
              : finalization.userMessage,
            lastActivity: activity,
            currentActivity: null,
            lastTrajectory: agentResult.trajectory,
            toolProfile: profile,
            activeRun: null,
            planProposalsById: nextPlanProposalsById,
            historicalRuns: finalActiveRun ? { ...state.historicalRuns, [finalActiveRun.id]: finalActiveRun } : state.historicalRuns
          };
        });
        return finalization.outcome === "success" || finalization.outcome === "needs_user_input";
      }

      beginStep("llm-request", "Modell-Anfrage senden", "Streaming-Antwort wird empfangen ...");
      let slotBindingState:
        | {
            slotId?: string;
            modelId?: string;
          }
        | null = null;
      if (slotValidationEnabled && contextSlotId && routing.modelId) {
        const preStreamStatus = await runtimeSlotManager.getSlotStatus(contextSlotId as RuntimeSlotId);
        const streamSlotGate = gateSlotForRequest({
          slotId: contextSlotId as RuntimeSlotId,
          status: preStreamStatus,
          expectedModelId: routing.modelId || "",
          activeRunId: initialRun.id,
          otherActiveRunIdOnSlot: null
        });
        updateActiveRun((r) => ({
          ...appendRunEvent(
            r,
            streamSlotGate.ok ? "runtime.check.completed" : "runtime.check.started",
            streamSlotGate.ok ? "slot_execution_ready" : streamSlotGate.message,
            { ...streamSlotGate.state }
          ),
          slotExecutionState: streamSlotGate.state
        }));
        slotBindingState = {
          slotId: streamSlotGate.state.slotId,
          modelId: streamSlotGate.state.modelId
        };
        if (!streamSlotGate.ok) {
          throw new BindingModelError(
            streamSlotGate.message,
            streamSlotGate.code === "binding_mismatch" ? "binding_mismatch" : "slot_busy",
            streamSlotGate.code === "slot_busy"
              ? ["A – warten und erneut senden", "B – anderen Slot wählen", "C – abbrechen"]
              : ["A – Slot neu starten", "B – Rollenmodell prüfen", "C – abbrechen"]
          );
        }
      }
      const streamBindingCheck = assertRuntimeBindingConsistency({
        bindingDecision: bindingDecision!,
        preparedRequest,
        slotExecutionState: slotBindingState,
        providerRequest: providerRequestDiagnostics
      });
      updateActiveRun((r) => ({
        ...r,
        providerRequestDiagnostics: {
          ...providerRequestDiagnostics,
          preflight: providerPreflight,
          bindingDiagnostics: streamBindingCheck.diagnostics
        } as unknown as Record<string, unknown>
      }));
      if (!streamBindingCheck.ok) {
        const mismatchMsg = `request_binding_mismatch: ${streamBindingCheck.diagnostics.mismatches.join(",")}`;
        failStep("llm-request", "Modell-Anfrage senden", mismatchMsg);
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...updateRunStatus(r, "failed"),
              outcome: "request_binding_mismatch" satisfies RuntimeRunOutcome,
              providerRequestDiagnostics: {
                ...providerRequestDiagnostics,
                preflight: providerPreflight,
                bindingDiagnostics: streamBindingCheck.diagnostics
              } as unknown as Record<string, unknown>,
              error: { code: "request_binding_mismatch", message: mismatchMsg, phase: "binding" }
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
      updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "streaming"), "model.request.started", "Streaming gestartet"));

      set({
        messages: [...nextMessages, { id: `msg-${Date.now().toString(36)}-asst`, role: "assistant", content: "" }],
        isStreaming: true
      });

      let streamedContent = "";
      let lastStreamProgressChars = 0;
      let lastStreamUiUpdateAt = 0;

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
          decision_id: bindingDecision?.decisionId ?? brokerDecisionFull?.decisionId ?? initialRun.id
        },
        (delta, totalLength) => {
          updateActiveRun((r) => {
            const shouldCountFirstToken = !r.firstTokenAt && isModelContentDelta(delta);
            const withToken = shouldCountFirstToken
              ? { ...r, firstTokenAt: new Date().toISOString() }
              : r;
            const updatedEvents = shouldCountFirstToken
              ? appendRunEvent(r, "model.first_token", "Erstes Token empfangen").events
              : r.events;

            // First token / stream activity: only real model content deltas
            if (shouldCountFirstToken) {
              onStreamTokenActivity();
            }

            return {
              ...withToken,
              events: updatedEvents
            };
          });
          streamedContent += delta;
          if (conversationControlV2Enabled) {
            const now = Date.now();
            if (now - lastStreamUiUpdateAt >= STREAMING_UI_THROTTLE_MS) {
              lastStreamUiUpdateAt = now;
              set((state) => ({
                messages: state.messages.map((message, index) =>
                  index === state.messages.length - 1 && message.role === "assistant"
                    ? mergeStreamingAssistantMessage({
                        message,
                        content: streamedContent,
                        rawContent: streamedContent
                      })
                    : message
                )
              }));
            }
          } else {
            const { reasoningSummary, planProposal, cleanContent } = extractReasoningSummary(streamedContent);
            set((state) => ({
              messages: state.messages.map((message, index) =>
                index === state.messages.length - 1 && message.role === "assistant"
                  ? mergeStreamingAssistantMessage({
                      message,
                      content: cleanContent,
                      reasoningSummary,
                      planProposal
                    })
                  : message
              ),
              planProposalsById: planProposal && !state.planProposalsById[planProposal.id]
                ? { ...state.planProposalsById, [planProposal.id]: planProposal }
                : state.planProposalsById
            }));

            if (planProposal) {
              set((state) => ({
                lastActivity: state.lastActivity
                  ? {
                      ...state.lastActivity,
                      summary: `Plan erkannt: ${planProposal.title}`
                    }
                  : state.lastActivity,
                activeRun: state.activeRun
                  ? updateRunStatus(
                      appendRunEvent(state.activeRun, "chat.accepted", "Planfreigabe erwartet"),
                      "waiting_for_plan_approval"
                    )
                  : state.activeRun
              }));
            }
          }

          if (totalLength - lastStreamProgressChars >= 200) {
            lastStreamProgressChars = totalLength;
            updateActivity(
              patchActivitySteps(
                activity,
                upsertActivityStep(
                  activity.steps,
                  "llm-request",
                  "Modell-Anfrage senden",
                  "running",
                  `Streaming … ${totalLength} Zeichen empfangen`
                )
              )
            );
          }
        },
        runAbortController.signal
      );
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

      beginStep("response-process", "Antwort auswerten");

      const currentMessages = get().messages;
      const currentLastIndex = currentMessages.length - 1;
      const currentAssistantMessage =
        currentLastIndex >= 0 && currentMessages[currentLastIndex]?.role === "assistant"
          ? currentMessages[currentLastIndex]
          : null;
      const finalizedAssistantMessage = currentAssistantMessage
        ? mergeAssistantMessageState(currentAssistantMessage, {
            ...response.message,
            rawContent: response.message.rawContent ?? response.message.content,
            visibleContent: response.message.visibleContent ?? response.message.content
          }, { workspaceRoot: sendOptions?.workspaceRoot ?? undefined })
        : null;

      if (finalizedAssistantMessage) {
        set((state) => {
          const updatedMessages = state.messages.map((message, index) =>
            index === state.messages.length - 1 && message.role === "assistant"
              ? finalizedAssistantMessage
              : message
          );
          const nextPlanProposalsById =
            finalizedAssistantMessage.planProposal && !state.planProposalsById[finalizedAssistantMessage.planProposal.id]
              ? { ...state.planProposalsById, [finalizedAssistantMessage.planProposal.id]: finalizedAssistantMessage.planProposal }
              : state.planProposalsById;
          const syncedRuntimeActions = syncRuntimeAgentActions(updatedMessages, nextPlanProposalsById);
          return {
            messages: syncedRuntimeActions.messages,
            agentActionsById: syncedRuntimeActions.agentActionsById,
            planProposalsById: nextPlanProposalsById
          };
        });
      }

      const workspaceRootPath = resolvedWorkspaceContext?.rootPath ?? null;

      const shouldTryChangePayload =
        response.message.role === "assistant" &&
        workspaceRootPath &&
        looksLikeAgentChangeJson(response.message.content);

      let patchCount = 0;
      let patchDetected = false;

      if (shouldTryChangePayload && workspaceRootPath) {
        try {
          const proposedChanges = parseAgentOutputToProposedChanges(response.message.content, {
            agentId: "runtime-chat",
            workspaceRoot: workspaceRootPath
          });
          patchCount = proposedChanges.length;
          patchDetected = patchCount > 0;
          if (patchDetected) safeTraceEvents.push(createTraceEvent(initialRun.id, "patch_proposed", "Patch vorgeschlagen", `${patchCount} Dateiänderungen vorbereitet`));
          
          // Mappe proposedChanges auf activeRun.fileChanges
          updateActiveRun((r) => {
            const fileChanges = [...r.fileChanges];
            proposedChanges.forEach((change) => {
              // Vermeide Duplikate
              if (!fileChanges.some((fc) => fc.id === change.id)) {
                // Berechne grob additions/deletions wenn moeglich
                const lines = change.proposedContent.split("\n");
                fileChanges.push({
                  id: change.id,
                  filePath: change.filePath,
                  additions: lines.length, // Als Naherung
                  deletions: 0,
                  diff: change.proposedContent,
                  status: "proposed",
                  timestamp: new Date().toISOString()
                });
              }
            });
            return { ...r, fileChanges };
          });

          await useEditorStore.getState().queueProposedChanges(proposedChanges);
          finishStep(
            "response-process",
            "Antwort auswerten",
            `${patchCount} Patch-Vorschlag/Vorschlaege erkannt und vorbereitet`
          );
        } catch (error) {
          if (error instanceof AgentOutputParseError) {
            finishStep(
              "response-process",
              "Antwort auswerten",
              `Patch-JSON erkannt, aber nicht anwendbar: ${error.message}`
            );
          } else {
            throw error;
          }
        }
      } else {
        finishStep(
          "response-process",
          "Antwort auswerten",
          patchDetected ? `${patchCount} Patches` : "Freitext-Antwort, kein Patch-JSON"
        );
      }

      const runtimeToolSummaries: string[] = [];
      let streamToolNames: string[] = [];
      if (toolsEnabled && sendOptions?.workspaceRoot) {
        beginStep("runtime-tools", "Desktop-Tools");
        const toolCalls = parseRuntimeToolCallsFromAssistant(response.message.content);
        streamToolNames = toolCalls.map((call) => call.name);
        for (const call of toolCalls) {
          try {
            safeTraceEvents.push(createTraceEvent(initialRun.id, "tool_started", `Tool: ${call.name}`, "Desktop-Tool gestartet", "running"));
            appendStepDetail("runtime-tools", `${call.name} …`);
            const result = await useRuntimeAgentStore.getState().runTool(
              buildRuntimeToolRequest(call.name, sendOptions.workspaceRoot, call.input)
            );
            collectEvidenceFromToolResult(
              verifiedEvidence,
              call.name,
              result.output,
              sendOptions.workspaceRoot
            );
            runtimeToolSummaries.push(
              `[Desktop Tool ${call.name}]\nStatus: ${result.status}\n${JSON.stringify(result.output, null, 2).slice(0, 3000)}`
            );
            safeTraceEvents.push(createTraceEvent(initialRun.id, "tool_completed", `Tool: ${call.name}`, `Status: ${result.status}`, result.status === "ok" ? "completed" : "failed"));
            if (call.name === "apply_patch" && result.status === "ok" && result.output) {
              const output = result.output as {
                filePath?: string;
                afterContent?: string;
              };
              if (output.afterContent && output.filePath) {
                await useEditorStore.getState().queueProposedChanges([
                  {
                    id: `tool-patch-${Date.now()}`,
                    agentId: "runtime-chat",
                    filePath: output.filePath,
                    proposedContent: output.afterContent,
                    reason: "Runtime tool apply_patch preview",
                    createdAt: new Date().toISOString(),
                    status: "pending"
                  }
                ]);
                patchDetected = true;
                patchCount += 1;
              }
            }
          } catch (error) {
            runtimeToolSummaries.push(
              `[Desktop Tool ${call.name}] Fehler: ${error instanceof Error ? error.message : "unbekannt"}`
            );
            safeTraceEvents.push(createTraceEvent(initialRun.id, "tool_completed", `Tool: ${call.name}`, error instanceof Error ? error.message : "Tool fehlgeschlagen", "failed"));
          }
        }
        finishStep("runtime-tools", "Desktop-Tools", `${toolCalls.length} Aufruf(e)`);
      }

      let assistantContent = response.message.content;
      const isPlanningLike =
        taskType === "planning" ||
        taskType === "architecture" ||
        activeTaskContract?.currentPhase === "planning";
      if (isPlanningLike && typeof assistantContent === "string") {
        const verifiedPaths = verifiedPathsList(verifiedEvidence);
        const gated = await applyPlanningRelevanceGate({
          answer: assistantContent,
          confirmedGoal: activeTaskContract?.confirmedGoal ?? trimmedContent,
          acceptanceCriteria: activeTaskContract?.acceptanceCriteria ?? [],
          verifiedPaths,
          toolResultCount: runtimeToolSummaries.length + verifiedPaths.length,
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
        assistantContent = gated.content;
        if (gated.outcome === "answer_relevance_failed") {
          updateActiveRun((r) => ({
            ...r,
            outcome: "answer_relevance_failed",
            status: "failed"
          }));
        }
      }

      const protocolMessage =
        sendOptions?.showAnalysisProtocol === false
          ? null
          : buildResponseAnalysisMessage({
              routing,
              workspaceContext: resolvedWorkspaceContext,
              activeFile,
              historyMessageCount: requestMessages.length,
              systemContextCount: systemMessages.length,
              responseLength: assistantContent.length,
              modelId: response.model_id,
              modelName: response.model_name ?? routing.modelName,
              patchDetected,
              patchCount,
              durationMs: Date.now() - startedAt
            });

      const resultMessages: RuntimeChatMessage[] = [...get().messages];
      for (const summary of runtimeToolSummaries) {
        resultMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: summary });
      }
      if (protocolMessage) {
        resultMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: protocolMessage });
      }

      safeTraceEvents.push(createTraceEvent(initialRun.id, "run_completed", "Antwort ausgewertet", `${patchCount} Patch-Vorschläge · ${runtimeToolSummaries.length} Tool-Ergebnisse`));
      let assistantIndex = -1;
      for (let index = resultMessages.length - 1; index >= 0; index -= 1) {
        if (resultMessages[index]?.role === "assistant") { assistantIndex = index; break; }
      }
      if (assistantIndex >= 0) {
        try {
          const persistedTrace = runtimeFlags.reasoningTraceEnabled === false ? null : await traceClient.append(initialRun.id, safeTraceEvents);
          resultMessages[assistantIndex] = {
            ...resultMessages[assistantIndex],
            content: assistantContent,
            traceEvents: persistedTrace?.events ?? safeTraceEvents,
            safeReasoningSummary: persistedTrace?.summary,
            retrievalManifest: ragResult?.manifest,
            contextManifest: spoolerManifest ?? undefined,
            sourceReferences: ragResult?.sourceReferences
          };
        } catch (error) {
          console.warn("Execution trace persistence failed:", error);
          resultMessages[assistantIndex] = {
            ...resultMessages[assistantIndex],
            content: assistantContent,
            traceEvents: safeTraceEvents,
            retrievalManifest: ragResult?.manifest,
            contextManifest: spoolerManifest ?? undefined,
            sourceReferences: ragResult?.sourceReferences
          };
        }
      }

      const waitingForPlanApproval = finalizedAssistantMessage ? hasPendingPlanApproval(finalizedAssistantMessage) : false;
      const priorOutcome = get().activeRun?.outcome;
      const responseProviderError = Boolean((response as { provider_error?: unknown }).provider_error);
      const responseSafeFallback =
        (response as { safe_fallback?: boolean }).safe_fallback === true ||
        responseProviderError ||
        isGenericRuntimeErrorSentinel(assistantContent);
      const streamExecutionGate = gateExecutionFinalAnswer({
        userMessage: trimmedContent,
        executionIntent: classifyUserExecutionIntent(trimmedContent),
        finalAnswer: assistantContent,
        toolCallsExecuted: runtimeToolSummaries.length,
        toolNames: streamToolNames,
        toolsEnabled,
        workspaceRoot: sendOptions?.workspaceRoot ?? null
      });
      const streamExecutionRejected =
        priorOutcome !== "answer_relevance_failed" &&
        !waitingForPlanApproval &&
        !responseSafeFallback &&
        streamExecutionGate.rejectAsInvalid;
      const streamGatedAnswer = streamExecutionRejected
        ? (streamExecutionGate.userMessage ?? assistantContent)
        : assistantContent;
      if (streamExecutionRejected && assistantIndex >= 0) {
        resultMessages[assistantIndex] = {
          ...resultMessages[assistantIndex],
          content: streamGatedAnswer,
          visibleContent: streamGatedAnswer,
          rawContent: assistantContent
        };
      }
      const streamFinalization = finalizeRuntimeRun({
        runId: initialRun.id,
        outcome:
          priorOutcome === "answer_relevance_failed"
            ? "answer_relevance_failed"
            : waitingForPlanApproval
              ? "needs_user_input"
              : responseSafeFallback
                ? "generation_failed"
              : streamExecutionRejected
                ? "agent_output_invalid"
                : "success",
        finalAnswer: streamGatedAnswer,
        safeFallback: responseSafeFallback,
        providerError: responseSafeFallback,
        parserSkippedReason: responseSafeFallback ? "provider_error" : undefined,
        agentTurnCount: 1,
        pendingToolCalls: 0,
        completedToolCalls: runtimeToolSummaries.length,
        modelId: routing.modelId ?? response.model_id,
        modelName: routing.modelName ?? response.model_name,
        slotId: contextSlotId,
        finishReason: (response as { finish_reason?: string | null }).finish_reason ?? null,
        rawContent: assistantContent,
        pipeline: {
          runtimeReady: true,
          inferenceReady: routing.warmupStatus === "ready" || routing.warmupStatus == null,
          firstTokenReceived: Boolean(get().activeRun?.firstTokenAt),
          modelOutputReceived: Boolean((streamGatedAnswer ?? "").trim() || responseSafeFallback),
          outputParsed:
            !responseSafeFallback &&
            priorOutcome !== "answer_relevance_failed" &&
            !streamExecutionRejected,
          agentLoopCompleted: true,
          finalAnswerDelivered: false
        },
        contextWindowTokens: get().activeRun?.tokenBudget?.runtimeContextLimit ?? null,
        totalRequiredTokens: get().activeRun?.tokenBudget?.totalRequiredTokens ?? null
      });
      const persistedStreamTurn = buildRunTurnSnapshot({
        turnNumber: 1,
        prompt: trimmedContent,
        response: response.message.content ?? assistantContent,
        startedAt: get().activeRun?.startedAt,
        finishedAt: new Date().toISOString()
      });

      if (streamFinalization.suppressAssistantSuccess) {
        if (assistantIndex >= 0) {
          resultMessages[assistantIndex] = {
            ...resultMessages[assistantIndex],
            content: "",
            visibleContent: "",
            rawContent: assistantContent
          };
        }
        resultMessages.push({
          id: createMessageId("run-error"),
          role: "system",
          content: [
            `✗ ${streamFinalization.error?.userMessage ?? streamFinalization.userMessage}`,
            streamFinalization.error?.stage ? `Stufe: ${streamFinalization.error.stage}` : null,
            `Diagnose-ID: ${initialRun.id}`,
            streamFinalization.outcome === "context_overflow"
              ? "Hinweis: Anfrage kürzer erneut senden oder Context-Profil erhöhen."
              : null
          ]
            .filter(Boolean)
            .join("\n")
        });
      }

      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary:
            streamFinalization.outcome === "success"
              ? `Fertig in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
              : streamFinalization.userMessage
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
      const lastActiveRun = get().activeRun;

      // Timeouts bereinigen
      resetFirstTokenTimeout();
      clearTimeout(totalTimeout);

      set((state) => {
        const syncedRuntimeActions = syncRuntimeAgentActions(resultMessages, state.planProposalsById);
        return {
          messages: syncedRuntimeActions.messages,
          agentActionsById: syncedRuntimeActions.agentActionsById,
          isSending: false,
          isStreaming: false,
          error:
            streamFinalization.outcome === "success" || streamFinalization.outcome === "needs_user_input"
              ? null
              : streamFinalization.userMessage,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
        };
      });
      return streamFinalization.outcome === "success" || streamFinalization.outcome === "needs_user_input";
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
          const finalized = finalizeRuntimeRun({
            runId: initialRun.id,
            outcome,
            finalAnswer: null,
            modelId: routing?.modelId,
            modelName: routing?.modelName,
            slotId: routing?.slotId,
            pipeline: {
              runtimeReady: true,
              inferenceReady: routing?.warmupStatus === "ready",
              firstTokenReceived: Boolean(get().activeRun?.firstTokenAt) || phaseTimeoutKind === "stream_idle_timeout" || phaseTimeoutKind === "generation_timeout",
              modelOutputReceived: false,
              outputParsed: false,
              agentLoopCompleted: false,
              finalAnswerDelivered: false
            }
          });
          updateActiveRun((r) =>
            appendRunEvent(
              {
                ...updateRunStatus(r, "timeout"),
                outcome: finalized.outcome,
                error: {
                  code: finalized.outcome,
                  message: finalized.userMessage,
                  phase: "llm-request"
                }
              },
              "chat.timeout",
              `${finalized.userMessage}${phaseTimeoutMatch ? "" : ""}`
            )
          );
          const lastActiveRun = get().activeRun;
          resetFirstTokenTimeout();
          clearTimeout(totalTimeout);
          set((state) => ({
            isSending: false,
            isStreaming: false,
            error: finalized.userMessage,
            lastActivity: activity,
            currentActivity: null,
            activeRun: null,
            historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
          }));
          return false;
        }
        failStep("llm-request", "Modell-Anfrage senden", "Abgebrochen");
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "cancelled"), "chat.cancelled", "Abgebrochen"));
        const lastActiveRun = get().activeRun;
        resetFirstTokenTimeout();
        clearTimeout(totalTimeout);
        set((state) => ({
          isSending: false,
          isStreaming: false,
          error: null,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
        }));
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
        updateActiveRun((r) =>
          appendRunEvent(
            {
              ...updateRunStatus(r, "failed"),
              outcome,
              error: { code: error.code, message: errMsg, phase: "runtime" }
            },
            "chat.failed",
            errMsg
          )
        );
        const lastActiveRun = get().activeRun;
        resetFirstTokenTimeout();
        clearTimeout(totalTimeout);
        set((state) => ({
          error: errMsg,
          isSending: false,
          isStreaming: false,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
        }));
        return false;
      }

      if (isRuntimeNotRunningError(error)) {
        await refreshRuntimeStatus(null);
        failStep("llm-request", "Modell-Anfrage senden", "Runtime nicht mehr aktiv");
        updateActiveRun((r) => appendRunEvent(updateRunStatus(r, "failed"), "chat.failed", "Runtime offline"));
        updateActivity(
          patchActivityRun(activity, {
            finishedAt: new Date().toISOString(),
            summary: "Fehler: Runtime gestoppt"
          })
        );
        const lastActiveRun = get().activeRun;
        set((state) => ({
          error: "Runtime ist nicht mehr aktiv. Bitte Modell im Runtime-Panel erneut starten.",
          isSending: false,
          isStreaming: false,
          lastActivity: activity,
          currentActivity: null,
          activeRun: null,
          historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
        }));
        return false;
      }

      failStep(
        "llm-request",
        "Modell-Anfrage senden",
        error instanceof Error ? error.message : "Unbekannter Fehler"
      );
      
      // Error-Objekt für den Run erstellen
      const runError: import("@dbzs/shared").RuntimeChatError = {
        code: isTransientChatTransportError(error) ? "TRANSPORT_ERROR" : "UNKNOWN_ERROR",
        message: error instanceof Error ? error.message : "Unbekannter Fehler",
        phase: "llm-request",
        provider: routing?.providerId ?? undefined,
        endpoint: routing?.modelId ?? undefined,
        requestId: undefined
      };
      
      updateActiveRun((r) => {
        const withError = { ...r, error: runError };
        return appendRunEvent(updateRunStatus(withError, "failed"), "chat.failed", runError.message);
      });
      
      updateActivity(
        patchActivityRun(activity, {
          finishedAt: new Date().toISOString(),
          summary: `Fehler: ${error instanceof Error ? error.message : "unbekannt"}`
        })
      );
      const lastActiveRun = get().activeRun;
      set((state) => ({
        error: (() => {
          if (isTransientChatTransportError(error)) {
            return "Verbindung zum Backend war kurz unterbrochen. Bitte Nachricht erneut senden.";
          }
          return formatChatError(error);
        })(),
        isSending: false,
        isStreaming: false,
        // KEINE leere Assistant-Nachricht bei Fehlern - nur User-Nachricht bleibt
        messages: (() => {
          const current = get().messages;
          const last = current.at(-1);
          // Entferne leere Assistant-Nachrichten, die bei Fehlern entstanden sein könnten
          if (last?.role === "assistant" && last.content.trim().length === 0) {
            return current.slice(0, -1);
          }
          // Wenn die letzte Nachricht eine Assistant-Nachricht mit Inhalt ist,
          // aber ein Fehler aufgetreten ist, behalte sie nicht als "Antwort"
          // Der Fehler wird im Run angezeigt, nicht als Chat-Nachricht
          return current;
        })(),
        lastActivity: activity,
        currentActivity: null,
        activeRun: null,
        historicalRuns: lastActiveRun ? { ...state.historicalRuns, [lastActiveRun.id]: lastActiveRun } : state.historicalRuns
      }));
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
