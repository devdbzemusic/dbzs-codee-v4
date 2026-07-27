import type { ExecutedReviewCheck, ReviewCommandPlan } from "@dbzs/shared";
import { isDestructiveReviewCommand, isInstallReviewCommand } from "./reviewCommandPlanner";
import type { ReviewWorkspaceIO } from "./types";

function redact(text: string): string {
  return text
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/([A-Za-z]:\\[^\s"']+)/g, "[path]")
    .slice(0, 4000);
}

export interface RunReviewCommandsOptions {
  io: ReviewWorkspaceIO;
  commands: ReviewCommandPlan[];
  /** When false, mark executable commands as not_executed instead of running. */
  executionAllowed: boolean;
  /** Install commands still need explicit approval even if executionAllowed. */
  approveInstall?: boolean;
}

export async function runReviewCommands(
  options: RunReviewCommandsOptions
): Promise<ExecutedReviewCheck[]> {
  const results: ExecutedReviewCheck[] = [];

  for (const plan of options.commands) {
    if (isDestructiveReviewCommand(plan.command)) {
      results.push({
        id: plan.id,
        command: plan.command,
        purpose: plan.purpose,
        status: "not_available",
        stderrPreview: "destructive_command_blocked"
      });
      continue;
    }

    if (plan.requiresApproval || isInstallReviewCommand(plan.command)) {
      if (!options.approveInstall) {
        results.push({
          id: plan.id,
          command: plan.command,
          purpose: plan.purpose,
          status: "not_executed",
          stderrPreview: "install_requires_approval"
        });
        continue;
      }
    }

    if (!options.executionAllowed) {
      results.push({
        id: plan.id,
        command: plan.command,
        purpose: plan.purpose,
        status: "not_executed",
        stderrPreview: "execution_not_allowed"
      });
      continue;
    }

    if (!options.io.runCommand) {
      results.push({
        id: plan.id,
        command: plan.command,
        purpose: plan.purpose,
        status: "not_available",
        stderrPreview: "command_runner_unavailable"
      });
      continue;
    }

    try {
      const result = await options.io.runCommand({
        cwd: plan.cwd,
        command: plan.command,
        timeoutMs: plan.timeoutMs
      });
      results.push({
        id: plan.id,
        command: plan.command,
        purpose: plan.purpose,
        status: result.exitCode === 0 ? "passed" : "failed",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdoutPreview: redact(result.stdout),
        stderrPreview: redact(result.stderr)
      });
    } catch (error) {
      results.push({
        id: plan.id,
        command: plan.command,
        purpose: plan.purpose,
        status: "failed",
        stderrPreview: redact(error instanceof Error ? error.message : String(error))
      });
    }
  }

  return results;
}
