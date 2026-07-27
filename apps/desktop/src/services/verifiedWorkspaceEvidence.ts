/*
 * DBZS – Division By Zeros
 * Datei: verifiedWorkspaceEvidence.ts
 * Bereich: Desktop Services / Grounded Planning
 *
 * Zweck:
 *   Sammelt verifizierte Workspace-Pfade aus Tools, Index und Kontext.
 */

export type VerifiedPathSource =
  | "list_files"
  | "read_file"
  | "search_code"
  | "code_index"
  | "active_file"
  | "context_source";

export interface VerifiedWorkspaceEvidence {
  paths: Set<string>;
  sources: Map<string, VerifiedPathSource>;
}

export function createVerifiedWorkspaceEvidence(): VerifiedWorkspaceEvidence {
  return {
    paths: new Set<string>(),
    sources: new Map()
  };
}

export function normalizeWorkspacePath(
  rawPath: string,
  workspaceRoot?: string | null
): string | null {
  let value = rawPath.trim().replace(/\\/g, "/");
  if (!value) return null;
  if (value.includes("\0")) return null;
  if (/(^|\/)\.\.(\/|$)/.test(value)) return null;

  const root = workspaceRoot?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  if (root) {
    const rootLower = root.toLowerCase();
    const valueLower = value.toLowerCase();
    if (valueLower.startsWith(rootLower + "/") || valueLower === rootLower) {
      value = value.slice(root.length).replace(/^\/+/, "");
    } else if (/^[a-z]:\//i.test(value) || value.startsWith("//")) {
      // Absolute path outside workspace.
      return null;
    }
  } else if (/^[a-z]:\//i.test(value) || value.startsWith("//")) {
    // Without a workspace root, drop absolute foreign paths.
    return null;
  }

  value = value.replace(/^\/+/, "");
  if (!value) return null;
  if (value.toLowerCase().startsWith(".codee/")) return null;
  return value;
}

export function addVerifiedPath(
  evidence: VerifiedWorkspaceEvidence,
  rawPath: string,
  source: VerifiedPathSource,
  workspaceRoot?: string | null
): boolean {
  const normalized = normalizeWorkspacePath(rawPath, workspaceRoot);
  if (!normalized) return false;
  const key = normalized.toLowerCase();
  // Store canonical relative path with original casing from first sighting.
  if (!evidence.paths.has(key)) {
    evidence.paths.add(key);
    evidence.sources.set(key, source);
  }
  return true;
}

function collectStringPaths(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    if (
      /[\\/]/.test(value) ||
      /\.[a-z0-9]+$/i.test(value) ||
      /^(src|apps|packages|backend|docs)\b/i.test(value)
    ) {
      into.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringPaths(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/path|file|uri|name/i.test(key) && typeof nested === "string") {
        into.push(nested);
      }
      collectStringPaths(nested, into);
    }
  }
}

export function collectEvidenceFromToolResult(
  evidence: VerifiedWorkspaceEvidence,
  toolName: string,
  output: unknown,
  workspaceRoot?: string | null
): void {
  const source: VerifiedPathSource =
    toolName === "list_files" || toolName === "filesystem.list_dir"
      ? "list_files"
      : toolName === "read_file" || toolName === "filesystem.read_file"
        ? "read_file"
        : toolName === "search_code" || toolName === "grep" || toolName === "code.search"
          ? "search_code"
          : "context_source";

  const candidates: string[] = [];
  collectStringPaths(output, candidates);
  for (const candidate of candidates) {
    addVerifiedPath(evidence, candidate, source, workspaceRoot);
  }
}

export function collectEvidenceFromIndexedFiles(
  evidence: VerifiedWorkspaceEvidence,
  paths: Array<string | { path?: string; relativePath?: string }>,
  workspaceRoot?: string | null
): void {
  for (const entry of paths) {
    const raw = typeof entry === "string" ? entry : entry.path ?? entry.relativePath;
    if (raw) addVerifiedPath(evidence, raw, "code_index", workspaceRoot);
  }
}

export function collectEvidenceFromActiveFile(
  evidence: VerifiedWorkspaceEvidence,
  activePath: string | null | undefined,
  workspaceRoot?: string | null
): void {
  if (activePath) addVerifiedPath(evidence, activePath, "active_file", workspaceRoot);
}

export function collectEvidenceFromContextSources(
  evidence: VerifiedWorkspaceEvidence,
  sources: Array<string | { path?: string; uri?: string }>,
  workspaceRoot?: string | null
): void {
  for (const source of sources) {
    const raw = typeof source === "string" ? source : source.path ?? source.uri;
    if (raw) addVerifiedPath(evidence, raw, "context_source", workspaceRoot);
  }
}

export function verifiedPathsList(evidence: VerifiedWorkspaceEvidence): string[] {
  return [...evidence.paths];
}
