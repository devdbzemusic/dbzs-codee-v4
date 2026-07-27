import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHeuristicBatchAnalyzer } from "./heuristicBatchAnalyzer";
import { buildRepositoryReviewRequest } from "./reviewIntent";
import { createNodeReviewWorkspaceIO } from "./nodeReviewWorkspaceIo";
import { RepositoryReviewOrchestrator } from "./repositoryReviewOrchestrator";

const WORKSPACE_ROOT = path.resolve(
  process.cwd(),
  "../../test-fixtures/coding-capability-project"
).replace(/\\/g, "/");

const REVIEW_ID = "rev-coding-capability-fixture";

describe("repository review fixture repro", () => {
  it("produces plan, report and findings for the coding capability fixture", async () => {
    await fs.rm(path.join(WORKSPACE_ROOT, ".codee", "reviews", REVIEW_ID), {
      recursive: true,
      force: true
    });

    const orchestrator = new RepositoryReviewOrchestrator({
      io: createNodeReviewWorkspaceIO(),
      runtimeContextLimit: 8192,
      executionAllowed: false,
      batchAnalyzer: createHeuristicBatchAnalyzer(),
      createReviewId: () => REVIEW_ID
    });

    const result = await orchestrator.start(
      buildRepositoryReviewRequest({
        workspaceId: WORKSPACE_ROOT.toLowerCase(),
        workspaceRoot: WORKSPACE_ROOT,
        scope: "full_repository",
        depth: "quick",
        includeBuildChecks: false
      })
    );

    expect(result.outcome === "completed" || result.outcome === "degraded_heuristic_only").toBe(true);
    expect(result.progress.totalBatches).toBeGreaterThan(0);
    expect(result.progress.completedBatches).toBe(result.progress.totalBatches);
    expect(result.plan?.batches.some((batch) => batch.paths.some((entry) => entry.startsWith(".codee/")))).toBe(
      false
    );

    const artifactRoot = path.join(WORKSPACE_ROOT, ".codee", "reviews", REVIEW_ID);
    const reviewPlan = await fs.readFile(path.join(artifactRoot, "review-plan.json"), "utf8");
    const report = await fs.readFile(path.join(artifactRoot, "REVIEW_REPORT.md"), "utf8");
    const findings = await fs.readFile(path.join(artifactRoot, "findings.json"), "utf8");

    expect(reviewPlan).toMatch(/"batches":\s*\[/);
    expect(reviewPlan).not.toMatch(/"batches":\s*\[\s*\]/);
    expect(report).toMatch(/Repository Review Report/);
    expect(findings).toMatch(/^\[/);

    console.log(
      JSON.stringify(
        {
          outcome: result.outcome,
          batches: `${result.progress.completedBatches}/${result.progress.totalBatches}`,
          findings: result.findings.length,
          artifactDir: result.artifactDir,
          reportPath: result.progress.reportPath,
          findingsPath: result.progress.findingsPath
        },
        null,
        2
      )
    );
  }, 120_000);
});
