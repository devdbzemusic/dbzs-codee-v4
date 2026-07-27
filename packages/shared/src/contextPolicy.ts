import policyDocument from "./context-excludes.json";

export interface ContextAccessPolicy {
  explicitMention?: boolean;
  accessConfirmed?: boolean;
}

export const DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES = Object.freeze(
  [...policyDocument.excludedDirectories].map((entry) => entry.toLowerCase())
);

export const DEFAULT_CONTEXT_EXCLUDED_FILE_PATTERNS = Object.freeze(
  [...(policyDocument.excludedFilePatterns ?? [])].map((entry) => entry.toLowerCase())
);

const excludedDirectories = new Set(DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES);

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

const excludedFilePatternRegexes = DEFAULT_CONTEXT_EXCLUDED_FILE_PATTERNS.map(globToRegExp);

function isExcludedFileName(basename: string): boolean {
  const lowered = basename.toLowerCase();
  return excludedFilePatternRegexes.some((regex) => regex.test(lowered));
}

export function normalizeWorkspacePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").trim();
}

export function workspaceScopeId(workspaceRoot: string): string {
  return normalizeWorkspacePath(workspaceRoot).toLowerCase();
}

export function isDefaultContextExcluded(
  pathValue: string,
  policy: ContextAccessPolicy = {}
): boolean {
  if (policy.explicitMention && policy.accessConfirmed) {
    return false;
  }

  const segments = normalizeWorkspacePath(pathValue)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (segments.some((segment) => excludedDirectories.has(segment))) {
    return true;
  }
  const basename = segments[segments.length - 1];
  return basename !== undefined && isExcludedFileName(basename);
}

export function isContextPathAllowed(
  pathValue: string,
  policy: ContextAccessPolicy = {}
): boolean {
  return !isDefaultContextExcluded(pathValue, policy);
}
