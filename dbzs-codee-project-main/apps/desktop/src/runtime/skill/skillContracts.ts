/*
 * DBZS – Division By Zeros
 * Datei: skillContracts.ts
 * Bereich: Desktop / Skill Runtime
 *
 * Zweck:
 *   Versionierte, serialisierbare Verträge der Skill Runtime V1.
 *
 * Warum:
 *   Loader, Registry, Resolver, Runtime, IPC und UI benötigen eine gemeinsame
 *   Sprache, ohne ausführbaren Code aus Skill-Paketen zu übernehmen.
 *
 * Input:
 *   Validierte Skill-Manifeste, Workspace-Kontext und Skill-Run-Daten.
 *
 * Output:
 *   Typsichere Pakete, Entscheidungen, Capsules, Runs und Artefaktverweise.
 */
import type { ModelTargetAgent } from "@dbzs/shared";
export type SkillToolName =
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "propose_file_changes"
  | "list_files"
  | "search_workspace"
  | "grep"
  | "open_file"
  | "create_file"
  | "delete_file"
  | "rename_file"
  | "run_terminal_command"
  | "get_git_diff"
  | "run_tests"
  | "run_workspace_command"
  | "install_dependency"
  | "web_search"
  | "web_fetch"
  | "tool_search"
  | "tool_describe"
  | "tool_call"
  | "ask_user"
  | "write_skill_artifact"
  | `mcp_${string}`;

export type SkillMode = "advisory" | "planning" | "review" | "execution";
export type SkillRiskLevel = "low" | "medium" | "high" | "critical";
export type SkillPackageSource =
  | { type: "bundled"; path: string }
  | { type: "user"; path: string }
  | { type: "workspace"; path: string };

export interface SkillPrecondition {
  id: string;
  description: string;
  required: boolean;
  evaluator:
    | "workspace_file_exists"
    | "workspace_file_missing"
    | "has_product_idea"
    | "has_feature_request"
    | "has_active_workspace"
    | "manual_confirmation";
  value?: string;
}

export interface SkillSignalDefinition {
  id: string;
  description: string;
  required?: boolean;
}

export interface CodeeSkillManifestV1 {
  schemaVersion: "1.0";
  id: string;
  kind: "skill";
  name: string;
  version: string;
  description: string;
  mode: SkillMode;
  targetAgents: ModelTargetAgent[];
  activation: {
    intents: string[];
    keywords?: string[];
    explicitOnly?: boolean;
    autoSuggest?: boolean;
  };
  preconditions: SkillPrecondition[];
  effects: string[];
  domains: string[];
  cost: "low" | "medium" | "high";
  latency: "fast" | "normal" | "slow";
  riskLevel: SkillRiskLevel;
  sideEffects: string[];
  idempotent: boolean;
  permissions: {
    allowedTools: SkillToolName[];
    requiredTools?: SkillToolName[];
    mayReadFiles: boolean;
    mayWriteFiles: boolean;
    mayRunCommands: boolean;
    mayInstallDependencies: boolean;
    mayUseNetwork: boolean;
  };
  compatibility: {
    requires: string[];
    conflictsWith: string[];
    composesWith: string[];
    enables: string[];
  };
  successSignals: SkillSignalDefinition[];
  failureSignals: SkillSignalDefinition[];
  observability: {
    logs: string[];
    metrics: string[];
  };
  metadata?: {
    createdAt?: string;
    tags?: string[];
    examples?: string[];
  };
}

export interface CodeeSkillPackage {
  manifest: CodeeSkillManifestV1;
  instructions: string;
  readme?: string;
  source: SkillPackageSource;
}

export type SkillLoadErrorCode =
  | "manifest_missing"
  | "instructions_missing"
  | "manifest_invalid"
  | "schema_unsupported"
  | "duplicate_skill_id"
  | "unsafe_path"
  | "package_too_large";

export interface SkillLoadFailure {
  code: SkillLoadErrorCode;
  source: SkillPackageSource;
  message: string;
  skillId?: string;
}

export interface SkillRegistryEntry {
  skill: CodeeSkillPackage;
  enabled: boolean;
  trusted: boolean;
  installedAt: string;
  lastValidatedAt: string;
  validationWarnings: string[];
  shadowedSources: SkillPackageSource[];
}

export interface SkillRegistrySnapshot {
  entries: SkillRegistryEntry[];
  failures: SkillLoadFailure[];
  generation: number;
}

export interface SkillResolutionContext {
  userMessage: string;
  executionIntent: string;
  workspaceRoot?: string;
  activeFile?: string;
  activeTaskType?: string;
  activeAgent?: ModelTargetAgent;
  enabledSkillIds: string[];
}

export interface SkillResolutionDecision {
  selectedSkillIds: string[];
  suggestedSkillIds: string[];
  rejected: Array<{ skillId: string; reason: string }>;
  conflicts: Array<{ leftSkillId: string; rightSkillId: string }>;
}

export interface ActiveSkillCapsule {
  skillId: string;
  version: string;
  mode: SkillMode;
  targetAgent: ModelTargetAgent;
  goal: string;
  coreRules: string[];
  requiredOutputs: string[];
  allowedTools: SkillToolName[];
  requiredTools: SkillToolName[];
  successSignals: SkillSignalDefinition[];
  failureSignals: SkillSignalDefinition[];
  riskLevel: SkillRiskLevel;
}

export interface SkillPreconditionResult {
  preconditionId: string;
  passed: boolean;
  message: string;
  checkedAt: string;
}

export interface SkillArtifactReference {
  relativePath: string;
  mediaType: "text/markdown" | "application/json";
  bytes: number;
  createdAt: string;
}

export interface SkillRunValidation {
  preconditionsPassed: boolean;
  requiredArtifactsPresent: boolean;
  successSignalsMet: string[];
  successSignalsMissing: string[];
  failureSignalsDetected: string[];
  outcome: "completed" | "completed_with_warnings" | "blocked" | "failed";
}

export type SkillRunStatus =
  | "resolving"
  | "checking_preconditions"
  | "awaiting_user"
  | "running"
  | "validating"
  | "completed"
  | "completed_with_warnings"
  | "blocked"
  | "failed"
  | "cancelled";

export interface SkillRunEvent {
  type: string;
  timestamp: string;
  detail?: string;
}

export interface SkillRun {
  id: string;
  skillId: string;
  skillVersion: string;
  workspaceId?: string;
  runId: string;
  goal?: string;
  status: SkillRunStatus;
  selectedAgent: ModelTargetAgent;
  activatedAt: string;
  finishedAt?: string;
  preconditions: SkillPreconditionResult[];
  artifacts: SkillArtifactReference[];
  validation?: SkillRunValidation;
  events: SkillRunEvent[];
  metrics: Record<string, number>;
  artifactWriteApproved: boolean;
}

export interface SkillArtifactWriteRequest {
  skillRunId: string;
  relativePath: string;
  content: string;
  mediaType: "text/markdown" | "application/json";
}

export interface ActiveSkillRuntimeContext {
  run: SkillRun;
  capsules: ActiveSkillCapsule[];
  effectiveAllowedTools: SkillToolName[];
  requiredTools: SkillToolName[];
}

export interface SkillPackageReloadRequest {
  workspaceRoot?: string;
  bundledPackages: CodeeSkillPackage[];
}

export interface SkillPackageReloadResult {
  packages: CodeeSkillPackage[];
  failures: SkillLoadFailure[];
}
