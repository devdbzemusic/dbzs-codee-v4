export function toAbsPath(root: string, rel: string): string {
  const clean = rel.trim().replace(/^([\\/])+/, "").replace(/[\\/]+/g, "/");
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]$/, "");
  return `${base}${sep}${clean.replace(/\//g, sep)}`;
}

export function validateRelativePath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 && !parts.includes("..");
}

export function isPathInsideWorkspace(filePath: string, projectPath: string | null): boolean {
  if (!projectPath) {
    return false;
  }

  const normalizedFile = filePath.replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = projectPath.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}
