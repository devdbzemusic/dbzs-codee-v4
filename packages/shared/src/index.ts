import type { RuntimeSlotDefinition, RuntimeSlotId, RuntimeSlotRole, RuntimeTaskType, RuntimeHardwareClass } from "./runtime/runtimeSlots.js";
import type { DecisionMemoryEntry } from "./interaction/interactionContracts.js";
import type { CommandRunStatus } from "./jobs/jobContracts.js";

export type { RuntimeSlotDefinition, RuntimeSlotId, RuntimeSlotRole, RuntimeTaskType, RuntimeHardwareClass } from "./runtime/runtimeSlots.js";
export { RUNTIME_SLOT_DEFINITIONS } from "./runtime/runtimeSlots.js";
export * from "./context/contextContracts.js";
export * from "./interaction/interactionContracts.js";
export * from "./boot/index.js";
export * from "./runtime/index.js";
export * from "./appContracts.js";
export * from "./workspace/index.js";
export * from "./review/index.js";
export * from "./jobs/index.js";
export * from "./agents/index.js";
export * from "./runtimeErrorSchema.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface AgentReasoningSummary {
  id: string;
  runId: string;
  messageId?: string;
  title: string;
  summary: string;
  steps?: string[];
  assumptions?: string[];
  risks?: string[];
  nextAction?: string;
  createdAt: string;
}

export interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  riskLevel?: "low" | "medium" | "high";
}

export interface AgentPlanProposal {
  type: "agent_plan_proposal";
  version: 1;
  id: string;
  runId: string;
  title: string;
  summary: string;
  steps: AgentPlanStep[];
  createdAt: string;
  state: "proposed" | "approved" | "rejected" | "edited" | "failed";
}

export type AgentActionState =
  | "pending"
  | "approved"
  | "running"
  | "completed"
  | "rejected"
  | "failed"
  | "expired";

export interface AgentActionBase {
  id: string;
  runId: string;
  version: 1;
  riskLevel: "low" | "medium" | "high";
  state: AgentActionState;
}

export interface AgentPlanAction extends AgentActionBase {
  kind: "plan";
  title: string;
  summary: string;
  steps: AgentPlanStep[];
}

export interface AgentPatchAction extends AgentActionBase {
  kind: "patch";
  proposalId: string;
}

export interface AgentCommandAction extends AgentActionBase {
  kind: "command";
  commandRequestId: string;
}

export interface AgentWebAction extends AgentActionBase {
  kind: "web";
  webRequestId: string;
}

export type AgentAction =
  | AgentPlanAction
  | AgentPatchAction
  | AgentCommandAction
  | AgentWebAction;

export type ChatActionKind =
  | "show_diff"
  | "approve_plan"
  | "edit_plan"
  | "reject_plan"
  | "approve_patch"
  | "reject_patch"
  | "apply_patch"
  | "rollback_patch"
  | "run_validation"
  | "approve_command"
  | "reject_command"
  | "approve_web_access"
  | "reject_web_access"
  | "confirm_continue"
  | "cancel_run"
  | "open_file"
  | "answer_question";

export interface ChatActionRequest {
  id: string;
  runId: string;
  messageId: string;
  workspaceRoot: string;
  workspaceId: string;
  kind: ChatActionKind;
  title: string;
  description?: string;
  riskLevel?: "low" | "medium" | "high";
  payload: Record<string, unknown>;
  approvalVersion?: string;
  expiresAt?: string;
  state: "pending" | "approved" | "rejected" | "running" | "completed" | "failed" | "expired";
  createdAt: string;
}

export interface RuntimeChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  rawContent?: string;
  visibleContent?: string;
  toolCalls?: RuntimeChatToolCallRecord[];
  meta?: RuntimeChatMessageMeta;
  reasoningSummary?: AgentReasoningSummary;
  actions?: ChatActionRequest[];
  actionIds?: string[];
  planProposal?: AgentPlanProposal;
  planProposalId?: string;
  patchProposalId?: string;
  patchPreviewId?: string;
  traceEvents?: ReasoningTraceEvent[];
  safeReasoningSummary?: SafeReasoningSummary;
  retrievalManifest?: RetrievalManifest;
  contextManifest?: ContextManifest;
  sourceReferences?: SourceReference[];
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type StructuredPayloadParseState = "none" | "partial" | "valid" | "invalid";

export interface ApprovedPlanContext {
  planProposalId: string;
  title: string;
  summary: string;
  steps: AgentPlanStep[];
  approvedAt: string;
}

export interface ParsedAssistantPayload {
  visibleText: string;
  reasoningSummary?: AgentReasoningSummary;
  planProposal?: AgentPlanProposal;
  parseState?: StructuredPayloadParseState;
  toolCalls: AgentToolCall[];
  warnings: string[];
}

export type RuntimeChatToolCallStatus = "running" | "done" | "error";

/**
 * Three-tier view of a tool call's output: `displaySummary` (~300-500 chars,
 * for the UI) vs `agentContext` (several-thousand-chars, kept for the model's
 * own repair-loop reasoning — must retain actual error/exception lines, not
 * just an arbitrary character cutoff) vs `fullLogRef` (a reference to the
 * complete, untruncated output; only the reference goes into the prompt).
 */
export interface ToolOutputLayers {
  displaySummary: string;
  agentContext: string;
  fullLogRef?: string;
}

export interface RuntimeChatToolCallRecord {
  id: string;
  name: string;
  status: RuntimeChatToolCallStatus;
  input?: Record<string, unknown>;
  outputSummary?: string;
  agentContext?: string;
  fullLogRef?: string;
  filePath?: string;
  diffPreview?: string;
  durationMs?: number;
}

export interface RuntimeChatMessageMeta {
  type?: "plan" | "tool_results" | "trajectory";
  trajectoryRunId?: string;
  patchState?: string;
}

// Context Spooler (Phase 4)
export interface RuntimeTokenBudget {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  safetyReserveTokens: number;
  maxSystemTokens: number;
  maxTaskTokens: number;
  maxCodeTokens: number;
  maxHistoryTokens: number;
  maxMemoryTokens: number;
}

/** Capability flags for a single user turn (Phase 2B routing). */
export interface RuntimeRequestCapabilities {
  hasImageInput: boolean;
  hasAudioInput: boolean;
  requiresVision: boolean;
}

/** Staged context depth: 0 interview → 1 plan base → 2 targeted → 3 coding. */
export type ContextStage = 0 | 1 | 2 | 3;

/** Full serialized request budget before a runtime call (Phase 2B). */
export interface FinalRequestTokenBudget {
  runtimeContextLimit: number;
  systemTokens: number;
  toolTokens: number;
  chatTokens: number;
  interviewTokens: number;
  memoryTokens: number;
  fileContextTokens: number;
  ragTokens: number;
  outputReserveTokens: number;
  totalInputTokens: number;
  totalRequiredTokens: number;
  overflowTokens: number;
}

/** Honest terminal outcome for a Runtime Chat run. */
export type RuntimeRunOutcome =
  | "success"
  | "needs_user_input"
  | "cancelled"
  | "context_overflow"
  | "runtime_start_failed"
  | "warmup_failed"
  | "process_start_timeout"
  | "endpoint_ready_timeout"
  | "model_load_timeout"
  | "prompt_eval_timeout"
  | "first_token_timeout"
  | "stream_idle_timeout"
  | "partial_output_stream_incomplete"
  | "generation_timeout"
  | "runtime_oom"
  | "generation_failed"
  | "agent_output_invalid"
  | "agent_loop_incomplete"
  | "empty_final_answer"
  | "tool_loop_failed"
  | "answer_relevance_failed"
  | "execution_no_action"
  | "invalid_protocol"
  | "skill_tool_policy_violation"
  | "command_spawn_failed"
  | "dependency_install_failed"
  | "patch_failed"
  | "validation_failed"
  | "request_binding_mismatch"
  | "workflow_state_invalid"
  | "internal_error"
  /** @deprecated Prefer generation_failed / runtime_start_failed */
  | "runtime_timeout"
  /** @deprecated Prefer generation_failed */
  | "runtime_unreachable"
  /** @deprecated Prefer internal_error / generation_failed */
  | "runtime_error";

/** Staged runtime readiness — `inference_ready` requires a verified token. */
export type RuntimeReadinessStage =
  | "process_started"
  | "endpoint_reachable"
  | "model_loaded"
  | "prompt_eval_verified"
  | "token_generation_verified"
  | "inference_ready";

export interface RuntimeTimeoutPolicy {
  processStartTimeoutMs: number;
  endpointReadyTimeoutMs: number;
  modelLoadTimeoutMs: number;
  promptEvalTimeoutMs: number;
  firstTokenTimeoutMs: number;
  streamIdleTimeoutMs: number;
  generationTimeoutMs: number;
}

export interface RuntimeWarmupDiagnostics {
  endpoint?: string;
  apiMode?: string;
  requestMethod?: string;
  requestBody?: string;
  httpStatus?: number;
  contentType?: string;
  responseHeaders?: Record<string, string>;
  streamEvents?: string[];
  parserDecision?: string;
  chatTemplateUsed?: string;
  stopSequencesUsed?: string[];
  maxTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  processStartMs?: number;
  endpointReadyMs?: number;
  modelLoadMs?: number;
  promptEvalMs?: number;
  firstTokenMs?: number;
  totalWarmupMs?: number;
  tokenCount?: number;
  finishReason?: string;
  readinessStage?: RuntimeReadinessStage;
  streamMode?: boolean;
  toolCallDetected?: boolean;
  /** First 8 KB of the raw HTTP response — only set on warmup_empty_response. */
  rawResponsePreview?: string;
  stderrTail?: string;
}

export type DroppedContextReason =
  | "duplicate"
  | "low_relevance"
  | "context_overflow"
  | "safety_margin"
  | "workspace_excluded"
  | "history_compaction"
  | "duplicate_or_zero_token_source"
  | "replaced_by_summary";

export interface DroppedContextSource {
  id: string;
  reason: DroppedContextReason;
  tokensBefore: number;
  tokensAfter: number;
  tokensRemoved: number;
}

export type ContextLane =
  | "mandatory"
  | "active_task"
  | "relevant_code"
  | "retrieved_context"
  | "recent_conversation"
  | "project_memory"
  | "overflow";

export type RagSourceType = "source_code" | "test" | "documentation" | "configuration" | "project_memory";
export type RetrievalSourceType = RagSourceType | "chat_history" | "tool_output" | "web";
export type RetrievalMethod = "exact" | "symbol" | "dependency" | "bm25" | "embedding" | "recent_change" | "active_editor";

export interface WorkspaceIndexEntry {
  id: string; workspaceId: string; sourceType: RagSourceType; filePath: string; language?: string;
  symbolName?: string; symbolKind?: string; startLine: number; endLine: number; content: string;
  contentHash: string; tokenCount: number; imports?: string[]; exports?: string[];
  relatedSymbols?: string[]; indexedAt: string;
}

export interface RetrievalQuery {
  id: string; workspaceId: string; workspaceRoot?: string; query: string;
  intent: "chat" | "coding" | "review" | "planning" | "debugging" | "documentation";
  activeFilePath?: string; mentionedPaths?: string[]; mentionedSymbols?: string[];
  maxCandidates: number; maxFinalItems: number; tokenBudget: number; createdAt: string;
  queryEmbedding?: number[]; embeddingModelId?: string;
}

export interface RetrievedContextItem {
  id: string; sourceType: RetrievalSourceType; sourcePath?: string; title?: string; symbol?: string;
  startLine?: number; endLine?: number; content: string; contentHash: string; tokenCount: number;
  retrievalMethod: RetrievalMethod; rawScore: number; rerankScore?: number; finalScore: number; retrievedAt: string;
}

export interface EmbeddingCacheEntry {
  sourceId: string; contentHash: string; embeddingModelId: string; dimensions: number;
  vectorRef: string; tokenCount: number; createdAt: string;
}

export interface RagTokenBudget {
  totalContextTokens: number; reservedOutputTokens: number; reservedToolTokens: number;
  safetyReserveTokens: number; maxRetrievedContextTokens: number; maxCodeTokens: number;
  maxHistoryTokens: number; maxMemoryTokens: number;
}

export interface RetrievalManifestItem {
  itemId: string; sourcePath?: string; symbol?: string; startLine?: number; endLine?: number;
  retrievalMethod: string; score: number; tokenCount: number;
}
export interface RetrievalManifest {
  requestId: string; queryId: string; workspaceId: string; candidateCount: number; rerankedCount: number;
  selectedCount: number; selectedItems: RetrievalManifestItem[];
  droppedItems: Array<{ itemId: string; reason: "token_budget" | "duplicate" | "low_score" | "stale" | "policy" }>;
  cacheHits: number; cacheMisses: number; totalTokens: number; createdAt: string; fallbackReason?: string;
}

export interface SourceReference {
  id: string; sourceType: string; title: string; filePath?: string; startLine?: number;
  endLine?: number; url?: string; symbol?: string;
}

export type TraceEventKind = "intent_detected" | "model_selected" | "context_cache_hit" | "context_cache_miss" |
  "retrieval_started" | "retrieval_completed" | "sources_selected" | "plan_created" |
  "approval_requested" | "approval_granted" | "approval_rejected" | "tool_started" | "tool_completed" |
  "patch_proposed" | "patch_applied" | "command_started" | "command_completed" |
  "web_search_started" | "web_search_completed" | "validation_started" | "validation_completed" |
  "retry_started" | "context_pack_built" | "context_pack_failed" | "context_gap" | "run_completed" | "run_failed";
export interface ReasoningTraceEvent {
  id: string; runId: string; messageId?: string; kind: TraceEventKind; title: string; summary: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  sourceRefs?: string[]; metadata?: Record<string, string | number | boolean | null>;
  startedAt?: string; completedAt?: string; durationMs?: number; sequence?: number;
}
export interface SafeReasoningSummary {
  id: string; runId: string; title: string; summary: string; completedSteps: string[];
  currentStep?: string; assumptions?: string[]; risks?: string[]; nextAction?: string;
  sourceRefs?: string[]; createdAt: string;
}

export interface RagRetrievalResponse {
  candidates: RetrievedContextItem[]; items: RetrievedContextItem[];
  manifest: RetrievalManifest; sourceReferences: SourceReference[];
}

export interface RagIndexStatus {
  workspaceId: string; workspaceRoot: string; state: "idle" | "indexing" | "ready" | "error";
  fileCount: number; chunkCount: number; embeddingCount: number; lastIndexedAt?: string;
  durationMs?: number; error?: string;
}

export interface ContextManifestSection {
  type: string;
  source: string;
  tokenCount: number;
  priority: number;
  cached: boolean;
  truncated: boolean;
}

export interface ContextManifest {
  requestId: string;
  modelId: string;
  role: string;
  contextWindowTokens: number;
  inputTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  safetyReserveTokens: number;
  sections: ContextManifestSection[];
  cacheHits: number;
  cacheMisses: number;
  droppedSections: string[];
  duplicateContextRemoved: number;
  duplicateTokenSavings: number;
  dedupeReasons: string[];
}

export interface RuntimeChatToolDefinitions {
  mode: "native" | "prompt";
  definitions: unknown[];
}

export interface RuntimeChatFileContext {
  path: string;
  language: string;
  content: string;
}

export interface RuntimeChatWorkspaceSampledFile {
  path: string;
  relativePath: string;
  language: string;
  content: string;
}

export interface RuntimeChatWorkspaceContext {
  rootPath: string;
  name: string;
  fileTree: string[];
  sampledFiles: RuntimeChatWorkspaceSampledFile[];
}

export type RuntimeFallbackPolicy =
  | "strict"
  | "allow_local_fallback"
  | "allow_cloud_fallback"
  | "allow_any_fallback";

export interface RuntimeChatRequest {
  messages: RuntimeChatMessage[];
  file_context?: RuntimeChatFileContext | null;
  temperature?: number;
  max_tokens?: number;
  top_p?: number | null;
  min_p?: number | null;
  repeat_penalty?: number | null;
  repeat_last_n?: number | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  tools?: RuntimeChatToolDefinitions | null;
  model_id?: string | null;
  slot_id?: RuntimeSlotId | null;
  provider?: string | null;
  fallback_policy?: RuntimeFallbackPolicy;
  routing_reason?: string | null;
  decision_id?: string | null;
}

export interface RuntimeChatResponse {
  message: RuntimeChatMessage;
  model_id: string | null;
  model_name: string | null;
  /**
   * True when the desktop transport synthesized this message after a failed
   * backend call. Must never be treated as a successful model answer.
   */
  safe_fallback?: boolean;
  /**
   * Structured provider/transport error. When set, content must not be treated
   * as a model delta or successful assistant answer.
   */
  provider_error?: {
    kind: "provider_error";
    code: string;
    stage: string;
    userMessage: string;
    technicalDetail?: string;
    retryable: boolean;
    correlationId: string;
  };
  /** Optional finish reason from the model/runtime when known. */
  finish_reason?: string | null;
}

export type ProposedChangeStatus = "pending" | "approved" | "rejected" | "applied";

export interface ProposedChange {
  id: string;
  agentId: string;
  filePath: string;
  originalContent?: string;
  proposedContent: string;
  reason: string;
  createdAt: string;
  status: ProposedChangeStatus;
}

export type DebugAnalysisSource = "test" | "typecheck" | "runtime" | "lint";

export interface DebugAnalysis {
  id: string;
  source: DebugAnalysisSource;
  summary: string;
  probableCause: string;
  affectedFiles: string[];
  suggestedFixes: string[];
  rawLogs: string;
  createdAt: string;
}

export interface PlannerWorkspaceSampledFile {
  path: string;
  relativePath: string;
  language: string;
  content: string;
}

export interface PlannerAgentReference {
  id: string;
  name: string;
  role: string;
  status?: string;
}

export interface PlannerWorkspaceContext {
  rootPath: string;
  name: string;
  fileTree: string[];
  sampledFiles: PlannerWorkspaceSampledFile[];
  availableAgents: PlannerAgentReference[];
}

export interface PlannerTask {
  id: string;
  title: string;
  description: string;
  affectedFiles: string[];
  priority: "low" | "medium" | "high";
  estimatedComplexity: "small" | "medium" | "large";
  dependencies: string[];
}

export interface PlannerPlan {
  id: string;
  goal: string;
  summary: string;
  tasks: PlannerTask[];
  risks: string[];
  assumptions: string[];
  affectedAreas: string[];
  createdAt: string;
}

export type PlannedExecutionStatus = "pending" | "running" | "completed";

export interface PlannedExecution {
  taskId: string;
  assignedAgent?: string;
  status: PlannedExecutionStatus;
}

export type TaskExecutionStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type OrchestratorAgentRole =
  | "planner"
  | "coder"
  | "tester"
  | "debugger"
  | "reviewer"
  | "docs";

export type OrchestratorApprovalGate = "plan" | "apply" | "commit" | "restore";

export interface PlannedTaskExecution {
  id: string;
  taskId: string;
  assignedAgent: OrchestratorAgentRole;
  status: TaskExecutionStatus;
  awaitingGate?: OrchestratorApprovalGate;
  gateMessage?: string;
  gateRequestedAt?: string;
  approvedGates?: OrchestratorApprovalGate[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ExecutionPlan {
  id: string;
  plannerPlanId: string;
  tasks: PlannedTaskExecution[];
  status:
    | "idle"
    | "running"
    | "waiting_approval"
    | "failed"
    | "completed";
}

export type AutonomousSessionStatus =
  | "idle"
  | "planning"
  | "running"
  | "waiting_approval"
  | "testing"
  | "debugging"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

export type AutonomousSession = {
  id: string;
  goal: string;
  status: AutonomousSessionStatus;
  plannerPlanId?: string;
  executionPlanId?: string;
  currentTaskId?: string;
  pendingApprovalIds: string[];
  appliedChangeIds: string[];
  testRunIds: string[];
  debugAnalysisIds: string[];
  reviewReportIds: string[];
  restorePointIds: string[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export type ApprovalGateType =
  | "diff"
  | "test_failure"
  | "review_error"
  | "restore"
  | "commit"
  | "high_risk";

export type ApprovalGate = {
  id: string;
  sessionId: string;
  type: ApprovalGateType;
  title: string;
  description: string;
  relatedIds: string[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type ReviewFindingSeverity = "info" | "warning" | "error";

export type ReviewFindingCategory =
  | "architecture"
  | "maintainability"
  | "performance"
  | "security"
  | "types"
  | "testing"
  | "style";

export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  title: string;
  description: string;
  filePath?: string;
  line?: number;
  suggestion?: string;
}

export interface ReviewReport {
  id: string;
  summary: string;
  findings: ReviewFinding[];
  reviewedFiles: string[];
  createdAt: string;
}

export interface ReviewSuggestion {
  findingId: string;
  suggestedChange?: ProposedChange;
}

/** Multi-step repository review (Codee orchestrator) — separate from patch ReviewFinding. */
export type RepositoryReviewScope =
  | "active_file"
  | "uncommitted_changes"
  | "last_commit"
  | "selected_paths"
  | "full_repository";

export type RepositoryReviewDepth = "quick" | "standard" | "deep";

export type RepositoryReviewStatus =
  | "planned"
  | "running"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

export type RepositoryReviewOutcome =
  | "completed"
  | "completed_with_warnings"
  | "degraded_heuristic_only"
  | "partial"
  | "failed"
  | "cancelled"
  /** Persisted V1 values remain readable and are normalized when loaded. */
  | "completed_with_skipped_checks"
  | "paused"
  | "inventory_failed"
  | "command_failed"
  | "batch_failed"
  | "context_split_required"
  | "report_generation_failed"
  /** Plan produced zero batches despite a non-empty inventory (e.g. selectedPaths matched nothing, or no file matched the supported extension filter). */
  | "empty_plan";

export type RepositoryReviewFindingSeverity = "P0" | "P1" | "P2" | "P3";

export type RepositoryReviewFindingCategory =
  | "correctness"
  | "security"
  | "architecture"
  | "performance"
  | "maintainability"
  | "testing"
  | "build"
  | "data"
  | "audio"
  | "ux";

export type ExecutedReviewCheckStatus =
  | "passed"
  | "failed"
  | "not_executed"
  | "not_available";

export interface RepositoryReviewRequest {
  workspaceId: string;
  workspaceRoot: string;
  scope: RepositoryReviewScope;
  selectedPaths?: string[];
  depth: RepositoryReviewDepth;
  includeBuildChecks: boolean;
  includeSecurityReview: boolean;
  includePerformanceReview: boolean;
  includeArchitectureReview: boolean;
}

export interface ReviewBatchPlan {
  batchId: string;
  title: string;
  paths: string[];
  purpose: string;
  domain?:
    | "security_api"
    | "architecture_dataflow"
    | "react_state"
    | "audio_media"
    | "build_dependencies"
    | "tests_observability"
    | "performance_resources"
    | "general";
  estimatedTokens: number;
  priority: number;
  parentBatchId?: string;
  splitDepth?: number;
  splitReason?: string;
  partIndex?: number;
  partCount?: number;
}

export interface ReviewCommandPlan {
  id: string;
  command: string;
  cwd: string;
  purpose: string;
  timeoutMs: number;
  requiresApproval: boolean;
}

export interface RepositoryReviewPlan {
  reviewId: string;
  workspaceId: string;
  scope: RepositoryReviewRequest["scope"];
  batches: ReviewBatchPlan[];
  commands: ReviewCommandPlan[];
  expectedArtifacts: string[];
  status: RepositoryReviewStatus;
}

export interface RepositoryReviewFinding {
  id: string;
  severity: RepositoryReviewFindingSeverity;
  category: RepositoryReviewFindingCategory;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  title: string;
  evidence: string;
  impact: string;
  recommendation: string;
  verification?: string;
  /** Unconfirmed hints must not be treated as confirmed findings. */
  needsVerification?: boolean;
  batchId?: string;
  source?: "llm" | "heuristic";
}

export interface ReviewBatchAnalyzerDiagnostics {
  batchId: string;
  llmAttempted: boolean;
  llmSucceeded: boolean;
  llmFindingCount: number;
  heuristicExecuted: boolean;
  heuristicFindingCount: number;
  parserSucceeded?: boolean;
  parserError?: string;
  providerError?: string;
  rawResponseLength?: number;
  repairAttempted?: boolean;
  mode: "llm" | "hybrid" | "heuristic_fallback" | "failed";
}

export interface BatchAnalysisResult {
  findings: RepositoryReviewFinding[];
  diagnostics: ReviewBatchAnalyzerDiagnostics;
}

export type LlmFindingParseResult =
  | {
      ok: true;
      findings: RepositoryReviewFinding[];
      rawLength: number;
    }
  | {
      ok: false;
      findings: [];
      errorCode: "no_json_array" | "invalid_json" | "invalid_schema" | "empty_response";
      errorMessage: string;
      rawLength: number;
      redactedPreview?: string;
    };

export interface ReviewQualityAssessment {
  analyzerCoverage: number;
  reviewedFileCount: number;
  plannedFileCount: number;
  findingCount: number;
  uniqueFindingTitles: number;
  uniqueCategories: number;
  uniqueSeverities: number;
  repeatedGenericFindingRatio: number;
  securityCoverage: "not_run" | "partial" | "complete";
  architectureCoverage: "not_run" | "partial" | "complete";
  performanceCoverage: "not_run" | "partial" | "complete";
  confidence: "low" | "medium" | "high";
  warnings: string[];
}

export interface ProductionReadinessAssessment {
  score?: number;
  confidence: "low" | "medium" | "high";
  basis: string[];
  missingCoverage: string[];
}

export type ReviewFindingStatus =
  | "open"
  | "planned"
  | "in_progress"
  | "fixed"
  | "verified"
  | "skipped"
  | "failed";

export interface ReviewFindingResolution {
  findingId: string;
  status: ReviewFindingStatus;
  changedFiles: string[];
  verificationCommands: string[];
  verificationResult?: string;
  reason?: string;
}

export type ReviewRemediationSelectionScope =
  | "all"
  | "p0_p1"
  | "p0_p2"
  | "selected";

/**
 * Atomarer, workspace-gebundener Zustand der Review-/Scope-Auswahl.
 * pendingQuestionId schützt vor verspäteten Antworten älterer UI-Karten.
 */
export interface ReviewRemediationSelection {
  workspaceId: string;
  reviewId: string | null;
  scope: ReviewRemediationSelectionScope;
  selectedFindingIds: string[];
  reviewConfirmed: boolean;
  scopeConfirmed: boolean;
  status: "collecting" | "complete" | "consumed" | "cancelled";
  pendingQuestionId: string | null;
  updatedAt: string;
}

export interface ReviewRemediationCapsuleFinding {
  id: string;
  severity: RepositoryReviewFindingSeverity;
  category: RepositoryReviewFindingCategory;
  path: string;
  lineStart?: number;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface ReviewRemediationCapsule {
  reviewId: string;
  workspaceId: string;
  findingsPath: string;
  reportPath: string;
  scope: ReviewRemediationSelectionScope;
  findings: ReviewRemediationCapsuleFinding[];
  totalSelected: number;
  /** Kompatibilitätsfelder für persistierte V1-Tasks. */
  selectedFindingIds: string[];
  severityScope: RepositoryReviewFindingSeverity[];
  totalFindings: number;
  remainingFindings: number;
}

export interface ReviewArtifactSummary {
  reviewId: string;
  workspaceId: string;
  status: RepositoryReviewStatus;
  outcome?: RepositoryReviewOutcome;
  updatedAt: string;
  artifactDir: string;
  reportPath: string;
  findingsPath: string;
}

export interface ExecutedReviewCheck {
  id: string;
  command: string;
  purpose: string;
  status: ExecutedReviewCheckStatus;
  exitCode?: number;
  durationMs?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
}

export interface RepositoryInventory {
  languageStats: Record<string, number>;
  frameworkHints: string[];
  packageManager?: string;
  buildCommands: string[];
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  largeFiles: Array<{
    path: string;
    lines: number;
    bytes: number;
  }>;
  gitState: {
    branch?: string;
    dirty: boolean;
    changedFiles: string[];
  };
  fileCount: number;
  files: string[];
}

export interface ReviewBatchBudget {
  runtimeContextLimit: number;
  systemTokens: number;
  taskTokens: number;
  fileTokens: number;
  evidenceTokens: number;
  outputReserveTokens: number;
  safetyMarginTokens: number;
  totalRequiredTokens: number;
}

export interface RepositoryReviewReport {
  reviewId: string;
  summary: string;
  findings: RepositoryReviewFinding[];
  executedChecks: ExecutedReviewCheck[];
  failedChecks: ExecutedReviewCheck[];
  remainingRisks: string[];
  productionReadinessScore?: number;
  productionReadiness?: ProductionReadinessAssessment;
  quality?: ReviewQualityAssessment;
  analyzerDiagnostics?: ReviewBatchAnalyzerDiagnostics[];
}

/** Live progress snapshot attached to RuntimeChatRun for UI. */
export interface RepositoryReviewProgress {
  reviewId: string;
  workspaceId?: string;
  scope: RepositoryReviewScope;
  status: RepositoryReviewStatus;
  outcome?: RepositoryReviewOutcome;
  intentLabel?: "code_review";
  workflowId?: "repository_review";
  totalBatches: number;
  completedBatches: number;
  currentBatchTitle?: string;
  checks: Array<{
    id: string;
    label: string;
    status: ExecutedReviewCheckStatus;
  }>;
  severityCounts?: Partial<Record<RepositoryReviewFindingSeverity, number>>;
  artifactDir?: string;
  reportPath?: string;
  findingsPath?: string;
  reviewedFileCount?: number;
  plannedFileCount?: number;
  analyzerDiagnostics?: ReviewBatchAnalyzerDiagnostics[];
  quality?: ReviewQualityAssessment;
  productionReadiness?: ProductionReadinessAssessment;
  topFindings?: RepositoryReviewFinding[];
  startedAt?: string;
  updatedAt?: string;
}

export type AgentRunnerState = "idle" | "running" | "failed";

export interface AgentRunnerPatchProposal {
  file_path: string;
  proposed_content: string;
  summary: string;
}

export type AgentFileChangeType = "create" | "modify" | "delete";
export type AgentPatchRiskLevel = "low" | "medium" | "high";
export type AgentPatchState =
  | "PROPOSED"
  | "PREVIEW_READY"
  | "WAITING_FOR_APPROVAL"
  | "APPROVED"
  | "APPLYING"
  | "APPLIED"
  | "VALIDATING"
  | "PASSED"
  | "FAILED"
  | "ROLLED_BACK"
  | "REJECTED";

export interface AgentFileChangeProposal {
  id: string;
  runId: string;
  decisionId?: string;
  filePath: string;
  changeType: AgentFileChangeType;
  proposedContent?: string;
  reason: string;
  summary: string;
  riskLevel: AgentPatchRiskLevel;
  requiresReview: boolean;
  createdAt: string;
}

export interface AgentPatchProposal {
  id: string;
  runId: string;
  decisionId?: string;
  chatTurnId?: string;
  workspaceRoot?: string;
  title: string;
  summary: string;
  changes: AgentFileChangeProposal[];
  validationCommands?: string[];
  createdAt: string;
}

export interface AgentFileChangePreview {
  changeId: string;
  filePath: string;
  changeType: AgentFileChangeType;
  snapshotId: string;
  beforeContent: string;
  afterContent: string;
  diff: string;
}

export interface AgentPatchPreview {
  proposalId: string;
  state: AgentPatchState;
  previews: AgentFileChangePreview[];
  approvalVersion: string;
  createdAt: string;
}

export interface AgentPatchApplyResult {
  proposalId: string;
  state: AgentPatchState;
  applied: boolean;
  restorePointId: string | null;
  changedFiles: string[];
  deletedFiles: string[];
  errors: string[];
}

export interface PatchValidationResult {
  proposalId: string;
  success: boolean;
  commands: Array<{
    commandId: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
}

export interface AgentRunOnceRequest {
  agent_id: string;
  workspace_root?: string | null;
  supported_roles?: string[];
}

export interface AgentRunResult {
  state: AgentRunnerState;
  agent_id: string;
  job_id?: string | null;
  message: string;
  artifacts: string[];
  patch_proposals: AgentRunnerPatchProposal[];
  llm_skipped: boolean;
}

export interface AgentRunnerStatus {
  state: AgentRunnerState;
  agent_id?: string | null;
  last_job_id?: string | null;
  last_message: string;
  last_run_at?: string | null;
}

export type RecommendedModelUse =
  | "primary_coding"
  | "coding_candidate"
  | "chat_candidate"
  | "review_agent"
  | "reranker"
  | "embedding"
  | "vision_candidate"
  | "media_pipeline"
  | "adapter_only"
  | "orchestrator"
  | "unsupported";

export interface ModelRuntimeHints {
  ctx: number | null;
  gpu_layers: number | null;
  server_enabled: boolean;
  preferred_port: number | null;
  health_status: string;
  provider: string;
}

export interface IndexedModel {
  id: string;
  name: string;
  path: string;
  format: string;
  artifact_type: string;
  size_bytes: number;
  size_gb: number;
  quantization: string | null;
  backend: string;
  runtime_launcher: string;
  capabilities: string[];
  modality: string[];
  role: string | null;
  recommended_use: RecommendedModelUse;
  compatibility: string;
  runtime: ModelRuntimeHints;
}

export interface ModelIndexSummary {
  models_dir: string;
  runtime_dir: string | null;
  ollama_dir: string | null;
  ollama_models_dir: string | null;
  total: number;
  gguf_total: number;
  ollama_total: number;
  llama_server_ready: number;
  ollama_ready: number;
  coding_candidates: number;
  vision_candidates: number;
  adapters: number;
  unsupported: number;
}

export interface ModelIndex {
  generated_from: string;
  summary: ModelIndexSummary;
  models: IndexedModel[];
}

export * from "./runtime/runtimeSlots";

export type RuntimeState = "stopped" | "starting" | "running" | "error";
export type RuntimeProvider = "llama.cpp" | "ollama";

export type ModelProviderId = "llama-cpp" | "ollama" | "openai" | "anthropic";
export type ModelCapability = "chat" | "code" | "reasoning" | "vision";

export interface RegisteredModel {
  id: string;
  providerId: ModelProviderId;
  name: string;
  capabilities: ModelCapability[];
  isLocal: boolean;
  enabled: boolean;
}

export type ModelTargetAgent = "runtime_chat" | "planner" | "coder" | "reviewer" | "debugger";

export interface RuntimeStatus {
  state: RuntimeState;
  provider: RuntimeProvider | null;
  model_id: string | null;
  model_name: string | null;
  port: number | null;
  pid: number | null;
  endpoint: string | null;
  message: string;
  stderr_tail?: string;
  stdout_tail?: string;
  slot_id?: RuntimeSlotId | null;
  gpu_layers?: number | null;
  context_size?: number | null;
  hardware_mode?: "cpu" | "gpu" | "hybrid" | null;
  gpu_device?: string | null;
  vram_total_bytes?: number | null;
  vram_used_bytes?: number | null;
  error_message?: string | null;
}

export interface RuntimeSlotStatus extends RuntimeStatus {
  slot_id: RuntimeSlotId;
  device_policy: "gpu" | "cpu" | "auto";
  gpu_layers: number | null;
  context_size: number | null;
  chat_ready: boolean;
  vram_total_bytes?: number | null;
  vram_used_bytes?: number | null;
  error_message?: string | null;
  launch_fingerprint?: string | null;
  active_requests?: number | null;
  residency_state?: string | null;
  reserved_output_tokens?: number | null;
  batch_size?: number | null;
  micro_batch_size?: number | null;
  cache_type_k?: string | null;
  cache_type_v?: string | null;
}

export interface RuntimeChatStreamDonePayload {
  type: "done";
  slot_id: RuntimeSlotId | null;
  model_id: string | null;
  model_name: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export type AgentRuntimeState = "stopped" | "running" | "error";

export interface AgentExecutionStatus {
  state: AgentRuntimeState;
  pid: number | null;
  message: string;
  updated_at: string;
}

export type AgentLogLevel = "info" | "warning" | "error";

export interface AgentLogEntry {
  id: number;
  agent_id: string;
  level: AgentLogLevel;
  message: string;
  created_at: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  command: string;
  args: string[];
  cwd: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  status: AgentExecutionStatus;
}

export interface AgentCreateRequest {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  command: string;
  args: string[];
  cwd?: string | null;
  enabled?: boolean;
}

export interface AgentUpdateRequest {
  name?: string;
  role?: AgentRole;
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string | null;
  enabled?: boolean;
}

export interface ProjectMemoryEntry {
  id: number;
  workspace: string;
  memory_key: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectMemoryUpsertRequest {
  workspace: string;
  memory_key: string;
  content: string;
  tags?: string[];
}

export interface ImportantFile {
  path: string;
  reason: string;
}

export interface MemoryTask {
  id: string;
  title: string;
  summary: string;
  affectedFiles: string[];
  createdAt: string;
}

export interface KnownIssue {
  id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export interface ProjectMemory {
  projectId: string;
  projectName: string;
  workspaceRoot: string;
  frameworks: string[];
  languages: string[];
  architectureNotes: string[];
  codingPatterns: string[];
  importantFiles: ImportantFile[];
  recentTasks: MemoryTask[];
  knownIssues: KnownIssue[];
  updatedAt: string;
  clarificationDecisions?: DecisionMemoryEntry[];
}

export type IndexedSymbolType =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "component"
  | "hook"
  | "service";

export interface IndexedSymbol {
  name: string;
  type: IndexedSymbolType;
  line: number;
}

export interface IndexedFile {
  path: string;
  language: string;
  exports: string[];
  imports: string[];
  symbols: IndexedSymbol[];
  updatedAt: string;
}

export interface SearchResult {
  filePath: string;
  reason: string;
  matchedSymbols: string[];
  score: number;
}

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface GitStatusEntry {
  filePath: string;
  status: GitFileStatus;
}

export interface GitRepositoryStatus {
  workspaceRoot: string;
  isRepository: boolean;
  currentBranch?: string;
  hasUpstream?: boolean;
  aheadCount?: number;
  behindCount?: number;
  hasUncommittedChanges: boolean;
  entries: GitStatusEntry[];
  updatedAt: string;
}

export interface GitDiffSummary {
  filePath: string;
  additions: number;
  deletions: number;
  summary: string;
}

export interface GitCommitSuggestion {
  title: string;
  body?: string;
  affectedFiles: string[];
  riskLevel: "low" | "medium" | "high";
}

export interface CommitMessageSuggestion {
  id: string;
  title: string;
  body?: string;
  type: "feat" | "fix" | "refactor" | "test" | "docs" | "chore";
  scope?: string;
  affectedFiles: string[];
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
}

export interface CommitRequest {
  message: CommitMessageSuggestion;
  includeFiles: string[];
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

export interface CommitAssistantContext {
  agentRuns?: CommandRunStatus[];
  appliedChanges?: ProposedChange[];
  reviewReports?: ReviewReport[];
  testResults?: CommandRunStatus[];
}

export type RestorePointReason =
  | "manual"
  | "before_patch"
  | "before_agent_run"
  | "before_commit"
  | "before_debug_fix"
  | "before_bulk_change";

export interface RestorePointFile {
  filePath: string;
  content: string;
  existed: boolean;
}

export type BackupReason = "startup" | "manual" | "pre-destructive";

export interface BackupSummary {
  id: string;
  path: string;
  createdAt: string;
  reason: BackupReason;
  fileCount: number;
}

export interface RestoreSummary {
  restoredFiles: string[];
  errors: string[];
}

export interface RestorePoint {
  id: string;
  workspaceRoot: string;
  reason: RestorePointReason;
  label: string;
  files: RestorePointFile[];
  gitHead?: string;
  gitBranch?: string;
  relatedRunId?: string;
  relatedChangeIds?: string[];
  createdAt: string;
}

export interface RestoreResult {
  success: boolean;
  restoredFiles: string[];
  deletedFiles: string[];
  errors: string[];
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface TaskBoardItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  created_at: string;
  updated_at: string;
  job_ids?: string[];
}

export interface AgentHealthInfo {
  agent_id: string;
  pid: number | null;
  state: "stopped" | "running" | "error";
  uptime_seconds: number | null;
  error_count_1h: number;
  last_log: string | null;
  last_log_at: string | null;
}

export interface GpuInfo {
  detected: boolean;
  vendor: "nvidia" | "amd" | null;
  name: string | null;
  vram_mb: number | null;
  recommended_gpu_layers: number;
}

export interface BenchmarkResult {
  model_name: string;
  avg_latency_ms: number;
  tokens_per_second: number;
  rounds: number;
  error?: string | null;
}

export interface RuntimeModelTestStep {
  id: string;
  label: string;
  status: "pass" | "fail" | "skip";
  detail: string;
  duration_ms?: number | null;
}

export interface RuntimeModelTestReport {
  overall: "pass" | "fail";
  model_id: string | null;
  model_name: string | null;
  provider: string | null;
  steps: RuntimeModelTestStep[];
}

export interface ModelDownloadTask {
  id: string;
  repo_id: string;
  filename: string;
  dest_dir: string;
  state: "pending" | "running" | "completed" | "failed";
  progress: number;
  error?: string | null;
  local_path?: string | null;
}

export interface TaskCreateRequest {
  title: string;
  description?: string;
  priority?: number;
}

export interface TaskUpdateRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
}

export type RuntimeChatRunStatus =
  | "preparing"
  | "routing"
  | "waiting_first_token"
  | "streaming"
  | "running_tools"
  | "waiting_for_plan_approval"
  | "waiting_for_patch_approval"
  | "waiting_for_command_approval"
  | "waiting_for_web_approval"
  | "waiting_for_user_answer"
  | "resuming"
  | "resuming_after_plan_approval"
  | "completed"
  | "cancelled"
  | "timeout"
  | "failed";

export type RuntimeChatEventType =
  | "chat.accepted"
  | "runtime.check.started"
  | "runtime.check.completed"
  | "routing.started"
  | "routing.completed"
  | "context.started"
  | "context.file_read"
  | "context.completed"
  | "model.request.started"
  | "model.first_token"
  | "model.delta"
  | "model.turn.completed"
  | "tool.started"
  | "tool.completed"
  | "file.change.proposed"
  | "command.started"
  | "command.output"
  | "command.completed"
  | "chat.cancelled"
  | "chat.timeout"
  | "chat.failed"
  | "chat.completed"
  | "chat.question_asked"
  | "chat.answer_received"
  | "runtime.fallback.initiated";

export interface RuntimeChatEvent {
  id: string;
  type: RuntimeChatEventType;
  timestamp: string;
  durationMs?: number;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface RuntimeChatTurn {
  id: string;
  turnNumber: number;
  thought?: string;
  prompt: string;
  response?: string;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface RuntimeChatToolCall {
  id: string;
  name: string;
  toolCallId: string;
  status: "running" | "completed" | "failed";
  arguments: string;
  result?: string;
  durationMs?: number;
  filePath?: string;
  lineRange?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface RuntimeChatFileChange {
  id: string;
  filePath: string;
  additions: number;
  deletions: number;
  diff: string;
  status: "proposed" | "approved" | "rejected" | "applied";
  timestamp: string;
}

export interface RuntimeChatCommand {
  id: string;
  command: string;
  exitCode?: number;
  status: "running" | "completed" | "failed";
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  timestamp: string;
}

export interface RuntimeChatError {
  code: string;
  message: string;
  phase: string;
  provider?: string;
  endpoint?: string;
  requestId?: string;
}

/** Why an automatic fallback onto an already-resident model was rejected. */
export interface FallbackRejectionInfo {
  modelId: string;
  modelName: string;
  reason: string;
}

export interface RuntimeChatRun {
  id: string;
  userMessageId: string;
  assistantMessageId?: string;
  status: RuntimeChatRunStatus;
  /** Honest terminal outcome (Phase 2B). Independent of transitional status. */
  outcome?: RuntimeRunOutcome;

  provider?: string;
  modelId?: string;
  modelName?: string;
  /** Target runtime slot for this run. */
  slotId?: string;
  endpoint?: string;
  /** Task classification for this run (coding, chat, debug, ...), when known. */
  taskType?: string;

  /** Binding / diagnostics (optional; historical runs may omit). */
  configuredModelId?: string;
  selectionSource?: string;
  fallbackReason?: string;
  /** True when the run completed via a degraded-but-usable route such as resident fallback. */
  degraded?: boolean;
  /** Human-readable reason why the run is degraded. */
  degradedReason?: string;
  /** Set when an automatic resident-model fallback was considered but rejected as incompatible. */
  fallbackRejection?: FallbackRejectionInfo;
  settingsRevision?: number;
  warmupStatus?: "pending" | "ready" | "failed" | "skipped";
  workflowLabel?: string;
  phaseLabel?: string;
  targetAgentLabel?: string;

  /** Context stage used for this run (0–3). */
  contextStage?: ContextStage;
  /** Final request token budget snapshot when computed. */
  tokenBudget?: FinalRequestTokenBudget;
  /** True when minimal planning context fallback was applied. */
  contextFallbackApplied?: boolean;
  /** Sources dropped during budget reduction / fallback (deduped ids). */
  droppedSources?: string[];
  /** Structured drop telemetry (deduped by id). */
  droppedContextSources?: DroppedContextSource[];
  /** Prompt binding diagnostics (pre/post/sent hashes + tokens). */
  promptBindingDiagnostics?: Record<string, unknown>;
  /** Compact provider-request diagnostics (hashes/lengths only). */
  providerRequestDiagnostics?: Record<string, unknown>;
  /** Highest verified readiness stage for this run. */
  readinessStage?: RuntimeReadinessStage;
  /** Warm-up timing diagnostics when available. */
  warmupDiagnostics?: RuntimeWarmupDiagnostics;
  /** Resource-fit risk for the bound model. */
  resourceRisk?: "low" | "medium" | "high" | "unsupported";
  resourceRiskReasons?: string[];
  /** Slot snapshot taken before model.request.started. */
  slotExecutionState?: {
    slotId: string;
    processRunning: boolean;
    endpointReachable: boolean;
    modelLoaded: boolean;
    slotBusy: boolean;
    activeRunId?: string;
    modelId?: string;
    gpuLayers?: number;
    cpuOffloadLayers?: number;
    loadDurationMs?: number;
  };
  /** Multi-step repository review progress (when workflow is repository_review). */
  repositoryReview?: RepositoryReviewProgress;

  startedAt: string;
  firstTokenAt?: string;
  finishedAt?: string;

  mode: "auto" | "agent";
  profile: "ask" | "agent" | "full";

  contextEnabled: boolean;
  workspaceRoot?: string;
  activeFile?: string;

  events: RuntimeChatEvent[];
  turns: RuntimeChatTurn[];
  toolCalls: RuntimeChatToolCall[];
  fileChanges: RuntimeChatFileChange[];
  commands: RuntimeChatCommand[];
  error?: RuntimeChatError;
  /** Final-answer / parser diagnostics snapshot for export. */
  finalAnswerDiagnostics?: Record<string, unknown>;
}

export interface DocsAnalysisSummary {
  scanned_at: string;
  workspace_root: string;
  files_scanned: number;
  directories_scanned: number;
  todo_count: number;
  top_extensions: Array<{ extension: string; count: number }>;
  largest_files: Array<{ path: string; size_bytes: number }>;
}

export interface DocsGenerateRequest {
  workspace_root: string;
  max_files?: number;
}

export interface DocsGenerateResponse {
  content: string;
  summary: DocsAnalysisSummary;
}

export type AgentRole = "planner" | "coder" | "tester" | "reviewer" | "debugger" | "docs";

export interface AgentDefinition {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
}

// Implementation Plan (Phase 1)
export * from './implementationPlan.js';

// Agent Workbench (Phase 3F+)
export * from './agent-workbench.js';

// Review Gates (Phase 2C+)
export * from './review-gates.js';
export * from './contextPolicy.js';
export * from './trajectories.js';
export * from './modelLabel.js';
export * from './runtimeDoctor.js';
export * from "./webResearchContracts.js";
export * from './workspacePackageContract.js';
