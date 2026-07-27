import { normalizeWorkspacePath } from "@dbzs/shared";

export function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function joinRoot(root: string, relativePath: string): string {
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalizeRoot(root)}/${rel}`;
}

export function isExcludedRelativePath(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, "/").toLowerCase();
  if (!p || p.includes("..")) return true;
  const parts = p.split("/");
  const blocked = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    "out",
    "vendor"
  ]);
  return parts.some((part) => blocked.has(part));
}

export function normalizeRelativePath(pathValue: string): string {
  return normalizeWorkspacePath(pathValue).replace(/\\/g, "/");
}
