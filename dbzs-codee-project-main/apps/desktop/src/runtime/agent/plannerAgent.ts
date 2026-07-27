import type {
  AgentRunRequest,
  PlannerResult
} from "@/runtime/agent/agentContracts";
import type { ToolName } from "@/runtime/tool/toolContracts";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PlannerAgent {
  plan(request: AgentRunRequest): PlannerResult {
    const baseTools: ToolName[] =
      request.mode === "debug"
        ? ["read_file", "grep", "run_tests", "apply_patch"]
        : request.mode === "review"
          ? ["read_file", "grep", "get_git_diff"]
          : ["read_file", "search_workspace", "apply_patch", "run_tests"];

    return {
      summary: `Plan for ${request.role} in ${request.mode} mode`,
      steps: [
        {
          id: createId("step"),
          title: "Collect context",
          objective: "Gather the minimum required context for the goal.",
          expectedTools: ["search_workspace", "read_file"]
        },
        {
          id: createId("step"),
          title: "Execute scoped changes",
          objective: request.goal,
          expectedTools: baseTools
        },
        {
          id: createId("step"),
          title: "Verify and reflect",
          objective: "Validate outcome and report remaining risks.",
          expectedTools: ["run_tests", "get_git_diff"]
        }
      ]
    };
  }
}
