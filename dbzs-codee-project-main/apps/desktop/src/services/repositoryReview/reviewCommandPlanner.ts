import type { RepositoryInventory, ReviewCommandPlan, RepositoryReviewRequest } from "@dbzs/shared";

const DESTRUCTIVE_PATTERN =
  /\b(rm\s+-rf|del\s+\/s|format\s+|diskpart|shutdown|reboot|drop\s+table|git\s+push\s+--force|git\s+reset\s+--hard)\b/i;
const INSTALL_PATTERN = /\b(npm\s+i\b|npm\s+install|pnpm\s+i\b|pnpm\s+install|yarn\s+add|pip\s+install|bun\s+add)\b/i;

export function isDestructiveReviewCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERN.test(command);
}

export function isInstallReviewCommand(command: string): boolean {
  return INSTALL_PATTERN.test(command);
}

export function planReviewCommands(
  request: RepositoryReviewRequest,
  inventory: RepositoryInventory
): ReviewCommandPlan[] {
  const cwd = request.workspaceRoot;
  const plans: ReviewCommandPlan[] = [];

  const pushUnique = (id: string, command: string, purpose: string, timeoutMs: number) => {
    if (isDestructiveReviewCommand(command)) return;
    if (plans.some((p) => p.command === command)) return;
    plans.push({
      id,
      command,
      cwd,
      purpose,
      timeoutMs,
      requiresApproval: isInstallReviewCommand(command)
    });
  };

  for (const [index, command] of inventory.typecheckCommands.entries()) {
    pushUnique(`typecheck-${index}`, command, "Typecheck", 180_000);
  }
  for (const [index, command] of inventory.lintCommands.entries()) {
    pushUnique(`lint-${index}`, command, "Lint", 180_000);
  }
  for (const [index, command] of inventory.testCommands.entries()) {
    pushUnique(`test-${index}`, command, "Unit tests", 300_000);
  }
  if (request.includeBuildChecks) {
    for (const [index, command] of inventory.buildCommands.entries()) {
      pushUnique(`build-${index}`, command, "Production build", 600_000);
    }
  }

  return plans;
}
