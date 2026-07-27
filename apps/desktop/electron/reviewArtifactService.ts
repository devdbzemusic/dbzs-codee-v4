/*
 * DBZS – Division By Zeros
 * Datei: reviewArtifactService.ts
 * Bereich: Electron / Repository Review
 *
 * Zweck:
 *   Listet und öffnet ausschließlich bekannte Review-Artefakte innerhalb
 *   des aktuell gebundenen Workspace.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReviewArtifactSummary } from "@dbzs/shared";
import { resolveCanonicalWorkspacePath } from "./workspacePathGuard";

const REVIEW_ID_PATTERN = /^rev-[a-z0-9][a-z0-9-]{2,80}$/i;

async function assertActiveWorkspace(
  activeWorkspaceRoot: string | null,
  requestedWorkspaceRoot: string
): Promise<string> {
  if (!activeWorkspaceRoot) throw new Error("[REVIEW_WORKSPACE_MISSING] Kein aktiver Workspace.");
  const active = await fs.realpath(path.resolve(activeWorkspaceRoot));
  const requested = await fs.realpath(path.resolve(requestedWorkspaceRoot));
  if (active !== requested) {
    throw new Error("[REVIEW_WORKSPACE_MISMATCH] Review-Aktion gehört nicht zum aktiven Workspace.");
  }
  return active;
}

function assertReviewId(reviewId: string): void {
  if (!REVIEW_ID_PATTERN.test(reviewId)) {
    throw new Error("[REVIEW_ID_INVALID] Ungültige Review-ID.");
  }
}

async function reviewRoot(
  activeWorkspaceRoot: string | null,
  requestedWorkspaceRoot: string,
  reviewId: string
): Promise<string> {
  assertReviewId(reviewId);
  const workspace = await assertActiveWorkspace(activeWorkspaceRoot, requestedWorkspaceRoot);
  return resolveCanonicalWorkspacePath(
    workspace,
    path.join(workspace, ".codee", "reviews", reviewId)
  );
}

export async function listReviewArtifacts(
  activeWorkspaceRoot: string | null,
  requestedWorkspaceRoot: string
): Promise<ReviewArtifactSummary[]> {
  const workspace = await assertActiveWorkspace(activeWorkspaceRoot, requestedWorkspaceRoot);
  const reviewsPath = path.join(workspace, ".codee", "reviews");
  try {
    await resolveCanonicalWorkspacePath(workspace, reviewsPath);
  } catch {
    return [];
  }

  const entries = await fs.readdir(reviewsPath, { withFileTypes: true });
  const summaries: ReviewArtifactSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !REVIEW_ID_PATTERN.test(entry.name)) continue;
    try {
      const root = await reviewRoot(activeWorkspaceRoot, requestedWorkspaceRoot, entry.name);
      const raw = await fs.readFile(path.join(root, "review-state.json"), "utf8");
      const state = JSON.parse(raw) as Partial<ReviewArtifactSummary> & {
        reviewId?: string;
        workspaceId?: string;
        updatedAt?: string;
      };
      if (
        state.reviewId !== entry.name ||
        typeof state.workspaceId !== "string" ||
        typeof state.updatedAt !== "string"
      ) {
        continue;
      }
      summaries.push({
        reviewId: entry.name,
        workspaceId: state.workspaceId,
        status: state.status ?? "failed",
        outcome: state.outcome,
        updatedAt: state.updatedAt,
        artifactDir: `.codee/reviews/${entry.name}`,
        reportPath: `.codee/reviews/${entry.name}/REVIEW_REPORT.md`,
        findingsPath: `.codee/reviews/${entry.name}/findings.json`
      });
    } catch {
      // Ein beschädigter Review blockiert die übrige Registry nicht.
    }
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function resolveReviewArtifactFile(
  activeWorkspaceRoot: string | null,
  requestedWorkspaceRoot: string,
  reviewId: string,
  kind: "report" | "findings"
): Promise<string> {
  const root = await reviewRoot(activeWorkspaceRoot, requestedWorkspaceRoot, reviewId);
  const filename = kind === "report" ? "REVIEW_REPORT.md" : "findings.json";
  const target = await resolveCanonicalWorkspacePath(root, path.join(root, filename));
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("[REVIEW_ARTIFACT_INVALID] Artefakt ist keine Datei.");
  return target;
}

export async function resolveReviewArtifactFolder(
  activeWorkspaceRoot: string | null,
  requestedWorkspaceRoot: string,
  reviewId: string
): Promise<string> {
  const root = await reviewRoot(activeWorkspaceRoot, requestedWorkspaceRoot, reviewId);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("[REVIEW_ARTIFACT_INVALID] Artefaktordner fehlt.");
  return root;
}
