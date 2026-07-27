import { parseDocument } from "yaml";
import { z } from "zod";
import type {
  CodeeSkillManifestV1,
  CodeeSkillPackage,
  SkillLoadErrorCode,
  SkillPackageSource
} from "./skillContracts";

export const SKILL_PACKAGE_LIMITS = {
  manifestBytes: 64 * 1024,
  instructionsBytes: 256 * 1024,
  readmeBytes: 256 * 1024
} as const;

const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const SkillToolNameSchema = z.union([
  z.enum([
    "read_file", "write_file", "apply_patch", "propose_file_changes", "list_files",
    "search_workspace", "grep", "open_file", "create_file", "delete_file", "rename_file",
    "run_terminal_command", "get_git_diff", "run_tests", "run_workspace_command",
    "install_dependency", "web_search", "web_fetch", "tool_search", "tool_describe",
    "tool_call", "ask_user", "write_skill_artifact"
  ]),
  z.string().regex(/^mcp_[a-z0-9_]+$/)
]);
const SignalSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  required: z.boolean().optional()
}).strict();
const PreconditionSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  required: z.boolean(),
  evaluator: z.enum([
    "workspace_file_exists",
    "workspace_file_missing",
    "has_product_idea",
    "has_feature_request",
    "has_active_workspace",
    "manual_confirmation"
  ]),
  value: z.string().max(500).optional()
}).strict();

export const CodeeSkillManifestV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  id: IdSchema,
  kind: z.literal("skill"),
  name: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  description: z.string().min(1).max(1000),
  mode: z.enum(["advisory", "planning", "review", "execution"]),
  targetAgents: z.array(z.enum(["runtime_chat", "planner", "coder", "reviewer", "debugger"])).min(1),
  activation: z.object({
    intents: z.array(z.string().min(1).max(120)),
    keywords: z.array(z.string().min(1).max(120)).optional(),
    explicitOnly: z.boolean().optional(),
    autoSuggest: z.boolean().optional()
  }).strict(),
  preconditions: z.array(PreconditionSchema),
  effects: z.array(z.string().min(1).max(200)),
  domains: z.array(z.string().min(1).max(120)),
  cost: z.enum(["low", "medium", "high"]),
  latency: z.enum(["fast", "normal", "slow"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  sideEffects: z.array(z.string().min(1).max(300)),
  idempotent: z.boolean(),
  permissions: z.object({
    allowedTools: z.array(SkillToolNameSchema),
    requiredTools: z.array(SkillToolNameSchema).optional(),
    mayReadFiles: z.boolean(),
    mayWriteFiles: z.boolean(),
    mayRunCommands: z.boolean(),
    mayInstallDependencies: z.boolean(),
    mayUseNetwork: z.boolean()
  }).strict(),
  compatibility: z.object({
    requires: z.array(IdSchema),
    conflictsWith: z.array(IdSchema),
    composesWith: z.array(IdSchema),
    enables: z.array(IdSchema)
  }).strict(),
  successSignals: z.array(SignalSchema),
  failureSignals: z.array(SignalSchema),
  observability: z.object({
    logs: z.array(z.string().max(500)),
    metrics: z.array(z.string().max(120))
  }).strict(),
  metadata: z.object({
    createdAt: z.string().max(80).optional(),
    tags: z.array(z.string().max(80)).optional(),
    examples: z.array(z.string().max(500)).optional()
  }).strict().optional()
}).strict();

export class SkillPackageError extends Error {
  constructor(
    public readonly code: SkillLoadErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SkillPackageError";
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseSkillManifest(raw: string): CodeeSkillManifestV1 {
  if (byteLength(raw) > SKILL_PACKAGE_LIMITS.manifestBytes) {
    throw new SkillPackageError("package_too_large", "manifest.yaml exceeds 64 KB.");
  }

  const document = parseDocument(raw, {
    uniqueKeys: true,
    prettyErrors: true
  });
  if (document.errors.length > 0) {
    throw new SkillPackageError("manifest_invalid", document.errors[0]?.message ?? "Invalid YAML.");
  }
  if (document.contents && document.toString().match(/(^|[\s:[{,])[*&][A-Za-z0-9_-]+/m)) {
    throw new SkillPackageError("manifest_invalid", "YAML aliases and anchors are not allowed.");
  }

  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  if (value && typeof value === "object" && "schemaVersion" in value) {
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (version !== "1.0") {
      throw new SkillPackageError("schema_unsupported", `Unsupported skill schema: ${String(version)}`);
    }
  }

  const parsed = CodeeSkillManifestV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new SkillPackageError(
      "manifest_invalid",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    );
  }
  return parsed.data as unknown as CodeeSkillManifestV1;
}

export function createSkillPackage(input: {
  manifestRaw: string;
  instructions: string;
  readme?: string;
  source: SkillPackageSource;
}): CodeeSkillPackage {
  if (byteLength(input.instructions) > SKILL_PACKAGE_LIMITS.instructionsBytes) {
    throw new SkillPackageError("package_too_large", "SKILL.md exceeds 256 KB.");
  }
  if (byteLength(input.readme ?? "") > SKILL_PACKAGE_LIMITS.readmeBytes) {
    throw new SkillPackageError("package_too_large", "README.md exceeds 256 KB.");
  }
  if (!input.instructions.trim()) {
    throw new SkillPackageError("instructions_missing", "SKILL.md is empty.");
  }
  return {
    manifest: parseSkillManifest(input.manifestRaw),
    instructions: input.instructions,
    readme: input.readme,
    source: input.source
  };
}
