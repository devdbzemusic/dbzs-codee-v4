import { createDefaultToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import { useGitStore } from "@/stores/gitStore";
import { useTestAgentStore } from "@/stores/testAgentStore";

export function buildToolAvailabilityContext(workspaceRoot: string): ToolAvailabilityContext {
  const gitState = useGitStore.getState();
  const allowedCommands = useTestAgentStore.getState().allowedCommands;
  return createDefaultToolAvailabilityContext(workspaceRoot, {
    hasGitRepo: Boolean(gitState.repositoryStatus?.isRepository),
    hasTestCommands: allowedCommands.length > 0
  });
}
