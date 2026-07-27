import type {
  ExecutedReviewCheck,
  ReviewBatchAnalyzerDiagnostics,
  ReviewQualityAssessment,
  ProductionReadinessAssessment,
  RepositoryInventory,
  RepositoryReviewFinding,
  RepositoryReviewOutcome,
  RepositoryReviewPlan,
  RepositoryReviewProgress,
  RepositoryReviewReport,
  RepositoryReviewRequest,
  ReviewBatchPlan
} from "@dbzs/shared";
import { ensureBatchFitsOrSplit } from "./reviewBatchBudget";
import { describeEmptyReviewPlan, planReviewBatches } from "./reviewBatchPlanner";
import { planReviewCommands } from "./reviewCommandPlanner";
import { runReviewCommands } from "./reviewCommandRunner";
import {
  countSeverities,
  dedupeRepositoryReviewFindings,
  filterFindingsToExistingPaths
} from "./reviewFindings";
import { createHeuristicBatchAnalyzer } from "./heuristicBatchAnalyzer";
import { buildRepositoryInventory } from "./repositoryInventory";
import {
  createInitialReviewState,
  loadReviewPlan,
  loadReviewState,
  reviewArtifactPaths,
  saveBatchResult,
  saveAnalyzerDiagnostics,
  saveCommandResults,
  saveFindings,
  saveInventory,
  saveReportMarkdown,
  saveQualityAssessment,
  saveReviewPlan,
  saveReviewRequest,
  saveReviewState
} from "./reviewPersistence";
import {
  buildRepositoryReviewReport,
  buildReviewReportMarkdown
} from "./reviewReportMarkdown";
import {
  assessProductionReadiness,
  assessReviewQuality,
  resolveReviewOutcome
} from "./reviewQuality";
import {
  CODE_REVIEW_INTENT_LABEL,
  REPOSITORY_REVIEW_WORKFLOW_ID,
  type BatchAnalyzer,
  type ReviewStateFile,
  type ReviewWorkspaceIO
} from "./types";

export interface RepositoryReviewOrchestratorOptions {
  io: ReviewWorkspaceIO;
  runtimeContextLimit?: number;
  executionAllowed?: boolean;
  approveInstall?: boolean;
  batchAnalyzer?: BatchAnalyzer;
  createReviewId?: () => string;
  onProgress?: (progress: RepositoryReviewProgress) => void;
}

export interface RepositoryReviewRunResult {
  reviewId: string;
  outcome: RepositoryReviewOutcome;
  plan: RepositoryReviewPlan | null;
  inventory: RepositoryInventory | null;
  findings: RepositoryReviewFinding[];
  diagnostics?: ReviewBatchAnalyzerDiagnostics[];
  quality?: ReviewQualityAssessment;
  productionReadiness?: ProductionReadinessAssessment;
  report: RepositoryReviewReport | null;
  progress: RepositoryReviewProgress;
  artifactDir: string;
}

function makeReviewId(): string {
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toProgress(input: {
  reviewId: string;
  request: RepositoryReviewRequest;
  status: RepositoryReviewPlan["status"];
  outcome?: RepositoryReviewOutcome;
  plan: RepositoryReviewPlan | null;
  completedBatches: number;
  currentBatchTitle?: string;
  checks: ExecutedReviewCheck[];
  findings: RepositoryReviewFinding[];
  diagnostics?: ReviewBatchAnalyzerDiagnostics[];
  quality?: ReviewQualityAssessment;
  productionReadiness?: ProductionReadinessAssessment;
}): RepositoryReviewProgress {
  const paths = reviewArtifactPaths(input.reviewId);
  return {
    reviewId: input.reviewId,
    workspaceId: input.request.workspaceId,
    scope: input.request.scope,
    status: input.status,
    outcome: input.outcome,
    intentLabel: CODE_REVIEW_INTENT_LABEL,
    workflowId: REPOSITORY_REVIEW_WORKFLOW_ID,
    totalBatches: input.plan?.batches.length ?? 0,
    completedBatches: input.completedBatches,
    currentBatchTitle: input.currentBatchTitle,
    checks: input.checks.map((c) => ({
      id: c.id,
      label: c.purpose,
      status: c.status
    })),
    severityCounts: countSeverities(input.findings),
    artifactDir: paths.root,
    reportPath: paths.report,
    findingsPath: paths.findings,
    analyzerDiagnostics: input.diagnostics,
    quality: input.quality,
    productionReadiness: input.productionReadiness,
    reviewedFileCount: input.quality?.reviewedFileCount,
    plannedFileCount: input.quality?.plannedFileCount,
    topFindings: input.findings.filter((finding) => !finding.needsVerification).slice(0, 3),
    startedAt: undefined,
    updatedAt: new Date().toISOString()
  };
}

export class RepositoryReviewOrchestrator {
  private readonly io: ReviewWorkspaceIO;
  private readonly runtimeContextLimit: number;
  private readonly executionAllowed: boolean;
  private readonly approveInstall: boolean;
  private readonly batchAnalyzer: BatchAnalyzer;
  private readonly createReviewId: () => string;
  private readonly onProgress?: (progress: RepositoryReviewProgress) => void;

  constructor(options: RepositoryReviewOrchestratorOptions) {
    this.io = options.io;
    this.runtimeContextLimit = options.runtimeContextLimit ?? 8192;
    this.executionAllowed = options.executionAllowed ?? false;
    this.approveInstall = options.approveInstall ?? false;
    this.batchAnalyzer = options.batchAnalyzer ?? createHeuristicBatchAnalyzer();
    this.createReviewId = options.createReviewId ?? makeReviewId;
    this.onProgress = options.onProgress;
  }

  async start(request: RepositoryReviewRequest): Promise<RepositoryReviewRunResult> {
    const reviewId = this.createReviewId();
    let state = createInitialReviewState({
      reviewId,
      workspaceId: request.workspaceId,
      workspaceRoot: request.workspaceRoot
    });
    await saveReviewRequest(this.io, request, reviewId);
    await saveReviewState(this.io, request.workspaceRoot, state);

    return this.execute(request, state, { resume: false });
  }

  async resume(
    request: RepositoryReviewRequest,
    reviewId: string
  ): Promise<RepositoryReviewRunResult> {
    const state = await loadReviewState(this.io, request.workspaceRoot, reviewId);
    if (!state) {
      return this.failedResult(request, reviewId, "inventory_failed", null, null, [], "missing review state");
    }
    if (state.workspaceId !== request.workspaceId) {
      return this.failedResult(
        request,
        reviewId,
        "inventory_failed",
        null,
        null,
        [],
        "workspace mismatch — refusing to mix reviews"
      );
    }
    if (state.status === "completed") {
      const plan = await loadReviewPlan(this.io, request.workspaceRoot, reviewId);
      const progress = toProgress({
        reviewId,
        request,
        status: "completed",
        outcome: state.outcome ?? "completed",
        plan,
        completedBatches: state.completedBatchIds.length,
        checks: [],
        findings: []
      });
      return {
        reviewId,
        outcome: state.outcome ?? "completed",
        plan,
        inventory: null,
        findings: [],
        report: null,
        progress,
        artifactDir: reviewArtifactPaths(reviewId).root
      };
    }
    return this.execute(request, state, { resume: true });
  }

  private async execute(
    request: RepositoryReviewRequest,
    state: ReviewStateFile,
    opts: { resume: boolean }
  ): Promise<RepositoryReviewRunResult> {
    const reviewId = state.reviewId;
    let inventory: RepositoryInventory | null = null;
    let plan: RepositoryReviewPlan | null = null;
    let checks: ExecutedReviewCheck[] = [];
    let findings: RepositoryReviewFinding[] = [];
    const diagnostics: ReviewBatchAnalyzerDiagnostics[] = [...(state.analyzerDiagnostics ?? [])];
    let quality: ReviewQualityAssessment | undefined = state.quality;
    let productionReadiness: ProductionReadinessAssessment | undefined;
    const reviewedPaths = new Set<string>();
    const completed = new Set(state.completedBatchIds);

    const emit = (
      status: RepositoryReviewPlan["status"],
      outcome: RepositoryReviewOutcome | undefined,
      currentBatchTitle?: string
    ) => {
      const progress = toProgress({
        reviewId,
        request,
        status,
        outcome,
        plan,
        completedBatches: completed.size,
        currentBatchTitle,
        checks,
        findings,
        diagnostics,
        quality,
        productionReadiness
      });
      this.onProgress?.(progress);
      return progress;
    };

    try {
      inventory = await buildRepositoryInventory(request, this.io);
      await saveInventory(this.io, request.workspaceRoot, reviewId, inventory);

      if (inventory.fileCount === 0) {
        state.status = "failed";
        state.outcome = "failed";
        state.updatedAt = new Date().toISOString();
        await saveReviewState(this.io, request.workspaceRoot, state);
        const progress = emit("failed", "failed");
        return {
          reviewId,
          outcome: "failed",
          plan: null,
          inventory,
          findings: [],
          report: null,
          progress,
          artifactDir: reviewArtifactPaths(reviewId).root
        };
      }

      if (!opts.resume || !(await loadReviewPlan(this.io, request.workspaceRoot, reviewId))) {
        const plannedBatches = planReviewBatches(request, inventory);
        const batches: ReviewBatchPlan[] = [];
        const planningQueue = [...plannedBatches];
        while (planningQueue.length > 0) {
          const candidate = planningQueue.shift()!;
          const contents = new Map<string, string>();
          for (const candidatePath of candidate.paths) {
            const content = await this.io.readText(request.workspaceRoot, candidatePath);
            if (content != null) contents.set(candidatePath, content.slice(0, 80_000));
          }
          const fit = ensureBatchFitsOrSplit({
            batch: candidate,
            runtimeContextLimit: this.runtimeContextLimit,
            systemText: "Codee repository review",
            taskText: `${candidate.title}: ${candidate.purpose}`,
            fileContents: contents
          });
          if (fit.splitApplied) planningQueue.unshift(...fit.batches);
          else batches.push(candidate);
        }
        const commands = planReviewCommands(request, inventory);
        plan = {
          reviewId,
          workspaceId: request.workspaceId,
          scope: request.scope,
          batches,
          commands,
          expectedArtifacts: [
            reviewArtifactPaths(reviewId).inventory,
            reviewArtifactPaths(reviewId).plan,
            reviewArtifactPaths(reviewId).analyzerDiagnostics,
            reviewArtifactPaths(reviewId).qualityAssessment,
            reviewArtifactPaths(reviewId).findings,
            reviewArtifactPaths(reviewId).report
          ],
          status: "running"
        };
        await saveReviewPlan(this.io, request.workspaceRoot, plan);
      } else {
        plan = await loadReviewPlan(this.io, request.workspaceRoot, reviewId);
        if (plan) {
          plan = { ...plan, status: "running" };
          await saveReviewPlan(this.io, request.workspaceRoot, plan);
        }
      }

      if (!plan || plan.batches.length === 0) {
        const detail = plan
          ? describeEmptyReviewPlan(request)
          : "Der Review-Plan konnte nicht erstellt werden.";
        state.status = "failed";
        state.outcome = "empty_plan";
        state.detail = detail;
        state.updatedAt = new Date().toISOString();
        await saveReviewState(this.io, request.workspaceRoot, state);
        const progress = emit("failed", "empty_plan", detail);
        return {
          reviewId,
          outcome: "empty_plan",
          plan,
          inventory,
          findings: [],
          report: null,
          progress,
          artifactDir: reviewArtifactPaths(reviewId).root
        };
      }

      state.status = "running";
      state.updatedAt = new Date().toISOString();
      await saveReviewState(this.io, request.workspaceRoot, state);
      emit("running", undefined);

      checks = await runReviewCommands({
        io: this.io,
        commands: plan.commands,
        executionAllowed: this.executionAllowed,
        approveInstall: this.approveInstall
      });
      await saveCommandResults(this.io, request.workspaceRoot, reviewId, checks);

      const existingPaths = new Set(inventory.files.map((p) => p.replace(/\\/g, "/")));
      plan.batches
        .filter((batch) => completed.has(batch.batchId))
        .flatMap((batch) => batch.paths)
        .forEach((path) => reviewedPaths.add(path));
      const queue: ReviewBatchPlan[] = [...plan.batches];
      const splitOnce = new Set<string>();

      while (queue.length > 0) {
        const batch = queue.shift()!;
        if (completed.has(batch.batchId)) continue;

        state.currentBatchId = batch.batchId;
        state.updatedAt = new Date().toISOString();
        await saveReviewState(this.io, request.workspaceRoot, state);
        emit("running", undefined, batch.title);

        const fileContents = new Map<string, string>();
        for (const path of batch.paths) {
          const content = await this.io.readText(request.workspaceRoot, path);
          if (content != null) {
            // Cap per-file content for budget safety
            fileContents.set(path, content.slice(0, 80_000));
          }
        }

        const systemText =
          "You are the Codee repository reviewer. Return only verified findings with path and evidence.";
        const taskText = `Batch ${batch.batchId}: ${batch.title}. Purpose: ${batch.purpose}`;
        const fit = ensureBatchFitsOrSplit({
          batch,
          runtimeContextLimit: this.runtimeContextLimit,
          systemText,
          taskText,
          fileContents
        });

        if (fit.splitApplied && !splitOnce.has(batch.batchId)) {
          splitOnce.add(batch.batchId);
          queue.unshift(...fit.batches);
          // Keep plan updated with split children
          plan = {
            ...plan,
            batches: [
              ...plan.batches.filter((b) => b.batchId !== batch.batchId),
              ...fit.batches
            ]
          };
          await saveReviewPlan(this.io, request.workspaceRoot, plan);
          continue;
        }

        const files = [...fileContents.entries()].map(([path, content]) => ({ path, content }));
        let batchFindings: RepositoryReviewFinding[] = [];
        let batchDiagnostics: ReviewBatchAnalyzerDiagnostics;
        try {
          const analysis = await this.batchAnalyzer({
            batch: fit.batches[0] ?? batch,
            files,
            request,
            inventory
          });
          batchFindings = analysis.findings;
          batchDiagnostics = analysis.diagnostics;
        } catch (error) {
          state.status = "failed";
          state.outcome = "failed";
          state.updatedAt = new Date().toISOString();
          await saveReviewState(this.io, request.workspaceRoot, state);
          const progress = emit("failed", "failed", batch.title);
          return {
            reviewId,
            outcome: "failed",
            plan,
            inventory,
            findings,
            report: null,
            progress,
            artifactDir: reviewArtifactPaths(reviewId).root
          };
        }

        const verified = filterFindingsToExistingPaths(batchFindings, existingPaths);
        findings.push(...verified);
        files.forEach((file) => reviewedPaths.add(file.path));
        diagnostics.push(batchDiagnostics!);
        await saveBatchResult(this.io, request.workspaceRoot, reviewId, batch.batchId, {
          batchId: batch.batchId,
          findings: verified,
          pathCount: files.length,
          diagnostics: batchDiagnostics!
        });
        await saveAnalyzerDiagnostics(this.io, request.workspaceRoot, reviewId, diagnostics);
        completed.add(batch.batchId);
        state.completedBatchIds = [...completed];
        state.updatedAt = new Date().toISOString();
        await saveReviewState(this.io, request.workspaceRoot, state);
      }

      findings = dedupeRepositoryReviewFindings(request.workspaceId, findings);
      await saveFindings(this.io, request.workspaceRoot, reviewId, findings);
      quality = assessReviewQuality({
        findings,
        diagnostics,
        batches: plan.batches,
        reviewedFileCount: reviewedPaths.size,
        plannedFileCount: new Set(plan.batches.flatMap((batch) => batch.paths)).size
      });
      await saveQualityAssessment(this.io, request.workspaceRoot, reviewId, quality);
      const outcome = resolveReviewOutcome({
        completedBatches: completed.size,
        plannedBatches: plan.batches.length,
        diagnostics,
        checks,
        quality
      });
      productionReadiness = assessProductionReadiness({
        findings,
        executedChecks: checks,
        quality,
        outcome
      });
      const remainingRisks: string[] = [];
      if (checks.some((c) => c.status === "not_executed")) {
        remainingRisks.push("Some checks were not executed (approval or policy).");
      }
      if (checks.some((c) => c.status === "failed")) {
        remainingRisks.push("One or more deterministic checks failed.");
      }
      if ((inventory.largeFiles?.length ?? 0) > 0) {
        remainingRisks.push("Large files may hide additional issues outside batch budgets.");
      }

      let markdown: string;
      try {
        markdown = buildReviewReportMarkdown({
          reviewId,
          workspaceRoot: request.workspaceRoot,
          scope: request.scope,
          findings,
          executedChecks: checks,
          remainingRisks,
          productionReadiness,
          quality,
          analyzerDiagnostics: diagnostics
        });
        await saveReportMarkdown(this.io, request.workspaceRoot, reviewId, markdown);
      } catch {
        state.status = "failed";
        state.outcome = "failed";
        state.updatedAt = new Date().toISOString();
        await saveReviewState(this.io, request.workspaceRoot, state);
        const progress = emit("failed", "failed");
        return {
          reviewId,
          outcome: "failed",
          plan,
          inventory,
          findings,
          report: null,
          progress,
          artifactDir: reviewArtifactPaths(reviewId).root
        };
      }

      // Honest success: inventory + batches + report must exist
      if (completed.size === 0 || !plan.batches.length) {
        state.status = "failed";
        state.outcome = "failed";
        state.updatedAt = new Date().toISOString();
        await saveReviewState(this.io, request.workspaceRoot, state);
        const progress = emit("failed", "failed");
        return {
          reviewId,
          outcome: "failed",
          plan,
          inventory,
          findings,
          report: null,
          progress,
          artifactDir: reviewArtifactPaths(reviewId).root
        };
      }

      plan = { ...plan, status: "completed" };
      await saveReviewPlan(this.io, request.workspaceRoot, plan);
      state.status = "completed";
      state.outcome = outcome;
      state.analyzerDiagnostics = diagnostics;
      state.quality = quality;
      state.currentBatchId = undefined;
      state.updatedAt = new Date().toISOString();
      await saveReviewState(this.io, request.workspaceRoot, state);

      const report = buildRepositoryReviewReport({
        reviewId,
        summary: markdown.split("\n").slice(0, 12).join("\n"),
        findings,
        executedChecks: checks,
        remainingRisks,
        productionReadiness,
        quality,
        analyzerDiagnostics: diagnostics
      });
      const progress = emit("completed", outcome);
      return {
        reviewId,
        outcome,
        plan,
        inventory,
        findings,
        diagnostics,
        quality,
        report,
        progress,
        artifactDir: reviewArtifactPaths(reviewId).root
      };
    } catch (error) {
      state.status = "failed";
      state.outcome = "failed";
      state.updatedAt = new Date().toISOString();
      await saveReviewState(this.io, request.workspaceRoot, state).catch(() => undefined);
      const progress = emit("failed", "failed");
      return {
        reviewId,
        outcome: "failed",
        plan,
        inventory,
        findings,
        report: null,
        progress: {
          ...progress,
          currentBatchTitle:
            error instanceof Error ? error.message : "review_failed"
        },
        artifactDir: reviewArtifactPaths(reviewId).root
      };
    }
  }

  private failedResult(
    request: RepositoryReviewRequest,
    reviewId: string,
    outcome: RepositoryReviewOutcome,
    plan: RepositoryReviewPlan | null,
    inventory: RepositoryInventory | null,
    findings: RepositoryReviewFinding[],
    detail: string
  ): RepositoryReviewRunResult {
    const progress = toProgress({
      reviewId,
      request,
      status: "failed",
      outcome,
      plan,
      completedBatches: 0,
      currentBatchTitle: detail,
      checks: [],
      findings
    });
    return {
      reviewId,
      outcome,
      plan,
      inventory,
      findings,
      report: null,
      progress,
      artifactDir: reviewArtifactPaths(reviewId).root
    };
  }
}
