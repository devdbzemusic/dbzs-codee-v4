import { z } from "zod";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import type { ToolsetId } from "@/runtime/tool/toolsets";

export interface ToolBridgeContext {
  deferrableNames: ToolName[];
  profile: AgentToolProfile;
  availabilityContext: ToolAvailabilityContext;
  skillRunId?: string;
  skillAllowedNames?: ToolName[];
}

export const ToolNameSchema = z.union([
  z.enum([
    "read_file",
    "write_file",
    "apply_patch",
    "propose_file_changes",
    "list_files",
    "search_workspace",
    "grep",
    "open_file",
    "create_file",
    "delete_file",
    "rename_file",
    "run_terminal_command",
    "get_git_diff",
    "run_tests",
    "run_workspace_command",
    "install_dependency",
    "web_search",
    "web_fetch",
    "tool_search",
    "tool_describe",
    "tool_call",
    "ask_user",
    "write_skill_artifact"
  ]),
  z.string().regex(/^mcp_[a-z0-9_]+$/)
]);

export type ToolName = z.infer<typeof ToolNameSchema>;

export type ToolScope =
  | "filesystem.read"
  | "filesystem.write"
  | "workspace.inspect"
  | "workspace.search"
  | "terminal.exec"
  | "git.read"
  | "tests.exec"
  | "interaction.ask"
  | "skill.artifact";

export const BaseToolRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  requestId: z.string().min(1),
  actorId: z.string().min(1),
  timeoutMs: z.number().int().min(100).max(120000).optional()
});

export const ReadFileInputSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional()
});

export const WriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

export const ApplyPatchInputSchema = z
  .object({
    path: z.string().min(1),
    proposedContent: z.string().min(1).optional(),
    patch: z.string().min(1).optional(),
    targetPath: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    previewOnly: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (value.proposedContent || value.patch) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "proposedContent is required"
    });
  })
  .transform((value) => ({
    ...value,
    proposedContent: value.proposedContent ?? value.patch ?? ""
  }));

export const ProposeFileChangesInputSchema = z.object({
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

export const ListFilesInputSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().default(false)
});

export const SearchWorkspaceInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(100)
});

export const GrepInputSchema = z.object({
  pattern: z.string().min(1),
  include: z.string().optional(),
  maxResults: z.number().int().min(1).max(500).default(100)
});

export const OpenFileInputSchema = z.object({
  path: z.string().min(1)
});

export const CreateFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string().default("")
});

export const DeleteFileInputSchema = z.object({
  path: z.string().min(1)
});

export const RenameFileInputSchema = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1)
});

export const RunTerminalCommandInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(120000).optional()
});

export const GetGitDiffInputSchema = z.object({
  filePath: z.string().optional()
});

export const RunTestsInputSchema = z.object({
  commandId: z.string().default("pnpm_test")
});

export const RunWorkspaceCommandInputSchema = z.object({
  commandId: z.string().min(1)
});

export const InstallDependencyInputSchema = z.object({
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]),
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        version: z.string().min(1).optional()
      })
    )
    .min(1)
    .max(16),
  dependencyType: z.enum(["production", "development"]).default("development"),
  workspaceRoot: z.string().min(1).optional(),
  reason: z.string().min(1).max(500)
});

export const WebSearchInputSchema = z.object({
  query: z.string().min(1),
  purpose: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).default(5),
  recencyDays: z.number().int().min(1).optional(),
  allowedDomains: z.array(z.string()).optional(),
  safeSearch: z.enum(["strict", "moderate", "off"]).default("strict"),
  language: z.string().optional()
});

export const WebFetchInputSchema = z.object({
  url: z.string().url(),
  purpose: z.string().min(1),
  maxBytes: z.number().int().min(100).max(10 * 1024 * 1024).optional(),
  timeoutMs: z.number().int().min(100).max(120000).optional()
});

export const AskUserOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().max(500).optional(),
  recommended: z.boolean().optional()
});

export const AskUserInputSchema = z
  .object({
    prompt: z.string().min(1).max(500),
    questionType: z.enum([
      "single_choice",
      "multi_choice",
      "boolean",
      "free_text",
      "file_picker",
      "folder_picker",
      "confirm_risky_action"
    ]),
    options: z.array(AskUserOptionSchema).max(8).optional(),
    allowFreeText: z.boolean().default(false),
    context: z.string().max(500).optional(),
    riskLevel: z.enum(["low", "medium", "high"]).default("low")
  })
  .superRefine((value, ctx) => {
    const requiresOptions = ["single_choice", "multi_choice", "boolean"].includes(value.questionType);
    if (requiresOptions && (!value.options || value.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "options are required for single_choice/multi_choice/boolean questions"
      });
    }
  });

export const ToolSearchBridgeInputSchema = z.object({
  query: z.string().min(1)
});

export const ToolDescribeBridgeInputSchema = z.object({
  name: z.string().min(1)
});

export const ToolCallBridgeInputSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.unknown()).default({})
});

export const WriteSkillArtifactInputSchema = z.object({
  skillRunId: z.string().min(6).max(128),
  relativePath: z.string().min(1).max(240),
  content: z.string().max(256 * 1024),
  mediaType: z.enum(["text/markdown", "application/json"])
}).strict();

export const ToolInputSchemaByName = {
  read_file: ReadFileInputSchema,
  write_file: WriteFileInputSchema,
  apply_patch: ApplyPatchInputSchema,
  propose_file_changes: ProposeFileChangesInputSchema,
  list_files: ListFilesInputSchema,
  search_workspace: SearchWorkspaceInputSchema,
  grep: GrepInputSchema,
  open_file: OpenFileInputSchema,
  create_file: CreateFileInputSchema,
  delete_file: DeleteFileInputSchema,
  rename_file: RenameFileInputSchema,
  run_terminal_command: RunTerminalCommandInputSchema,
  get_git_diff: GetGitDiffInputSchema,
  run_tests: RunTestsInputSchema,
  run_workspace_command: RunWorkspaceCommandInputSchema,
  install_dependency: InstallDependencyInputSchema,
  web_search: WebSearchInputSchema,
  web_fetch: WebFetchInputSchema,
  tool_search: ToolSearchBridgeInputSchema,
  tool_describe: ToolDescribeBridgeInputSchema,
  tool_call: ToolCallBridgeInputSchema,
  ask_user: AskUserInputSchema,
  write_skill_artifact: WriteSkillArtifactInputSchema
} as const;

export interface ToolRequest<TInput = unknown> {
  name: ToolName;
  workspaceRoot: string;
  requestId: string;
  actorId: string;
  timeoutMs?: number;
  input: TInput;
  bridgeContext?: ToolBridgeContext;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ToolResult<TOutput = unknown> {
  requestId: string;
  toolName: ToolName;
  status: "ok" | "error" | "cancelled" | "timeout";
  startedAt: string;
  finishedAt: string;
  output?: TOutput;
  error?: ToolError;
}

export interface ToolAuditEntry {
  requestId: string;
  toolName: ToolName;
  actorId: string;
  workspaceRoot: string;
  inputSummary: string;
  status: ToolResult["status"];
  startedAt: string;
  finishedAt: string;
  errorCode?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: ToolName;
  toolset: ToolsetId;
  scopes: ToolScope[];
  modelDescription: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  core?: boolean;
  checkAvailability?: (ctx: ToolAvailabilityContext) => boolean;
  unavailableReason?: string;
}
