import { z } from "zod";
import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import { hasTerminalBridge, hasWorkspaceRoot } from "@/runtime/tool/toolAvailability";
import {
  ApplyPatchInputSchema,
  AskUserInputSchema,
  ProposeFileChangesInputSchema,
  CreateFileInputSchema,
  DeleteFileInputSchema,
  GetGitDiffInputSchema,
  GrepInputSchema,
  ListFilesInputSchema,
  OpenFileInputSchema,
  ReadFileInputSchema,
  RenameFileInputSchema,
  RunTerminalCommandInputSchema,
  RunTestsInputSchema,
  RunWorkspaceCommandInputSchema,
  InstallDependencyInputSchema,
  WebSearchInputSchema,
  WebFetchInputSchema,
  SearchWorkspaceInputSchema,
  ToolCallBridgeInputSchema,
  ToolDescribeBridgeInputSchema,
  ToolSearchBridgeInputSchema,
  WriteSkillArtifactInputSchema,
  WriteFileInputSchema,
  type ToolName,
  type ToolScope
} from "@/runtime/tool/toolContracts";
import type { ToolsetId } from "@/runtime/tool/toolsets";

export interface ToolMetadataEntry {
  name: ToolName;
  toolset: ToolsetId;
  scopes: ToolScope[];
  modelDescription: string;
  inputSchema: Record<string, unknown>;
  zodInputSchema: z.ZodType;
  outputSchema: z.ZodType;
  core?: boolean;
  checkAvailability?: (ctx: ToolAvailabilityContext) => boolean;
  unavailableReason?: string;
}

const JsonOutputSchema = z.unknown();

function workspaceRequired(ctx: ToolAvailabilityContext): boolean {
  return hasWorkspaceRoot(ctx);
}

export const BUILTIN_TOOL_METADATA: ToolMetadataEntry[] = [
  {
    name: "write_skill_artifact",
    toolset: "skill",
    scopes: ["skill.artifact"],
    core: true,
    modelDescription:
      "Write Markdown or JSON into the active skill run artifact directory. Never writes project files.",
    inputSchema: {
      type: "object",
      properties: {
        skillRunId: { type: "string" },
        relativePath: { type: "string" },
        content: { type: "string" },
        mediaType: { type: "string", enum: ["text/markdown", "application/json"] }
      },
      required: ["skillRunId", "relativePath", "content", "mediaType"]
    },
    zodInputSchema: WriteSkillArtifactInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Active workspace required"
  },
  {
    name: "read_file",
    toolset: "filesystem.read",
    scopes: ["filesystem.read"],
    core: true,
    modelDescription:
      "Read the contents of a workspace file. Use before editing. Paths are relative to workspace root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        startLine: { type: "integer", description: "Optional start line (1-based)" },
        endLine: { type: "integer", description: "Optional end line (1-based)" }
      },
      required: ["path"]
    },
    zodInputSchema: ReadFileInputSchema,
    outputSchema: z.string(),
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "list_files",
    toolset: "filesystem.read",
    scopes: ["workspace.inspect"],
    core: true,
    modelDescription: "List files and directories under a workspace path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path, empty for root" },
        recursive: { type: "boolean", description: "List recursively" }
      }
    },
    zodInputSchema: ListFilesInputSchema,
    outputSchema: z.array(z.string()),
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "grep",
    toolset: "workspace.search",
    scopes: ["workspace.search"],
    core: true,
    modelDescription: "Search file contents with a regex pattern across the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        include: { type: "string", description: "Glob filter e.g. src/**/*.ts" },
        maxResults: { type: "integer" }
      },
      required: ["pattern"]
    },
    zodInputSchema: GrepInputSchema,
    outputSchema: z.array(z.string()),
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "search_workspace",
    toolset: "workspace.search",
    scopes: ["workspace.search"],
    modelDescription: "Full-text search across indexed workspace files.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" }
      },
      required: ["query"]
    },
    zodInputSchema: SearchWorkspaceInputSchema,
    outputSchema: z.array(z.string()),
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "get_git_diff",
    toolset: "git",
    scopes: ["git.read"],
    modelDescription: "Show git diff for workspace or a specific file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Optional relative file path" }
      }
    },
    zodInputSchema: GetGitDiffInputSchema,
    outputSchema: z.string(),
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasGitRepo,
    unavailableReason: "Git repository not available"
  },
  {
    name: "propose_file_changes",
    toolset: "filesystem.write",
    scopes: ["filesystem.write"],
    core: true,
    modelDescription:
      "Propose safe workspace file changes for user review. Does not write files. Use this for coding edits instead of write_file/apply_patch.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "Workspace-relative path" },
              change_type: { type: "string", enum: ["create", "modify", "delete"] },
              proposed_content: { type: "string", description: "Full file content for create/modify" },
              reason: { type: "string" },
              risk_level: { type: "string", enum: ["low", "medium", "high"] }
            },
            required: ["file_path", "change_type", "reason", "risk_level"]
          }
        },
        validation_commands: {
          type: "array",
          items: { type: "string", enum: ["typecheck", "test", "build", "lint", "pnpm_typecheck", "pnpm_test"] }
        }
      },
      required: ["title", "summary", "changes"]
    },
    zodInputSchema: ProposeFileChangesInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "apply_patch",
    toolset: "filesystem.write",
    scopes: ["filesystem.write"],
    core: true,
    modelDescription:
      "Preview or apply a file change. Set previewOnly:true for Agent profile. Provide proposedContent (full file) or patch text.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        proposedContent: { type: "string" },
        patch: { type: "string" },
        previewOnly: { type: "boolean" },
        summary: { type: "string" }
      },
      required: ["path"]
    },
    zodInputSchema: ApplyPatchInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "write_file",
    toolset: "filesystem.write",
    scopes: ["filesystem.write"],
    modelDescription: "Overwrite a file with new content.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    },
    zodInputSchema: WriteFileInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "create_file",
    toolset: "filesystem.write",
    scopes: ["filesystem.write"],
    modelDescription: "Create a new file with optional initial content.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path"]
    },
    zodInputSchema: CreateFileInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "delete_file",
    toolset: "filesystem.write",
    scopes: ["filesystem.write"],
    modelDescription: "Delete a file from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    },
    zodInputSchema: DeleteFileInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "rename_file",
    toolset: "filesystem.write",
    scopes: ["filesystem.write"],
    modelDescription: "Rename or move a file within the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        fromPath: { type: "string" },
        toPath: { type: "string" }
      },
      required: ["fromPath", "toPath"]
    },
    zodInputSchema: RenameFileInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "run_terminal_command",
    toolset: "terminal",
    scopes: ["terminal.exec"],
    modelDescription: "Run a shell command in the workspace (subject to safety policy).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      required: ["command"]
    },
    zodInputSchema: RunTerminalCommandInputSchema,
    outputSchema: z.string(),
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasTerminalBridge,
    unavailableReason: "Terminal bridge not available"
  },
  {
    name: "run_tests",
    toolset: "tests",
    scopes: ["tests.exec"],
    modelDescription: "Run a predefined safe test command (e.g. pnpm test).",
    inputSchema: {
      type: "object",
      properties: {
        commandId: { type: "string", description: "e.g. pnpm_test" }
      }
    },
    zodInputSchema: RunTestsInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasTestCommands,
    unavailableReason: "No test commands configured"
  },
  {
    name: "run_workspace_command",
    toolset: "terminal",
    scopes: ["terminal.exec"],
    modelDescription: "Run a predefined safe command in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: { type: "string", description: "Command ID, e.g. pnpm_test, pnpm_typecheck, pytest, git_status" }
      },
      required: ["commandId"]
    },
    zodInputSchema: RunWorkspaceCommandInputSchema,
    outputSchema: z.string(),
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasTerminalBridge,
    unavailableReason: "Terminal bridge not available"
  },
  {
    name: "install_dependency",
    toolset: "terminal",
    scopes: ["terminal.exec"],
    modelDescription:
      "Install local project dependencies with an allowlisted package manager (never global). Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        packageManager: { type: "string", enum: ["npm", "pnpm", "yarn", "bun"] },
        packages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              version: { type: "string" }
            },
            required: ["name"]
          }
        },
        dependencyType: { type: "string", enum: ["production", "development"] },
        reason: { type: "string" }
      },
      required: ["packageManager", "packages", "reason"]
    },
    zodInputSchema: InstallDependencyInputSchema,
    outputSchema: z.string(),
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasTerminalBridge,
    unavailableReason: "Terminal bridge not available"
  },
  {
    name: "web_search",
    toolset: "terminal",
    scopes: ["terminal.exec"],
    modelDescription: "Execute a secure search query against public web documentation.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        purpose: { type: "string" },
        maxResults: { type: "integer", default: 5 },
        recencyDays: { type: "integer" },
        allowedDomains: { type: "array", items: { type: "string" } },
        safeSearch: { type: "string", enum: ["strict", "moderate", "off"], default: "strict" },
        language: { type: "string" }
      },
      required: ["query", "purpose"]
    },
    zodInputSchema: WebSearchInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasTerminalBridge,
    unavailableReason: "Terminal bridge not available"
  },
  {
    name: "web_fetch",
    toolset: "terminal",
    scopes: ["terminal.exec"],
    modelDescription: "Securely fetch and read the plain text content of a specified web URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        purpose: { type: "string" },
        maxBytes: { type: "integer" },
        timeoutMs: { type: "integer" }
      },
      required: ["url", "purpose"]
    },
    zodInputSchema: WebFetchInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: (ctx) => workspaceRequired(ctx) && ctx.hasTerminalBridge,
    unavailableReason: "Terminal bridge not available"
  },
  {
    name: "open_file",
    toolset: "filesystem.read",
    scopes: ["workspace.inspect"],
    modelDescription: "Open a file in the editor UI.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    },
    zodInputSchema: OpenFileInputSchema,
    outputSchema: JsonOutputSchema,
    checkAvailability: workspaceRequired,
    unavailableReason: "Workspace not open"
  },
  {
    name: "ask_user",
    toolset: "interaction",
    scopes: ["interaction.ask"],
    core: true,
    modelDescription:
      "Ask the user a single, structured clarifying question when a decision-critical fact is missing or ambiguous " +
      "(e.g. unclear target file, conflicting instructions, a risky irreversible action). Prefer single_choice/" +
      "multi_choice/boolean over free_text, and mark the safest option as recommended. Do not call this more than " +
      "once per turn, and never use it for information you can find yourself with read_file/grep/search_workspace.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The question shown to the user" },
        questionType: {
          type: "string",
          enum: [
            "single_choice",
            "multi_choice",
            "boolean",
            "free_text",
            "file_picker",
            "folder_picker",
            "confirm_risky_action"
          ]
        },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
              recommended: { type: "boolean" }
            },
            required: ["id", "label"]
          },
          description: "Required for single_choice/multi_choice/boolean"
        },
        allowFreeText: { type: "boolean", description: "Also allow a free-text answer alongside options" },
        context: { type: "string", description: "Short explanation of why this is being asked" },
        riskLevel: { type: "string", enum: ["low", "medium", "high"] }
      },
      required: ["prompt", "questionType"]
    },
    zodInputSchema: AskUserInputSchema,
    outputSchema: JsonOutputSchema
  }
];

export const BRIDGE_TOOL_METADATA: ToolMetadataEntry[] = [
  {
    name: "tool_search",
    toolset: "meta",
    scopes: ["workspace.inspect"],
    modelDescription: "Search the deferred tool catalog by keyword. Returns matching tool names and short descriptions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for tool name or purpose" }
      },
      required: ["query"]
    },
    zodInputSchema: ToolSearchBridgeInputSchema,
    outputSchema: JsonOutputSchema
  },
  {
    name: "tool_describe",
    toolset: "meta",
    scopes: ["workspace.inspect"],
    modelDescription: "Get the full schema and description for a deferred tool by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tool name to describe" }
      },
      required: ["name"]
    },
    zodInputSchema: ToolDescribeBridgeInputSchema,
    outputSchema: JsonOutputSchema
  },
  {
    name: "tool_call",
    toolset: "meta",
    scopes: ["workspace.inspect"],
    modelDescription: "Invoke a deferred tool by name with JSON input. Side-effect tools still require approval.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Target tool name" },
        input: { type: "object", description: "Tool input payload" }
      },
      required: ["name", "input"]
    },
    zodInputSchema: ToolCallBridgeInputSchema,
    outputSchema: JsonOutputSchema
  }
];

export const BRIDGE_TOOL_NAMES: ToolName[] = ["tool_search", "tool_describe", "tool_call"];

export const META_TOOL_NAMES = new Set<ToolName>(BRIDGE_TOOL_NAMES);

export function isMetaToolName(name: ToolName): boolean {
  return META_TOOL_NAMES.has(name) || name === "tool_search" || name === "tool_describe" || name === "tool_call";
}

export function getBuiltinMetadata(name: ToolName): ToolMetadataEntry | undefined {
  return BUILTIN_TOOL_METADATA.find((entry) => entry.name === name);
}

export function metadataToToolDefinition(entry: ToolMetadataEntry) {
  return {
    name: entry.name,
    toolset: entry.toolset,
    scopes: entry.scopes,
    modelDescription: entry.modelDescription,
    core: entry.core,
    checkAvailability: entry.checkAvailability,
    unavailableReason: entry.unavailableReason,
    inputSchema: entry.zodInputSchema,
    outputSchema: entry.outputSchema
  };
}

export function createMcpToolMetadata(
  toolName: ToolName,
  description: string,
  inputSchema: Record<string, unknown>
): ToolMetadataEntry {
  return {
    name: toolName,
    toolset: "mcp",
    scopes: ["workspace.inspect"],
    modelDescription: description,
    inputSchema,
    zodInputSchema: z.record(z.unknown()),
    outputSchema: JsonOutputSchema
  };
}
