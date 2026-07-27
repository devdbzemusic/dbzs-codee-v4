import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";

export type ToolsetId =
  | "filesystem.read"
  | "filesystem.write"
  | "workspace.search"
  | "terminal"
  | "git"
  | "tests"
  | "meta"
  | "mcp"
  | "interaction"
  | "skill";

export const ALL_TOOLSET_IDS: ToolsetId[] = [
  "filesystem.read",
  "filesystem.write",
  "workspace.search",
  "terminal",
  "git",
  "tests",
  "meta",
  "mcp",
  "interaction",
  "skill"
];

export function toolsetsForProfile(profile: AgentToolProfile): ToolsetId[] {
  switch (profile) {
    case "ask":
      return ["filesystem.read", "workspace.search", "git", "interaction", "skill"];
    case "agent":
      return ["filesystem.read", "filesystem.write", "workspace.search", "git", "tests", "interaction", "skill"];
    case "full":
      return ["filesystem.read", "filesystem.write", "workspace.search", "git", "tests", "terminal", "interaction", "skill"];
    default:
      return ["filesystem.read", "workspace.search", "git", "interaction", "skill"];
  }
}

export function isMcpToolset(toolset: ToolsetId): boolean {
  return toolset === "mcp";
}
