import type {
  AgentFileChangeProposal,
  AgentFileChangeType,
  AgentPatchProposal,
  AgentPatchRiskLevel
} from "@dbzs/shared";
import { z } from "zod";

const ProposeFileChangesToolOutputSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1000),
  changes: z.array(
    z
      .object({
        file_path: z.string().min(1),
        change_type: z.enum(["create", "modify", "delete"]),
        proposed_content: z.string().optional(),
        reason: z.string().min(1).max(1000),
        risk_level: z.enum(["low", "medium", "high"]).default("low")
      })
      .superRefine((value, ctx) => {
        if ((value.change_type === "create" || value.change_type === "modify") && typeof value.proposed_content !== "string") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "proposed_content is required for create/modify"
          });
        }
        if (value.change_type === "delete" && value.proposed_content !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "proposed_content is not allowed for delete"
          });
        }
      })
  ).min(1).max(8),
  validation_commands: z.array(z.string().min(1)).default([])
});

const COMMAND_ALIASES: Record<string, string> = {
  typecheck: "pnpm_typecheck",
  test: "pnpm_test",
  pnpm_typecheck: "pnpm_typecheck",
  pnpm_test: "pnpm_test",
  npm_run_typecheck: "npm_run_typecheck",
  npm_test: "npm_test"
};

export function createRuntimePatchId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeWorkspaceRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new Error(`[PATCH_PATH_INVALID] Pfad muss workspace-relativ sein: ${filePath}`);
  }
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) {
    throw new Error(`[PATCH_PATH_INVALID] Absolute Pfade sind blockiert: ${filePath}`);
  }
  return normalized;
}

export function normalizeValidationCommands(commands: string[] | undefined): string[] {
  const normalized = new Set<string>();
  for (const command of commands ?? []) {
    const mapped = COMMAND_ALIASES[command.trim()];
    if (mapped) {
      normalized.add(mapped);
    }
  }
  return [...normalized];
}

export function normalizeProposeFileChangesToolOutput(input: {
  output: unknown;
  runId: string;
  decisionId?: string | null;
  chatTurnId?: string | null;
  workspaceRoot?: string | null;
}): AgentPatchProposal {
  const parsed = ProposeFileChangesToolOutputSchema.parse(input.output);
  const createdAt = new Date().toISOString();
  const proposalId = createRuntimePatchId("runtime-patch");

  const changes: AgentFileChangeProposal[] = parsed.changes.map((change, index) => {
    const changeType = change.change_type;
    const riskLevel = change.risk_level;
    const proposedContent = changeType === "delete" ? undefined : change.proposed_content;
    return {
      id: `${proposalId}-change-${index + 1}`,
      runId: input.runId,
      decisionId: input.decisionId ?? undefined,
      filePath: normalizeWorkspaceRelativePath(change.file_path),
      changeType,
      proposedContent,
      reason: change.reason,
      summary: change.reason,
      riskLevel,
      requiresReview: true,
      createdAt
    };
  });

  return {
    id: proposalId,
    runId: input.runId,
    decisionId: input.decisionId ?? undefined,
    chatTurnId: input.chatTurnId ?? undefined,
    workspaceRoot: input.workspaceRoot ?? undefined,
    title: parsed.title,
    summary: parsed.summary,
    changes,
    validationCommands: normalizeValidationCommands(parsed.validation_commands),
    createdAt
  };
}
