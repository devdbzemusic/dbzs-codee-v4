import type { RestorePointReason, WorkspaceFile } from "@dbzs/shared";
import path from "node:path";
import type { FileChangeService } from "./fileChangeService.js";
import type { RestorePointService } from "./restorePointService.js";

export interface PatchPreviewResult {
  snapshotId: string;
  beforeContent: string;
  afterContent: string;
  diff: string;
}

export interface PatchApplyResult {
  snapshotId: string;
  file: WorkspaceFile;
  diff: string;
  restorePointId?: string;
}

export interface PatchSafetyLimits {
  maxIterations: number;
  maxFilesChanged: number;
  maxPatchSize: number;
  maxCommandCount: number;
  timeoutMs: number;
  requireReviewGate: boolean;
  allowCommit: boolean;
}

export interface PatchPlanChange {
  filePath: string;
  proposedContent: string;
}

export interface PatchValidationContext {
  iteration?: number;
  commandCount?: number;
  reviewGateApproved?: boolean;
  allowCommit?: boolean;
  limits?: Partial<PatchSafetyLimits>;
}

export interface PatchPipelineServiceOptions {
  fileChangeService: FileChangeService;
  restorePointService: RestorePointService;
  defaultLimits?: Partial<PatchSafetyLimits>;
}

export const DEFAULT_PATCH_SAFETY_LIMITS: PatchSafetyLimits = {
  maxIterations: 3,
  maxFilesChanged: 8,
  maxPatchSize: 64_000,
  maxCommandCount: 12,
  timeoutMs: 120_000,
  requireReviewGate: true,
  allowCommit: false
};

export class PatchPipelineService {
  private readonly fileChangeService: FileChangeService;
  private readonly restorePointService: RestorePointService;
  private readonly defaultLimits: PatchSafetyLimits;

  constructor(options: PatchPipelineServiceOptions) {
    this.fileChangeService = options.fileChangeService;
    this.restorePointService = options.restorePointService;
    this.defaultLimits = { ...DEFAULT_PATCH_SAFETY_LIMITS, ...(options.defaultLimits ?? {}) };
  }

  resolveLimits(overrides?: Partial<PatchSafetyLimits>): PatchSafetyLimits {
    return { ...this.defaultLimits, ...(overrides ?? {}) };
  }

  validatePatchPlan(changes: PatchPlanChange[], context: PatchValidationContext = {}): PatchSafetyLimits {
    const limits = this.resolveLimits(context.limits);
    const uniqueFiles = new Set(changes.map((change) => path.normalize(change.filePath)));
    const patchSize = changes.reduce((total, change) => total + Buffer.byteLength(change.proposedContent, "utf-8"), 0);

    if ((context.iteration ?? 1) > limits.maxIterations) {
      throw new Error(`Patch safety limit exceeded: maxIterations=${limits.maxIterations}`);
    }
    if (uniqueFiles.size > limits.maxFilesChanged) {
      throw new Error(`Patch safety limit exceeded: maxFilesChanged=${limits.maxFilesChanged}`);
    }
    if (patchSize > limits.maxPatchSize) {
      throw new Error(`Patch safety limit exceeded: maxPatchSize=${limits.maxPatchSize}`);
    }
    if ((context.commandCount ?? 0) > limits.maxCommandCount) {
      throw new Error(`Patch safety limit exceeded: maxCommandCount=${limits.maxCommandCount}`);
    }
    if (limits.requireReviewGate && context.reviewGateApproved !== true) {
      throw new Error("Patch safety gate blocked: review gate approval is required.");
    }
    if (context.allowCommit === true && limits.allowCommit !== true) {
      throw new Error("Patch safety gate blocked: commit is not allowed for this patch loop.");
    }

    return limits;
  }

  async createPatchPreview(
    workspaceRoot: string,
    filePath: string,
    proposedContent: string
  ): Promise<PatchPreviewResult> {
    return this.fileChangeService.createDiff(workspaceRoot, filePath, proposedContent);
  }

  async applyPatchWithRestorePoint(
    workspaceRoot: string,
    filePath: string,
    proposedContent: string,
    reason: RestorePointReason = "before_patch",
    context: PatchValidationContext = { reviewGateApproved: true }
  ): Promise<PatchApplyResult> {
    this.validatePatchPlan([{ filePath, proposedContent }], context);
    const preview = await this.createPatchPreview(workspaceRoot, filePath, proposedContent);
    return this.fileChangeService.applyPatch(
      workspaceRoot,
      filePath,
      proposedContent,
      preview.snapshotId,
      {
        reason,
        label: `Patch apply: ${filePath}`
      }
    );
  }

  async rollbackPatch(workspaceRoot: string, restorePointId: string) {
    return this.restorePointService.restorePoint(workspaceRoot, restorePointId);
  }
}
