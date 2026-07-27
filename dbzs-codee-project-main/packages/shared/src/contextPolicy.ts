import policyDocument from "./context-excludes.json";

export interface ContextAccessPolicy {
  explicitMention?: boolean;
  accessConfirmed?: boolean;
}

export const DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES = Object.freeze(
  [...policyDocument.excludedDirectories].map((entry) => entry.toLowerCase())
);

const excludedDirectories = new Set(DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES);

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
  return segments.some((segment) => excludedDirectories.has(segment));
}

export function isContextPathAllowed(
  pathValue: string,
  policy: ContextAccessPolicy = {}
): boolean {
  return !isDefaultContextExcluded(pathValue, policy);
}
