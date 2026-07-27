import { isDefaultContextExcluded, normalizeWorkspacePath } from "@dbzs/shared";

export function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function joinRoot(root: string, relativePath: string): string {
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalizeRoot(root)}/${rel}`;
}

const REVIEW_SPECIFIC_BLOCKED_SEGMENTS = new Set(["vendor"]);

export function isExcludedRelativePath(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, "/").toLowerCase();
  if (!p || p.includes("..")) return true;
  const parts = p.split("/");
  if (parts.some((part) => REVIEW_SPECIFIC_BLOCKED_SEGMENTS.has(part))) return true;
  return isDefaultContextExcluded(p);
}

export function normalizeRelativePath(pathValue: string): string {
  return normalizeWorkspacePath(pathValue).replace(/\\/g, "/");
}
