/**
 * Offline repro: run repository review against guitar-bass-academy (read + .codee writes only).
 * Usage (from apps/desktop): npx tsx src/services/repositoryReview/reproGuitarBassAcademy.ts
 */
import {
  buildRepositoryReviewRequest,
  matchesCompleteRepositoryReviewIntent,
  resolveRepositoryReviewScope
} from "./reviewIntent";
import { createHeuristicBatchAnalyzer } from "./heuristicBatchAnalyzer";
import { RepositoryReviewOrchestrator } from "./repositoryReviewOrchestrator";
import { createNodeReviewWorkspaceIO } from "./nodeReviewWorkspaceIo";

async function main() {
  const workspaceRoot = process.argv[2] || "C:/Users/ralle/source/repos/guitar-bass-academy";
  const phrase = "Mache einen kompletten Codereview";
  console.log("phrase:", phrase);
  console.log("complete intent:", matchesCompleteRepositoryReviewIntent(phrase));
  console.log("scope:", resolveRepositoryReviewScope(phrase));
  console.log("workspace:", workspaceRoot);

  const request = buildRepositoryReviewRequest({
    workspaceId: workspaceRoot.replace(/\\/g, "/").toLowerCase(),
    workspaceRoot,
    scope: "full_repository",
    depth: "quick",
    includeBuildChecks: false
  });

  const orch = new RepositoryReviewOrchestrator({
    io: createNodeReviewWorkspaceIO(),
    runtimeContextLimit: 8192,
    executionAllowed: false,
    batchAnalyzer: createHeuristicBatchAnalyzer(),
    onProgress: (p) => {
      console.log(
        `progress ${p.completedBatches}/${p.totalBatches}`,
        p.currentBatchTitle ?? "",
        p.status
      );
    }
  });

  const result = await orch.start(request);
  console.log("outcome:", result.outcome);
  console.log("batches:", result.progress.completedBatches, "/", result.progress.totalBatches);
  console.log("findings:", result.findings.length);
  console.log("artifactDir:", result.artifactDir);
  console.log("reportPath:", result.progress.reportPath);
  console.log("severity:", result.progress.severityCounts);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
