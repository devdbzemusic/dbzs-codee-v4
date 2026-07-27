import type { ToolName } from "@/runtime/tool/toolContracts";

export type ReviewRemediationToolPhase = "planning" | "implementation" | "verification";

const PHASE_TOOLS: Record<ReviewRemediationToolPhase, ToolName[]> = {
  planning: ["read_file", "list_files", "grep", "ask_user"],
  implementation: [
    "read_file",
    "grep",
    "propose_file_changes",
    "apply_patch",
    "run_terminal_command",
    "run_tests",
    "get_git_diff"
  ],
  verification: ["read_file", "grep", "run_tests", "get_git_diff"]
};

export const REVIEW_REMEDIATION_PHASE_TOOL_LIMITS: Record<
  ReviewRemediationToolPhase,
  number
> = {
  planning: 5,
  implementation: 8,
  verification: 6
};

export function resolveReviewRemediationToolPhase(
  phase: string
): ReviewRemediationToolPhase {
  if (["implementation", "executing", "awaiting_patch_approval", "testing"].includes(phase)) {
    return "implementation";
  }
  if (["review", "completed"].includes(phase)) return "verification";
  return "planning";
}

export function resolveReviewRemediationPhaseToolNames(
  phase: string,
  skillAllowedNames?: ToolName[]
): ToolName[] {
  const allowed = PHASE_TOOLS[resolveReviewRemediationToolPhase(phase)];
  return skillAllowedNames
    ? allowed.filter((name) => skillAllowedNames.includes(name))
    : [...allowed];
}
