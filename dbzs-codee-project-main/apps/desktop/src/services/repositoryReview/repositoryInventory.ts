import type { RepositoryInventory, RepositoryReviewRequest, RepositoryReviewScope } from "@dbzs/shared";
import { isExcludedRelativePath } from "./reviewPathUtils";
import type { ReviewWorkspaceFileEntry, ReviewWorkspaceIO } from "./types";

const LARGE_FILE_BYTES = 200_000;
const LARGE_FILE_LINES = 1500;
const MAX_INVENTORY_FILES = 4000;

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : "";
}

function languageForExt(ext: string): string | null {
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "cs":
      return "csharp";
    case "css":
    case "scss":
      return "css";
    case "md":
      return "markdown";
    case "json":
      return "json";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return null;
  }
}

function detectPackageManager(files: string[]): string | undefined {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("package-lock.json") || files.includes("package.json")) return "npm";
  if (files.includes("requirements.txt") || files.includes("pyproject.toml")) return "pip";
  return undefined;
}

function detectFrameworkHints(files: string[], packageJsonRaw: string | null): string[] {
  const hints = new Set<string>();
  const joined = files.join("\n").toLowerCase();
  const pkg = (packageJsonRaw ?? "").toLowerCase();
  if (pkg.includes("react") || files.some((f) => f.endsWith(".tsx"))) hints.add("react");
  if (pkg.includes("vite") || files.includes("vite.config.ts") || files.includes("vite.config.js")) {
    hints.add("vite");
  }
  if (pkg.includes("next") || files.includes("next.config.js") || files.includes("next.config.mjs")) {
    hints.add("next");
  }
  if (pkg.includes("electron") || joined.includes("electron/")) hints.add("electron");
  if (pkg.includes("fastapi") || files.some((f) => f.includes("fastapi"))) hints.add("fastapi");
  if (files.includes("Cargo.toml")) hints.add("rust");
  if (files.includes("go.mod")) hints.add("go");
  return [...hints];
}

function scriptCommands(
  scripts: Record<string, string>,
  names: string[]
): string[] {
  return names
    .filter((name) => typeof scripts[name] === "string" && scripts[name].trim())
    .map((name) => `npm run ${name}`);
}

function parsePackageScripts(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function scopeFilter(
  scope: RepositoryReviewScope,
  files: ReviewWorkspaceFileEntry[],
  request: RepositoryReviewRequest,
  changedFiles: string[]
): ReviewWorkspaceFileEntry[] {
  switch (scope) {
    case "active_file":
    case "selected_paths": {
      const selected = new Set(
        (request.selectedPaths ?? []).map((p) => p.replace(/\\/g, "/"))
      );
      if (selected.size === 0) return files.slice(0, 40);
      return files.filter((f) => selected.has(f.relativePath));
    }
    case "uncommitted_changes": {
      const changed = new Set(changedFiles.map((p) => p.replace(/\\/g, "/")));
      if (changed.size === 0) return files.slice(0, 40);
      return files.filter((f) => changed.has(f.relativePath));
    }
    case "last_commit": {
      const changed = new Set(changedFiles.map((p) => p.replace(/\\/g, "/")));
      if (changed.size === 0) return files.slice(0, 60);
      return files.filter((f) => changed.has(f.relativePath));
    }
    case "full_repository":
      return files;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

function isInsideWorkspace(relativePath: string, workspaceRoot: string): boolean {
  const rel = relativePath.replace(/\\/g, "/");
  if (!rel || rel.includes("..")) return false;
  if (/^[a-z]:\//i.test(rel) || rel.startsWith("/")) {
    const root = workspaceRoot.replace(/\\/g, "/").toLowerCase();
    return rel.replace(/\\/g, "/").toLowerCase().startsWith(root);
  }
  return !isExcludedRelativePath(rel);
}

export async function buildRepositoryInventory(
  request: RepositoryReviewRequest,
  io: ReviewWorkspaceIO
): Promise<RepositoryInventory> {
  const listed = await io.listFiles(request.workspaceRoot);
  const safeListed = listed.filter((f) => isInsideWorkspace(f.relativePath, request.workspaceRoot));
  const gitState = (await io.getGitState?.(request.workspaceRoot)) ?? {
    dirty: false,
    changedFiles: []
  };

  const scoped = scopeFilter(request.scope, safeListed, request, gitState.changedFiles).slice(
    0,
    MAX_INVENTORY_FILES
  );

  const languageStats: Record<string, number> = {};
  for (const file of scoped) {
    const lang = languageForExt(extOf(file.relativePath));
    if (!lang) continue;
    languageStats[lang] = (languageStats[lang] ?? 0) + 1;
  }

  const paths = scoped.map((f) => f.relativePath);
  const packageJsonRaw = await io.readText(request.workspaceRoot, "package.json");
  const scripts = parsePackageScripts(packageJsonRaw);

  const largeFiles = scoped
    .filter(
      (f) =>
        f.bytes >= LARGE_FILE_BYTES || (typeof f.lines === "number" && f.lines >= LARGE_FILE_LINES)
    )
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 40)
    .map((f) => ({
      path: f.relativePath,
      lines: f.lines ?? 0,
      bytes: f.bytes
    }));

  // Enrich line counts for large files when missing
  for (const large of largeFiles) {
    if (large.lines > 0) continue;
    const content = await io.readText(request.workspaceRoot, large.path);
    if (content) large.lines = content.split(/\r?\n/).length;
  }

  return {
    languageStats,
    frameworkHints: detectFrameworkHints(paths, packageJsonRaw),
    packageManager: detectPackageManager(paths),
    buildCommands: scriptCommands(scripts, ["build", "production", "prod"]),
    testCommands: scriptCommands(scripts, ["test", "test:unit", "vitest", "pytest"]),
    lintCommands: scriptCommands(scripts, ["lint", "eslint"]),
    typecheckCommands: scriptCommands(scripts, ["typecheck", "type-check", "tsc"]),
    largeFiles,
    gitState: {
      branch: gitState.branch,
      dirty: gitState.dirty,
      changedFiles: gitState.changedFiles
    },
    fileCount: scoped.length,
    files: paths
  };
}
