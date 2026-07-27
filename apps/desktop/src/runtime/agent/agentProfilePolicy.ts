import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import {
  allowedScopesForProfile,
  toolsRequiringApproval
} from "@/runtime/agent/agentToolProfile";
import { getRuntimeKernel } from "@/services/runtimeKernelService";

export function upsertRuntimeActorPolicyForProfile(
  actorId: string,
  profile: AgentToolProfile,
  allowedTools?: import("@/runtime/tool/toolContracts").ToolName[]
): void {
  getRuntimeKernel().tools.permissions.upsertPolicy({
    actorId,
    allowedScopes: allowedScopesForProfile(profile),
    allowedTools,
    requiresApprovalFor: toolsRequiringApproval(profile)
  });
}
