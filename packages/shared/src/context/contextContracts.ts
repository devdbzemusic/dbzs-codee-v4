import type { RuntimeSlotId, RuntimeTaskType } from "../runtime/runtimeSlots.js";

export const CONTEXT_SCHEMA_VERSION = 1;

export type ContextItemKind = "file" | "symbol" | "definition" | "reference" | "test" | "config" |
  "documentation" | "git_diff" | "diagnostic" | "memory" | "tool_result";

export type ContextFailureCode = "context_overflow" | "context_incomplete" | "retrieval_failed" |
  "index_stale" | "model_unavailable" | "slot_unavailable" | "tool_timeout" | "tool_failed" |
  "patch_conflict" | "verification_failed" | "workspace_changed" | "approval_missing";

export interface ContextRequest {
  taskId: string;
  taskType: RuntimeTaskType;
  userQuery: string;
  workspaceRoot: string;
  activeFile?: string;
  selectedFiles?: string[];
  maxTokens: number;
  modelId: string;
  slotId: RuntimeSlotId;
}

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  sourcePath?: string;
  symbol?: string;
  content: string;
  relevanceScore: number;
  freshnessScore: number;
  trustScore: number;
  tokenEstimate: number;
  reasons: string[];
}

export interface ContextBudget {
  modelContextLimit: number;
  systemTokens: number;
  conversationTokens: number;
  /** Maximum repository context tokens allocated after reserves. */
  repositoryTokens: number;
  /** Repository context tokens actually selected for the prompt. */
  repositoryTokensUsed: number;
  toolTokens: number;
  responseReserve: number;
  safetyMargin: number;
}

export interface RetrievalTrace {
  id: string;
  schemaVersion: number;
  strategy: string[];
  candidateCount: number;
  selectedCount: number;
  duplicateCount: number;
  startedAt: string;
  completedAt: string;
  gaps: string[];
}

export interface ContextPack {
  schemaVersion: number;
  taskId: string;
  items: ContextItem[];
  totalTokens: number;
  omittedItems: Array<{ id: string; reason: string }>;
  summary: string;
  retrievalTraceId: string;
  trace?: RetrievalTrace;
  budget?: ContextBudget;
}

export type TaskStepType = "inspect" | "retrieve" | "analyze" | "edit" | "test" | "review" | "document";
export type TaskStepStatus = "pending" | "running" | "blocked" | "completed" | "failed";

export interface TaskStep {
  id: string; title: string; type: TaskStepType; dependencies: string[]; status: TaskStepStatus;
  expectedArtifacts: string[]; verification: string[];
}

export interface TaskPlan {
  taskId: string; goal: string; assumptions: string[]; constraints: string[]; steps: TaskStep[];
  successCriteria: string[]; risks: string[]; requiredApprovals: string[];
}

export interface ModelCapabilityProfile {
  modelId: string; contextWindow: number; preferredRoles: string[]; codingScore: number;
  reviewScore: number; planningScore: number; toolCallingScore: number; structuredOutputScore: number;
  tokensPerSecond: number; ramRequirementMb: number; vramRequirementMb: number; testedAt: string;
}
