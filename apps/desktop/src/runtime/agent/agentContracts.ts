import type { ToolName, ToolRequest, ToolResult } from "@/runtime/tool/toolContracts";

export type AgentMode =
  | "ask"
  | "edit"
  | "agent"
  | "debug"
  | "review";

export type AgentRole = "planner" | "coder" | "debugger" | "tester";

export interface AgentPolicy {
  maxRuntimeMs: number;
  maxSteps: number;
  maxToolCalls: number;
  maxRetriesPerStep: number;
  requiresApprovalForPatch: boolean;
}

export interface AgentExecutionContext {
  primaryFilePath?: string;
  relatedFilePaths?: string[];
  searchQuery?: string;
  gitDiffFilePath?: string;
  testCommandId?: string;
  scratchNotePath?: string;
  contextSummary?: string;
  primaryFileExcerpt?: string;
}

export interface AgentRunRequest {
  runId: string;
  actorId: string;
  goal: string;
  mode: AgentMode;
  role: AgentRole;
  workspaceRoot: string;
  executionContext?: AgentExecutionContext;
}

export interface AgentStep {
  id: string;
  title: string;
  objective: string;
  expectedTools: ToolName[];
}

export interface PlannerResult {
  summary: string;
  steps: AgentStep[];
}

export interface ReflectionResult {
  done: boolean;
  nextStepHint?: string;
  issues?: string[];
}

export interface ToolCalling {
  runTool: (request: ToolRequest) => Promise<ToolResult>;
}

export interface AgentLoopResult {
  runId: string;
  status: "completed" | "failed" | "cancelled" | "timeout";
  appliedPatchPreviewIds: string[];
  stepsExecuted: number;
  toolCallsExecuted: number;
  lastError?: string;
}
