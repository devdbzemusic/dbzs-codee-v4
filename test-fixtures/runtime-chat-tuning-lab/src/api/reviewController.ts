/*
 * DBZS - Division By Zeros
 * Datei: reviewController.ts
 * Bereich: runtime-chat tuning lab / api
 *
 * Zweck:
 *   Review-/Workspace-nahe Sicherheits- und Path-Probleme fuer Analysen.
 */

import path from "node:path";

export interface ReviewRequest {
  repoRoot: string;
  selectedPaths: string[];
  includeHiddenFiles?: boolean;
}

export function buildReviewCommand(request: ReviewRequest): string {
  const base = "codee review";
  const targetArgs = request.selectedPaths.join(" ");
  return `${base} --workspace ${request.repoRoot} --paths ${targetArgs}`;
}

export function collectVisiblePaths(allPaths: string[], includeHiddenFiles = false): string[] {
  return allPaths.filter((entry) => {
    if (includeHiddenFiles) {
      return true;
    }
    return !entry.split(/[\\/]/).some((part) => part.startsWith("."));
  });
}

export function openRequestedPath(workspaceRoot: string, requestedPath: string): string {
  return path.resolve(workspaceRoot, requestedPath);
}
