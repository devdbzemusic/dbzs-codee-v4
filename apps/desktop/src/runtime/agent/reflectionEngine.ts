import type {
  AgentStep,
  ReflectionResult
} from "@/runtime/agent/agentContracts";
import type { ToolResult } from "@/runtime/tool/toolContracts";

export class ReflectionEngine {
  reflect(step: AgentStep, toolResults: ToolResult[]): ReflectionResult {
    const failed = toolResults.find((result) => result.status !== "ok");
    if (failed) {
      return {
        done: false,
        issues: [`${step.title} failed: ${failed.error?.message ?? failed.status}`],
        nextStepHint: "retry"
      };
    }

    return {
      done: true
    };
  }
}
