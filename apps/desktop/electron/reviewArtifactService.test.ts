// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listReviewArtifacts,
  resolveReviewArtifactFile,
  resolveReviewArtifactFolder
} from "./reviewArtifactService";

const created: string[] = [];

async function fixture(): Promise<{ workspace: string; reviewId: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codee-review-artifacts-"));
  created.push(workspace);
  const reviewId = "rev-security-001";
  const root = path.join(workspace, ".codee", "reviews", reviewId);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "review-state.json"), JSON.stringify({
    schemaVersion: 2,
    reviewId,
    workspaceId: "workspace-1",
    workspaceRoot: workspace,
    status: "completed",
    outcome: "completed_with_warnings",
    updatedAt: "2026-07-23T10:00:00.000Z"
  }));
  await fs.writeFile(path.join(root, "REVIEW_REPORT.md"), "# Review\n");
  await fs.writeFile(path.join(root, "findings.json"), "[]\n");
  return { workspace, reviewId };
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((target) =>
    fs.rm(target, { recursive: true, force: true })
  ));
});

describe("reviewArtifactService", () => {
  it("listet und öffnet nur Artefakte des aktiven Workspace", async () => {
    const { workspace, reviewId } = await fixture();
    const reviews = await listReviewArtifacts(workspace, workspace);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.reviewId).toBe(reviewId);
    expect(await resolveReviewArtifactFile(workspace, workspace, reviewId, "report"))
      .toBe(path.join(workspace, ".codee", "reviews", reviewId, "REVIEW_REPORT.md"));
  });

  it("blockiert Workspace-Wechsel, Traversal und fremde Review-IDs", async () => {
    const { workspace, reviewId } = await fixture();
    const foreign = await fs.mkdtemp(path.join(os.tmpdir(), "codee-review-foreign-"));
    created.push(foreign);
    await expect(listReviewArtifacts(workspace, foreign)).rejects.toThrow("WORKSPACE_MISMATCH");
    await expect(resolveReviewArtifactFolder(workspace, workspace, "../escape"))
      .rejects.toThrow("REVIEW_ID_INVALID");
    await expect(resolveReviewArtifactFolder(workspace, workspace, `${reviewId}-foreign`))
      .rejects.toThrow();
  });

  it("blockiert einen Review-Symlink nach außerhalb", async () => {
    const { workspace } = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "codee-review-outside-"));
    created.push(outside);
    const link = path.join(workspace, ".codee", "reviews", "rev-symlink-001");
    try {
      await fs.symlink(outside, link, "junction");
    } catch {
      return;
    }
    await expect(resolveReviewArtifactFolder(workspace, workspace, "rev-symlink-001"))
      .rejects.toThrow("SYMLINK_ESCAPE");
  });
});
