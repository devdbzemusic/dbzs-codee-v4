/**
 * Required post-fallback context artifacts (summaries, never fully dropped).
 */

import type { RuntimeChatWorkspaceContext } from "@dbzs/shared";

export type RequiredContextArtifact =
  | "goal_capsule"
  | "current_user_message"
  | "package_manifest"
  | "build_config"
  | "lockfile_summary"
  | "approval_state";

function findSampledContent(
  workspace: RuntimeChatWorkspaceContext | null | undefined,
  predicates: Array<(relativePath: string) => boolean>
): { path: string; content: string } | null {
  if (!workspace) return null;
  for (const predicate of predicates) {
    const hit = workspace.sampledFiles.find((file) =>
      predicate(file.relativePath.replace(/\\/g, "/").toLowerCase())
    );
    if (hit?.content?.trim()) {
      return { path: hit.relativePath, content: hit.content };
    }
  }
  return null;
}

export function summarizePackageJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      name?: string;
      version?: string;
      type?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      main?: string;
    };
    const scripts = parsed.scripts ?? {};
    const keepScripts = ["dev", "build", "start", "preview", "electron", "test", "lint"]
      .filter((key) => scripts[key])
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = scripts[key];
        return acc;
      }, {});
    const depNames = Object.keys(parsed.dependencies ?? {}).slice(0, 40);
    const devDepNames = Object.keys(parsed.devDependencies ?? {}).slice(0, 40);
    return JSON.stringify(
      {
        name: parsed.name,
        version: parsed.version,
        type: parsed.type,
        main: parsed.main,
        scripts: keepScripts,
        dependencies: depNames,
        devDependencies: devDepNames
      },
      null,
      2
    );
  } catch {
    return raw.slice(0, 2500);
  }
}

export function summarizeViteConfig(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const hints: string[] = [];
  for (const line of lines) {
    if (
      /plugin|alias|electron|tauri|outDir|build|server|base\s*:/i.test(line) &&
      line.trim().length > 0
    ) {
      hints.push(line.trim().slice(0, 160));
    }
    if (hints.length >= 24) break;
  }
  if (hints.length === 0) {
    return raw.slice(0, 2000);
  }
  return ["[vite.config summary]", ...hints].join("\n");
}

export function summarizeLockfileMeta(
  workspace: RuntimeChatWorkspaceContext | null | undefined
): string | null {
  if (!workspace) return null;
  const lock = workspace.fileTree.find((entry) =>
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i.test(
      entry.replace(/\\/g, "/")
    )
  );
  if (!lock) return null;
  const manager = /pnpm-lock/i.test(lock)
    ? "pnpm"
    : /yarn\.lock/i.test(lock)
      ? "yarn"
      : /bun\.lock/i.test(lock)
        ? "bun"
        : "npm";
  return `[Lockfile]\npath=${lock}\npackageManager=${manager}`;
}

export function buildRequiredContextArtifactBlock(input: {
  workspace: RuntimeChatWorkspaceContext | null | undefined;
  approvalState?: string | null;
}): { text: string; artifacts: RequiredContextArtifact[]; replacedBySummary: string[] } {
  const artifacts: RequiredContextArtifact[] = [];
  const replacedBySummary: string[] = [];
  const sections: string[] = ["[Required Context Artifacts]"];

  if (input.workspace?.rootPath) {
    sections.push(`Workspace-Root: ${input.workspace.rootPath}`);
  }

  const pkg = findSampledContent(input.workspace, [
    (p) => p === "package.json" || p.endsWith("/package.json")
  ]);
  if (pkg) {
    artifacts.push("package_manifest");
    replacedBySummary.push(pkg.path);
    sections.push(`--- package.json (summary) ---\n${summarizePackageJson(pkg.content)}`);
  }

  const vite = findSampledContent(input.workspace, [
    (p) => /(^|\/)vite\.config\.(ts|js|mjs|cjs)$/i.test(p)
  ]);
  if (vite) {
    artifacts.push("build_config");
    replacedBySummary.push(vite.path);
    sections.push(`--- ${vite.path} (summary) ---\n${summarizeViteConfig(vite.content)}`);
  }

  const lock = summarizeLockfileMeta(input.workspace);
  if (lock) {
    artifacts.push("lockfile_summary");
    sections.push(lock);
  }

  if (input.approvalState?.trim()) {
    artifacts.push("approval_state");
    sections.push(`--- approval_state ---\n${input.approvalState.trim().slice(0, 1500)}`);
  }

  return {
    text: sections.join("\n\n"),
    artifacts,
    replacedBySummary
  };
}
