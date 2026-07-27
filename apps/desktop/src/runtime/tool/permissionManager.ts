import type { ToolName, ToolScope } from "@/runtime/tool/toolContracts";
import { evaluateTerminalCommandPolicy } from "@/runtime/tool/execPolicy";
import { isTerminalAllowlisted } from "@/runtime/tool/terminalAllowlist";
import { isMetaToolName } from "@/runtime/tool/toolMetadata";

export interface ToolPermissionPolicy {
  actorId: string;
  allowedScopes: ToolScope[];
  allowedTools?: ToolName[];
  requiresApprovalFor?: ToolName[];
}

export interface PermissionDecision {
  granted: boolean;
  reason?: string;
  requiresApproval: boolean;
}

export interface PermissionEvaluationContext {
  workspaceRoot?: string;
  input?: Record<string, unknown>;
}

export type ApprovalCallback = (
  actorId: string,
  toolName: ToolName,
  reason: string,
  inputSnapshot?: Record<string, unknown>,
  workspaceRoot?: string
) => Promise<boolean>;

export class PermissionManager {
  private readonly policies = new Map<string, ToolPermissionPolicy>();

  constructor(private readonly requestApproval?: ApprovalCallback) {}

  upsertPolicy(policy: ToolPermissionPolicy): void {
    this.policies.set(policy.actorId, policy);
  }

  async evaluate(
    actorId: string,
    toolName: ToolName,
    requiredScopes: ToolScope[],
    context?: PermissionEvaluationContext
  ): Promise<PermissionDecision> {
    const policy = this.policies.get(actorId);
    if (!policy) {
      return {
        granted: false,
        requiresApproval: false,
        reason: "No policy for actor"
      };
    }

    if (policy.allowedTools && !policy.allowedTools.includes(toolName)) {
      return {
        granted: false,
        requiresApproval: false,
        reason: "Tool blocked by active skill policy"
      };
    }

    if (isMetaToolName(toolName)) {
      return { granted: true, requiresApproval: false };
    }

    const scopeAllowed = requiredScopes.every((scope) =>
      policy.allowedScopes.includes(scope)
    );

    if (!scopeAllowed) {
      return {
        granted: false,
        requiresApproval: false,
        reason: "Scope not allowed"
      };
    }

    let requiresApproval = policy.requiresApprovalFor?.includes(toolName) ?? false;

    if (toolName === "run_terminal_command" && context?.input?.command) {
      const command = String(context.input.command);
      const execPolicy = evaluateTerminalCommandPolicy(command);
      if (execPolicy.decision === "forbidden") {
        return {
          granted: false,
          requiresApproval: false,
          reason: execPolicy.reason ?? "Command forbidden by exec policy."
        };
      }
      if (execPolicy.decision === "prompt") {
        requiresApproval = true;
      }
      if (
        context.workspaceRoot &&
        isTerminalAllowlisted(context.workspaceRoot, command)
      ) {
        return { granted: true, requiresApproval: false };
      }
    }

    if (!requiresApproval) {
      return { granted: true, requiresApproval: false };
    }

    if (!this.requestApproval) {
      return {
        granted: false,
        requiresApproval: true,
        reason: "Approval callback missing"
      };
    }

    const approved = await this.requestApproval(
      actorId,
      toolName,
      "Policy requires explicit approval",
      context?.input,
      context?.workspaceRoot
    );

    return {
      granted: approved,
      requiresApproval: true,
      reason: approved ? undefined : "User denied approval"
    };
  }
}
