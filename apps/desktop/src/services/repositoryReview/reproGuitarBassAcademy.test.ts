import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRepositoryReviewRequest,
  createHeuristicBatchAnalyzer,
  matchesCompleteRepositoryReviewIntent,
  RepositoryReviewOrchestrator,
  resolveRepositoryReviewScope
} from "./index";
import { createNodeReviewWorkspaceIO } from "./nodeReviewWorkspaceIo";

const GUITAR_BASS = "C:/Users/ralle/source/repos/guitar-bass-academy";

describe("repro guitar-bass-academy repository review", () => {
  it("runs complete review intent against the test workspace", async () => {
    if (!existsSync(GUITAR_BASS)) {
      return;
    }
    const phrase = "Mache einen kompletten Codereview";
    expect(matchesCompleteRepositoryReviewIntent(phrase)).toBe(true);
    expect(resolveRepositoryReviewScope(phrase)).toBe("full_repository");

    const orch = new RepositoryReviewOrchestrator({
      io: createNodeReviewWorkspaceIO(),
      runtimeContextLimit: 8192,
      executionAllowed: false,
      batchAnalyzer: createHeuristicBatchAnalyzer(),
      createReviewId: () => `rev-gba-${Date.now().toString(36)}`
    });
    const result = await orch.start(
      buildRepositoryReviewRequest({
        workspaceId: "c:/users/ralle/source/repos/guitar-bass-academy",
        workspaceRoot: GUITAR_BASS,
        scope: "full_repository",
        depth: "quick",
        includeBuildChecks: false
      })
    );

    expect(
      result.outcome === "completed" || result.outcome === "degraded_heuristic_only"
    ).toBe(true);
    expect(result.progress.totalBatches).toBeGreaterThan(0);
    expect(result.progress.completedBatches).toBe(result.progress.totalBatches);
    expect(result.progress.reportPath).toBeTruthy();
    const report = await createNodeReviewWorkspaceIO().readText(
      GUITAR_BASS,
      result.progress.reportPath!
    );
    expect(report).toMatch(/Repository Review Report/);
     
    console.log(
      JSON.stringify(
        {
          outcome: result.outcome,
          batches: `${result.progress.completedBatches}/${result.progress.totalBatches}`,
          findings: result.findings.length,
          artifactDir: result.artifactDir,
          reportPath: result.progress.reportPath,
          severity: result.progress.severityCounts
        },
        null,
        2
      )
    );
  }, 120_000);
});
