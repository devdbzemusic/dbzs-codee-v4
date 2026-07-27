import { workspaceScopeId, type ModelTargetAgent } from "@dbzs/shared";
import type { UserExecutionIntent } from "@/services/executionIntent";
import { classifyUserExecutionIntent } from "@/services/executionIntent";

export type ContextPriority =
  | "P0_NON_DROPPABLE"
  | "P1_REQUIRED"
  | "P2_RELEVANT"
  | "P3_OPTIONAL";

export type GoalCapsuleExecutionIntent =
  | "implement"
  | "fix"
  | "refactor"
  | "review"
  | "plan";

export interface GoalCapsule {
  runId: string;
  workspaceId: string;
  workspaceRoot: string;
  originalUserMessage: string;
  normalizedGoal: string;
  executionIntent: GoalCapsuleExecutionIntent;
  targetAgent: "coder" | "reviewer" | "planner";
  phase: string;
  activeFile?: string;
  approvedPlanId?: string;
  acceptanceCriteria: string[];
  constraints: string[];
  createdAt: string;
}

export function mapUserIntentToCapsuleIntent(
  intent: UserExecutionIntent
): GoalCapsuleExecutionIntent {
  switch (intent) {
    case "implement":
    case "build":
    case "test":
      return "implement";
    case "fix":
    case "fix_review_findings":
      return "fix";
    case "refactor":
      return "refactor";
    case "review":
      return "review";
    case "plan_only":
      return "plan";
    case "explain_only":
    case "inspect":
      return "plan";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

export function mapCapsuleIntentToTargetAgent(
  intent: GoalCapsuleExecutionIntent
): "coder" | "reviewer" | "planner" {
  switch (intent) {
    case "review":
      return "reviewer";
    case "plan":
      return "planner";
    case "implement":
    case "fix":
    case "refactor":
      return "coder";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

export function buildGoalCapsule(input: {
  runId: string;
  workspaceRoot: string;
  originalUserMessage: string;
  targetAgent?: ModelTargetAgent;
  phase?: string;
  activeFile?: string | null;
  approvedPlanId?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  executionIntent?: UserExecutionIntent;
}): GoalCapsule {
  const intent = input.executionIntent ?? classifyUserExecutionIntent(input.originalUserMessage);
  const capsuleIntent = mapUserIntentToCapsuleIntent(intent);
  const target =
    input.targetAgent === "reviewer" || input.targetAgent === "planner" || input.targetAgent === "coder"
      ? input.targetAgent
      : mapCapsuleIntentToTargetAgent(capsuleIntent);

  return {
    runId: input.runId,
    workspaceId: workspaceScopeId(input.workspaceRoot || "unknown"),
    workspaceRoot: input.workspaceRoot || "",
    originalUserMessage: input.originalUserMessage.trim(),
    normalizedGoal: input.originalUserMessage.trim(),
    executionIntent: capsuleIntent,
    targetAgent: target,
    phase: input.phase ?? (capsuleIntent === "review" ? "review" : "planning"),
    activeFile: input.activeFile ?? undefined,
    approvedPlanId: input.approvedPlanId,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    constraints: input.constraints ?? [],
    createdAt: new Date().toISOString()
  };
}

/** Mandatory system block — never droppable. */
export function formatGoalCapsuleBlock(capsule: GoalCapsule): string {
  return [
    "[GOAL CAPSULE — P0_NON_DROPPABLE]",
    `runId: ${capsule.runId}`,
    `workspaceRoot: ${capsule.workspaceRoot || "(unbound)"}`,
    `executionIntent: ${capsule.executionIntent}`,
    `targetAgent: ${capsule.targetAgent}`,
    `phase: ${capsule.phase}`,
    capsule.approvedPlanId ? `approvedPlanId: ${capsule.approvedPlanId}` : null,
    capsule.activeFile ? `activeFile: ${capsule.activeFile}` : null,
    `originalUserMessage: ${capsule.originalUserMessage}`,
    `normalizedGoal: ${capsule.normalizedGoal}`,
    capsule.acceptanceCriteria.length
      ? `acceptanceCriteria:\n- ${capsule.acceptanceCriteria.join("\n- ")}`
      : "acceptanceCriteria: (none)",
    capsule.constraints.length
      ? `constraints:\n- ${capsule.constraints.join("\n- ")}`
      : "constraints: (none)",
    "",
    "Rules:",
    "- Never ignore this goal.",
    "- Do not execute demo/example tool paths (exampleFunction.js, featureName, foo/bar).",
    "- Prefer workspace-grounded tools: list_files, read_file package.json, vite.config, git_status."
  ]
    .filter((line) => line !== null)
    .join("\n");
}
