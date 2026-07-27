import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("@/services/backendClient", () => ({
  backendClient: {
    readProjectFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      return content === undefined ? null : { path, content, language: "json" };
    }),
    writeProjectFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return { path, content, language: "json" };
    })
  }
}));

import {
  applyReviewRemediationSelection,
  beginReviewRemediationQuestion,
  createReviewRemediationSelection,
  finishReviewRemediationSelection,
  readReviewRemediationSelection
} from "./reviewRemediationSelection";

describe("reviewRemediationSelection", () => {
  beforeEach(() => files.clear());

  it("speichert Review und Scope atomar und wird complete", async () => {
    const root = "C:/workspace";
    await beginReviewRemediationQuestion(root, "question-1");
    const result = await applyReviewRemediationSelection(root, {
      questionId: "question-1",
      reviewId: "rev-abc",
      scope: "all"
    });
    expect(result).toMatchObject({
      reviewId: "rev-abc",
      scope: "all",
      reviewConfirmed: true,
      scopeConfirmed: true,
      status: "complete"
    });
    expect(await readReviewRemediationSelection(root)).toMatchObject(result!);
  });

  it("ignoriert eine veraltete questionId", async () => {
    const root = "C:/workspace";
    await beginReviewRemediationQuestion(root, "current");
    expect(await applyReviewRemediationSelection(root, {
      questionId: "stale",
      reviewId: "rev-stale",
      scope: "all"
    })).toBeNull();
    expect((await readReviewRemediationSelection(root))?.reviewId).toBeNull();
  });

  it("bindet Auswahl an Workspace und persistiert Abbruch", async () => {
    const first = createReviewRemediationSelection("C:/workspace-a");
    expect(first.workspaceId).not.toBe(createReviewRemediationSelection("C:/workspace-b").workspaceId);
    await beginReviewRemediationQuestion("C:/workspace-a", "q");
    await finishReviewRemediationSelection("C:/workspace-a", "cancelled");
    expect((await readReviewRemediationSelection("C:/workspace-a"))?.status).toBe("cancelled");
    expect(await readReviewRemediationSelection("C:/workspace-b")).toBeNull();
  });
});
