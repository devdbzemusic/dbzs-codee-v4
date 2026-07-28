import type {
  AgentPatchProposal,
  ExecutedReviewCheck,
  PatchValidationResult,
  ReviewCommandPlan
} from "@dbzs/shared";
import { runReviewCommands } from "./reviewCommandRunner";
import type { ReviewWorkspaceIO } from "@/services/repositoryReview/types";
import { getPatchProposal, updatePatchState, saveValidationResult } from "./patchPersistence";

export interface PatchValidationServiceOptions {
  io: ReviewWorkspaceIO;
  executionAllowed: boolean;
  approveInstall?: boolean;
}

function commandsToPlan(
  commands: string[],
  workspaceRoot: string
): ReviewCommandPlan[] {
  return commands.map((command, index) => ({
    id: `validation-${index}`,
    command,
    cwd: workspaceRoot,
    purpose: "Patch validation",
    timeoutMs: 300_000, // 5 minutes
    requiresApproval: false
  }));
}

function checksToResult(
  proposalId: string,
  checks: ExecutedReviewCheck[]
): PatchValidationResult {
  const success = checks.every((c) => c.status === "passed");
  return {
    proposalId,
    success,
    commands: checks.map((c) => ({
      commandId: c.id,
      exitCode: c.exitCode ?? null,
      stdout: c.stdoutPreview ?? "",
      stderr: c.stderrPreview ?? ""
    }))
  };
}

/**
 * Runs validation commands associated with a patch proposal.
 */
export async function runValidation(
  proposalId: string,
  options: PatchValidationServiceOptions
  restorePointId: string | null = null
): Promise<PatchValidationResult> {
  const proposal = await getPatchProposal(options.io, proposalId);
  if (!proposal?.workspaceRoot) {
    throw new Error(`Proposal or workspace root for ${proposalId} not found.`);
  }

  const commands = proposal.validationCommands ?? [];
  if (commands.length === 0) {
    await updatePatchState(options.io, proposal.workspaceRoot, proposalId, "PASSED");
    return { proposalId, success: true, commands: [] };
  }

  await updatePatchState(options.io, proposal.workspaceRoot, proposalId, "VALIDATING");

  const commandPlan = commandsToPlan(commands, proposal.workspaceRoot);
  const checks = await runReviewCommands({
    io: options.io,
    commands: commandPlan,
    executionAllowed: options.executionAllowed,
    approveInstall: options.approveInstall,
    workspaceRoot: proposal.workspaceRoot
  });

  const result = checksToResult(proposalId, checks);

  await saveValidationResult(options.io, proposal.workspaceRoot, proposalId, result);

  if (!result.success) {
    // TODO: Emit a chat action for rollback_patch here.
    // This would typically involve a higher-level orchestrator or a chat store service.
    // The action payload would include { proposalId, restorePointId }.
    console.log(`[PatchValidation] Validation failed for proposal ${proposalId}. Rollback action should be offered. Restore point: ${restorePointId}`);
  }

  return result;
}

/**
 * Retrieves the validation commands from a patch proposal.
 * This is a lightweight method to be used before applying the patch.
 */
export async function getValidationCommands(
  io: ReviewWorkspaceIO,
  proposalId: string
): Promise<string[]> {
  const proposal = await getPatchProposal(io, proposalId);
  return proposal?.validationCommands ?? [];
}
