import type { RuntimeTaskType } from "@dbzs/shared";
import type { ToolName } from "@/runtime/tool/toolContracts";

export type WorkflowToolPhase = "planning" | "implementation" | "verification" | "chat";

const PHASE_TOOL_NAMES: Record<WorkflowToolPhase, ToolName[]> = {
  planning: ["list_files", "read_file", "search_workspace", "grep", "ask_user"],
  implementation: [
    "read_file",
    "grep",
    "propose_file_changes",
    "apply_patch",
    "run_terminal_command",
    "run_tests",
    "get_git_diff"
  ],
  verification: ["read_file", "grep", "run_tests", "get_git_diff"],
  chat: []
};

const PHASE_TOOL_LIMITS: Record<WorkflowToolPhase, number> = {
  planning: 5,
  implementation: 8,
  verification: 6,
  chat: 0
};

export function resolveWorkflowToolPhase(input: {
  taskType: RuntimeTaskType;
  phase?: string | null;
}): WorkflowToolPhase {
  const normalizedPhase = (input.phase ?? "").toLowerCase();
  if (["review", "verification", "completed"].includes(normalizedPhase)) {
    return "verification";
  }
  if (["implementation", "executing", "awaiting_patch_approval", "testing", "diagnosis"].includes(normalizedPhase)) {
    return "implementation";
  }
  if (
    normalizedPhase === "planning" ||
    normalizedPhase === "awaiting_plan_approval" ||
    normalizedPhase === "clarification"
  ) {
    return "planning";
  }
  if (["casual_chat", "normal_chat"].includes(input.taskType)) {
    return "chat";
  }
  if (["planning", "architecture", "review"].includes(input.taskType)) {
    return "planning";
  }
  if (["small_code_change", "large_code_change", "debugging", "refactoring", "test_analysis"].includes(input.taskType)) {
    return "implementation";
  }
  return "chat";
}

export function resolveWorkflowPhaseToolNames(input: {
  taskType: RuntimeTaskType;
  phase?: string | null;
  skillAllowedNames?: ToolName[];
}): ToolName[] | undefined {
  const toolPhase = resolveWorkflowToolPhase(input);
  if (toolPhase === "chat") {
    return input.skillAllowedNames ? [...input.skillAllowedNames] : undefined;
  }
  const phaseTools = PHASE_TOOL_NAMES[toolPhase];
  return input.skillAllowedNames
    ? phaseTools.filter((name) => input.skillAllowedNames?.includes(name))
    : [...phaseTools];
}

export function resolveWorkflowPhaseToolLimit(input: {
  taskType: RuntimeTaskType;
  phase?: string | null;
}): number | null {
  const toolPhase = resolveWorkflowToolPhase(input);
  return toolPhase === "chat" ? null : PHASE_TOOL_LIMITS[toolPhase];
}
