import type { ToolName, ToolScope } from "@/runtime/tool/toolContracts";

export type AgentToolProfile = "ask" | "agent" | "full";

const READ_TOOLS: ToolName[] = [
  "read_file",
  "list_files",
  "search_workspace",
  "grep",
  "open_file",
  "get_git_diff"
];

const WRITE_TOOLS: ToolName[] = [
  "propose_file_changes",
  "write_file",
  "apply_patch",
  "create_file",
  "delete_file",
  "rename_file"
];

const EXEC_TOOLS: ToolName[] = [
  "run_terminal_command",
  "run_tests",
  "run_workspace_command",
  "install_dependency",
  "web_search",
  "web_fetch"
];

const INTERACTION_TOOLS: ToolName[] = ["ask_user"];
const SKILL_TOOLS: ToolName[] = ["write_skill_artifact"];

const ALL_TOOLS: ToolName[] = [...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS, ...INTERACTION_TOOLS, ...SKILL_TOOLS];

export function allowedToolsForProfile(profile: AgentToolProfile): ToolName[] {
  switch (profile) {
    case "ask":
      return [...READ_TOOLS, ...INTERACTION_TOOLS, ...SKILL_TOOLS];
    case "agent":
      return ALL_TOOLS;
    case "full":
      return ALL_TOOLS;
    default:
      return [...READ_TOOLS, ...INTERACTION_TOOLS, ...SKILL_TOOLS];
  }
}

export function allowedScopesForProfile(profile: AgentToolProfile): ToolScope[] {
  const scopes: ToolScope[] = ["filesystem.read", "workspace.inspect", "workspace.search", "git.read", "interaction.ask"];
  if (profile === "ask") {
    scopes.push("skill.artifact");
    return scopes;
  }
  scopes.push("filesystem.write", "skill.artifact");
  if (profile === "full") {
    scopes.push("terminal.exec", "tests.exec");
  } else if (profile === "agent") {
    scopes.push("tests.exec", "terminal.exec");
  }
  return scopes;
}

export function isToolAllowedForProfile(profile: AgentToolProfile, toolName: ToolName): boolean {
  return allowedToolsForProfile(profile).includes(toolName);
}

export function shouldAutoApplyPatches(profile: AgentToolProfile): boolean {
  return false;
}

export function requiresPatchPreview(profile: AgentToolProfile): boolean {
  return profile === "agent";
}

export function profileLabel(profile: AgentToolProfile): string {
  switch (profile) {
    case "ask":
      return "Ask";
    case "agent":
      return "Agent";
    case "full":
      return "Full";
  }
}

export function toolsRequiringApproval(profile: AgentToolProfile): ToolName[] {
  if (profile === "full") {
    return ["delete_file", "run_terminal_command", "install_dependency"];
  }
  if (profile === "agent") {
    return [
      "write_file",
      "apply_patch",
      "create_file",
      "delete_file",
      "rename_file",
      "run_terminal_command",
      "install_dependency",
      "web_fetch"
    ];
  }
  return [];
}
