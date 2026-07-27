import type { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import type {
  AgentLoopResult,
  AgentPolicy,
  AgentRunRequest,
  PlannerResult,
  ToolCalling
} from "@/runtime/agent/agentContracts";
import { AgentLoop } from "@/runtime/agent/agentLoop";
import type { PatchApprovalCallback } from "@/runtime/agent/agentLoop";
import { PlannerAgent } from "@/runtime/agent/plannerAgent";

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  maxRuntimeMs: 120_000,
  maxSteps: 12,
  maxToolCalls: 48,
  maxRetriesPerStep: 1,
  requiresApprovalForPatch: true
};

export class AgentOrchestrator {
  private readonly planner = new PlannerAgent();

  constructor(
    private readonly eventBus: RuntimeEventBus,
    private readonly tools: ToolCalling,
    private readonly policy: AgentPolicy = DEFAULT_AGENT_POLICY,
    private readonly requestPatchApproval?: PatchApprovalCallback
  ) {}

  async run(
    request: AgentRunRequest,
    signal: AbortSignal,
    customPlan?: PlannerResult
  ): Promise<AgentLoopResult> {
    const plan = customPlan ?? this.planner.plan(request);

    await this.eventBus.emit("agent-runtime", "agent.plan.created", {
      runId: request.runId,
      summary: plan.summary,
      steps: plan.steps.map((step) => ({ id: step.id, title: step.title }))
    });

    const loop = new AgentLoop(this.eventBus, this.tools, this.policy, this.requestPatchApproval);
    const result = await loop.run(request, plan, signal);

    await this.eventBus.emit("agent-runtime", "agent.run.completed", result);
    return result;
  }
}
