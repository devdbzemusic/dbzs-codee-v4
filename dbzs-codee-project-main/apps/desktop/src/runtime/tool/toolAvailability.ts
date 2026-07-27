export interface ToolAvailabilityContext {
  workspaceRoot: string;
  hasGitRepo: boolean;
  hasTerminalBridge: boolean;
  hasTestCommands: boolean;
}

export function createDefaultToolAvailabilityContext(
  workspaceRoot: string,
  overrides: Partial<Omit<ToolAvailabilityContext, "workspaceRoot">> = {}
): ToolAvailabilityContext {
  return {
    workspaceRoot,
    hasGitRepo: overrides.hasGitRepo ?? false,
    hasTerminalBridge: overrides.hasTerminalBridge ?? hasTerminalBridge(),
    hasTestCommands: overrides.hasTestCommands ?? false
  };
}

export function hasTerminalBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const bridge = window.dbzs as { runTerminalCommand?: unknown } | undefined;
  return typeof bridge?.runTerminalCommand === "function";
}

export function hasWorkspaceRoot(ctx: ToolAvailabilityContext): boolean {
  return ctx.workspaceRoot.trim().length > 0;
}
