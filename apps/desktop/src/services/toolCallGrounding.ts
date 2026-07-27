import type { ToolName } from "@/runtime/tool/toolContracts";

export interface ToolCallGroundingResult {
  toolName: string;
  groundedInGoal: boolean;
  groundedInWorkspace: boolean;
  pathExists?: boolean;
  rejectionReason?: string;
}

const DEMO_PATH_PATTERNS = [
  /exampleFunction\.js/i,
  /examplePath/i,
  /\/foo\b/i,
  /\/bar\b/i,
  /\bfeatureName\b/i,
  /\bnewFeature\b/i,
  /expected actions/i,
  /src\/example\.ts/i,
  /relative\/path\.ts/i
];

const DEMO_GREP_PATTERNS = [
  /\^test\.\*featureName\$/i,
  /\^test\.\*newFeature\$/i,
  /it should perform the expected actions/i,
  /\bfeatureName\b/i,
  /\bnewFeature\b/i
];

const IMPLEMENT_SEED_PATHS = [
  "package.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "electron",
  "src-tauri",
  "AGENTS.md",
  "package-lock.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock"
];

function extractPathCandidates(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of ["path", "filePath", "fromPath", "toPath", "targetPath"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
  }
  if (typeof input.pattern === "string") {
    paths.push(input.pattern);
  }
  if (typeof input.query === "string") {
    paths.push(input.query);
  }
  return paths;
}

export function isDemoPlaceholderValue(value: string): boolean {
  return (
    DEMO_PATH_PATTERNS.some((p) => p.test(value)) ||
    DEMO_GREP_PATTERNS.some((p) => p.test(value))
  );
}

export function groundToolCall(input: {
  toolName: ToolName | string;
  toolInput: Record<string, unknown>;
  goalText: string;
  workspaceRoot?: string | null;
  knownExistingPaths?: Set<string> | string[];
}): ToolCallGroundingResult {
  const toolName = String(input.toolName);
  const candidates = extractPathCandidates(input.toolInput);
  const goal = (input.goalText ?? "").toLowerCase();

  for (const candidate of candidates) {
    if (isDemoPlaceholderValue(candidate)) {
      return {
        toolName,
        groundedInGoal: false,
        groundedInWorkspace: false,
        rejectionReason: "demo_placeholder"
      };
    }
  }

  const known = input.knownExistingPaths
    ? input.knownExistingPaths instanceof Set
      ? input.knownExistingPaths
      : new Set(input.knownExistingPaths.map((p) => p.replace(/\\/g, "/").toLowerCase()))
    : null;

  let pathExists: boolean | undefined;
  if (known && candidates.length > 0) {
    pathExists = candidates.every((candidate) => {
      const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
      if (known.has(normalized) || known.has(`./${normalized}`)) return true;
      // Allow reading seed paths even if inventory not yet loaded.
      if (IMPLEMENT_SEED_PATHS.some((seed) => normalized === seed.toLowerCase() || normalized.endsWith(`/${seed.toLowerCase()}`))) {
        return true;
      }
      return false;
    });
    if (pathExists === false && ["read_file", "open_file", "apply_patch", "write_file"].includes(toolName)) {
      return {
        toolName,
        groundedInGoal: false,
        groundedInWorkspace: false,
        pathExists: false,
        rejectionReason: "path_not_in_workspace"
      };
    }
  }

  const goalGrounded =
    /electron|package\.json|vite|install|implement|baue|integrier|fix|refactor|test|build|git/i.test(goal) ||
    candidates.some((c) =>
      IMPLEMENT_SEED_PATHS.some((seed) => c.toLowerCase().includes(seed.toLowerCase()))
    ) ||
    ["list_files", "ask_user", "git_status", "get_git_diff", "run_tests", "install_dependency"].includes(toolName);

  if (!goalGrounded && candidates.some((c) => /featureName|newFeature|example/i.test(c))) {
    return {
      toolName,
      groundedInGoal: false,
      groundedInWorkspace: Boolean(pathExists),
      pathExists,
      rejectionReason: "unrelated_to_goal"
    };
  }

  if (
    !goalGrounded &&
    typeof input.toolInput.pattern === "string" &&
    DEMO_GREP_PATTERNS.some((p) => p.test(String(input.toolInput.pattern)))
  ) {
    return {
      toolName,
      groundedInGoal: false,
      groundedInWorkspace: false,
      rejectionReason: "demo_placeholder"
    };
  }

  return {
    toolName,
    groundedInGoal: true,
    groundedInWorkspace: pathExists !== false,
    pathExists
  };
}

export const TOOL_CALL_REJECTED_UNRELATED = "tool_call_rejected_unrelated";

export const TOOL_GROUNDING_REPAIR_HINT = [
  "Der letzte Tool Call wurde abgelehnt (unrelated / Demo-Platzhalter / Pfad existiert nicht).",
  "Bleibe beim aktuellen Goal Capsule Ziel.",
  "Nutze workspace-geerdete Tools, z. B.:",
  "- list_files",
  "- read_file package.json",
  "- read_file vite.config.ts",
  "- get_git_diff / git status",
  "Keine exampleFunction.js / featureName / newFeature Aufrufe."
].join("\n");
