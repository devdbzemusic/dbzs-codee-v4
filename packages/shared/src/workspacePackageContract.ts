/**
 * Workspace package-manager contract — source of truth for scripts & PM choice.
 */

export type WorkspacePackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "unknown"
  | "ambiguous";

export type WorkspacePackageSource =
  | "package_json"
  | "lockfile"
  | "user_choice"
  | "none";

export interface WorkspacePackageContract {
  packageManager: WorkspacePackageManager;
  source: WorkspacePackageSource;
  availableExecutables: string[];
  scripts: Record<string, string>;
  lockfiles: string[];
  packageManagerField?: string | null;
}

export interface AllowedCommandSuggestion {
  id: string;
  label: string;
  command: string;
  args: string[];
}

const LOCKFILE_TO_PM: Record<string, Exclude<WorkspacePackageManager, "unknown" | "ambiguous">> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm"
};

const FIELD_TO_PM: Record<string, Exclude<WorkspacePackageManager, "unknown" | "ambiguous">> = {
  npm: "npm",
  pnpm: "pnpm",
  yarn: "yarn",
  bun: "bun"
};

function normalizePackageManagerField(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  // packageManager: "pnpm@9.0.0" → pnpm
  const name = value.trim().split("@")[0]?.toLowerCase() ?? "";
  return name || null;
}

export function detectWorkspacePackageContract(input: {
  packageJson?: { packageManager?: unknown; scripts?: Record<string, unknown> } | null;
  lockfileNames: string[];
  availableExecutables?: string[];
  userChoice?: Exclude<WorkspacePackageManager, "unknown" | "ambiguous"> | null;
}): WorkspacePackageContract {
  const lockfiles = [...new Set(input.lockfileNames.filter(Boolean))].sort();
  const scripts: Record<string, string> = {};
  const rawScripts = input.packageJson?.scripts ?? {};
  for (const [key, value] of Object.entries(rawScripts)) {
    if (typeof value === "string" && value.trim()) {
      scripts[key] = value;
    }
  }

  const availableExecutables = [...new Set(input.availableExecutables ?? [])].sort();

  if (input.userChoice && FIELD_TO_PM[input.userChoice]) {
    return {
      packageManager: input.userChoice,
      source: "user_choice",
      availableExecutables,
      scripts,
      lockfiles,
      packageManagerField: normalizePackageManagerField(input.packageJson?.packageManager)
    };
  }

  const field = normalizePackageManagerField(input.packageJson?.packageManager);
  if (field && FIELD_TO_PM[field]) {
    return {
      packageManager: FIELD_TO_PM[field],
      source: "package_json",
      availableExecutables,
      scripts,
      lockfiles,
      packageManagerField: field
    };
  }

  const detectedFromLocks = new Set<Exclude<WorkspacePackageManager, "unknown" | "ambiguous">>();
  for (const name of lockfiles) {
    const pm = LOCKFILE_TO_PM[name];
    if (pm) detectedFromLocks.add(pm);
  }

  if (detectedFromLocks.size === 1) {
    const only = [...detectedFromLocks][0];
    return {
      packageManager: only,
      source: "lockfile",
      availableExecutables,
      scripts,
      lockfiles,
      packageManagerField: field
    };
  }

  if (detectedFromLocks.size > 1) {
    return {
      packageManager: "ambiguous",
      source: "lockfile",
      availableExecutables,
      scripts,
      lockfiles,
      packageManagerField: field
    };
  }

  return {
    packageManager: "unknown",
    source: input.packageJson ? "package_json" : "none",
    availableExecutables,
    scripts,
    lockfiles,
    packageManagerField: field
  };
}

const COMMON_SCRIPT_KEYS = ["test", "typecheck", "lint", "build", "check"] as const;

/**
 * Build deduplicated safe-command suggestions from an resolved package contract.
 * Never invents pnpm when the contract is npm/bun/ambiguous/unknown.
 */
export function buildPackageManagerCommandSuggestions(
  contract: WorkspacePackageContract
): AllowedCommandSuggestion[] {
  const suggestions: AllowedCommandSuggestion[] = [];
  const seen = new Set<string>();

  const push = (entry: AllowedCommandSuggestion) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    suggestions.push(entry);
  };

  push({ id: "git_status", label: "git status", command: "git", args: ["status"] });
  push({ id: "git_diff", label: "git diff", command: "git", args: ["diff"] });

  const pm =
    contract.packageManager === "npm" ||
    contract.packageManager === "pnpm" ||
    contract.packageManager === "yarn" ||
    contract.packageManager === "bun"
      ? contract.packageManager
      : null;

  if (pm) {
    for (const script of COMMON_SCRIPT_KEYS) {
      if (!(script in contract.scripts)) continue;
      if (pm === "npm") {
        if (script === "test") {
          push({ id: "npm_test", label: "npm test", command: "npm", args: ["test"] });
        } else {
          push({
            id: `npm_run_${script}`,
            label: `npm run ${script}`,
            command: "npm",
            args: ["run", script]
          });
        }
      } else if (pm === "pnpm") {
        push({
          id: `pnpm_${script}`,
          label: script === "test" ? "pnpm test" : `pnpm ${script}`,
          command: "pnpm",
          args: script === "test" || script === "lint" || script === "build" || script === "typecheck"
            ? [script]
            : ["run", script]
        });
      } else if (pm === "yarn") {
        push({
          id: `yarn_${script}`,
          label: `yarn ${script}`,
          command: "yarn",
          args: [script]
        });
      } else {
        push({
          id: `bun_run_${script}`,
          label: `bun run ${script}`,
          command: "bun",
          args: ["run", script]
        });
      }
    }
  }

  // Always offer pytest helpers when not package-script focused (harmless allowlist).
  push({ id: "pytest", label: "pytest", command: "pytest", args: [] });
  push({ id: "uv_run_pytest", label: "uv run pytest", command: "uv", args: ["run", "pytest"] });

  return suggestions;
}

export function buildInstallDependencyArgs(input: {
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  packages: Array<{ name: string; version?: string }>;
  dependencyType: "production" | "development";
}): { command: string; args: string[] } {
  const specs = input.packages.map((pkg) =>
    pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name
  );
  switch (input.packageManager) {
    case "npm":
      return {
        command: "npm",
        args: [
          "install",
          ...(input.dependencyType === "development" ? ["--save-dev"] : ["--save"]),
          ...specs
        ]
      };
    case "pnpm":
      return {
        command: "pnpm",
        args: ["add", ...(input.dependencyType === "development" ? ["-D"] : []), ...specs]
      };
    case "yarn":
      return {
        command: "yarn",
        args: ["add", ...(input.dependencyType === "development" ? ["--dev"] : []), ...specs]
      };
    case "bun":
      return {
        command: "bun",
        args: ["add", ...(input.dependencyType === "development" ? ["-d"] : []), ...specs]
      };
    default: {
      const _exhaustive: never = input.packageManager;
      return _exhaustive;
    }
  }
}

export const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export function assertValidPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name) || /[|&;<>()$`"'\s]/.test(name)) {
    throw new Error(`[COMMAND_BLOCKED] Invalid package name: ${name}`);
  }
}
