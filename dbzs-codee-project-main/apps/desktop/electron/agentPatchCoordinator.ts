import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AgentFileChangePreview,
  AgentFileChangeProposal,
  AgentPatchApplyResult,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentPatchState,
  RestorePoint
} from "@dbzs/shared";
import type { PatchPipelineService } from "./patchPipelineService.js";
import type { RestorePointService } from "./restorePointService.js";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";

interface AgentPatchCoordinatorOptions {
  patchPipelineService: PatchPipelineService;
  restorePointService: RestorePointService;
  maxFilesChanged?: number;
  maxPatchSize?: number;
}

interface StoredProposal {
  proposal: AgentPatchProposal;
  preview: AgentPatchPreview;
  approvalVersion: string;
  approvedVersion: string | null;
  state: AgentPatchState;
}

const PROTECTED_PATHS = [/^\.git(?:\/|$)/i, /^\.codee\/restore-points(?:\/|$)/i, /^\.env(?:\.|$)/i];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`[PATCH_PATH_INVALID] filePath muss workspace-relativ sein: ${filePath}`);
  }
  return normalized;
}

function isProtectedPath(filePath: string): boolean {
  return PROTECTED_PATHS.some((pattern) => pattern.test(filePath));
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(targetPath: string): Promise<string> {
  try {
    const content = await fs.readFile(targetPath);
    if (isBinaryBuffer(content)) {
      throw new Error("[PATCH_BINARY_BLOCKED] Binaerdateien duerfen nicht automatisch geaendert werden.");
    }
    return content.toString("utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export class AgentPatchCoordinator {
  private readonly patchPipelineService: PatchPipelineService;
  private readonly restorePointService: RestorePointService;
  private readonly maxFilesChanged: number;
  private readonly maxPatchSize: number;
  private readonly proposals = new Map<string, StoredProposal>();

  constructor(options: AgentPatchCoordinatorOptions) {
    this.patchPipelineService = options.patchPipelineService;
    this.restorePointService = options.restorePointService;
    this.maxFilesChanged = options.maxFilesChanged ?? 8;
    this.maxPatchSize = options.maxPatchSize ?? 64_000;
  }

  private resolveSafeTarget(workspaceRoot: string, filePath: string): { relativePath: string; absolutePath: string } {
    const relativePath = normalizeRelativePath(filePath);
    if (isProtectedPath(relativePath)) {
      throw new Error(`[PATCH_PROTECTED_PATH] Geschuetzter Pfad blockiert: ${relativePath}`);
    }

    const workspace = toResolvedPath(workspaceRoot);
    const absolutePath = ensurePathInsideWorkspace(workspace, path.join(workspace, relativePath));
    return { relativePath, absolutePath };
  }

  private async assertNoSymlinkEscape(workspaceRoot: string, absolutePath: string): Promise<void> {
    const workspaceReal = await fs.realpath(toResolvedPath(workspaceRoot));
    let current = absolutePath;
    const existingParts: string[] = [];

    while (!(await exists(current))) {
      existingParts.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    if (await exists(current)) {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("[PATCH_SYMLINK_BLOCKED] Symlink-Ziel ist fuer Patch-Apply blockiert.");
      }
      const real = await fs.realpath(current);
      ensurePathInsideWorkspace(workspaceReal, real);
    }

    if (existingParts.length === 0) {
      const targetStats = await fs.lstat(absolutePath);
      if (targetStats.isSymbolicLink()) {
        throw new Error("[PATCH_SYMLINK_BLOCKED] Symlink-Dateien duerfen nicht automatisch geaendert werden.");
      }
    }
  }

  private validateProposal(workspaceRoot: string, proposal: AgentPatchProposal): AgentPatchProposal {
    if (!proposal.id || !proposal.runId || !proposal.title || !Array.isArray(proposal.changes)) {
      throw new Error("[PATCH_CONTRACT_INVALID] Proposal ist unvollstaendig.");
    }
    if (proposal.changes.length === 0) {
      throw new Error("[PATCH_EMPTY] Proposal enthaelt keine Dateiänderungen.");
    }
    if (proposal.changes.length > this.maxFilesChanged) {
      throw new Error(`[PATCH_LIMIT_FILES] maxFilesChanged=${this.maxFilesChanged}`);
    }

    const seen = new Set<string>();
    let totalSize = 0;
    const changes = proposal.changes.map((change) => {
      const { relativePath } = this.resolveSafeTarget(workspaceRoot, change.filePath);
      if (seen.has(relativePath)) {
        throw new Error(`[PATCH_DUPLICATE_FILE] Datei mehrfach enthalten: ${relativePath}`);
      }
      seen.add(relativePath);

      if ((change.changeType === "create" || change.changeType === "modify") && typeof change.proposedContent !== "string") {
        throw new Error(`[PATCH_CONTENT_REQUIRED] proposedContent fehlt fuer ${relativePath}`);
      }
      if (change.changeType === "delete" && change.proposedContent !== undefined) {
        throw new Error(`[PATCH_DELETE_CONTENT_INVALID] Delete darf keinen Inhalt enthalten: ${relativePath}`);
      }

      totalSize += Buffer.byteLength(change.proposedContent ?? "", "utf-8");
      return { ...change, filePath: relativePath };
    });

    if (totalSize > this.maxPatchSize) {
      throw new Error(`[PATCH_LIMIT_SIZE] maxPatchSize=${this.maxPatchSize}`);
    }

    return { ...proposal, changes };
  }

  async createPreview(workspaceRoot: string, proposal: AgentPatchProposal): Promise<AgentPatchPreview> {
    const validated = this.validateProposal(workspaceRoot, proposal);
    const previews: AgentFileChangePreview[] = [];

    for (const change of validated.changes) {
      const { absolutePath } = this.resolveSafeTarget(workspaceRoot, change.filePath);
      await this.assertNoSymlinkEscape(workspaceRoot, absolutePath);
      const existed = await exists(absolutePath);

      if (change.changeType === "create" && existed) {
        throw new Error(`[PATCH_CREATE_EXISTS] Datei existiert bereits: ${change.filePath}`);
      }
      if ((change.changeType === "modify" || change.changeType === "delete") && !existed) {
        throw new Error(`[PATCH_TARGET_MISSING] Datei existiert nicht: ${change.filePath}`);
      }

      await readTextIfExists(absolutePath);
      const proposedContent = change.changeType === "delete" ? "" : change.proposedContent ?? "";
      const preview = await this.patchPipelineService.createPatchPreview(
        workspaceRoot,
        absolutePath,
        proposedContent
      );
      previews.push({
        changeId: change.id,
        filePath: change.filePath,
        changeType: change.changeType,
        snapshotId: preview.snapshotId,
        beforeContent: preview.beforeContent,
        afterContent: preview.afterContent,
        diff: preview.diff
      });
    }

    const approvalVersion = `${validated.id}:${validated.createdAt}:${previews.map((preview) => preview.snapshotId).join(",")}`;
    const patchPreview: AgentPatchPreview = {
      proposalId: validated.id,
      state: "PREVIEW_READY",
      previews,
      approvalVersion,
      createdAt: nowIso()
    };
    this.proposals.set(validated.id, {
      proposal: validated,
      preview: patchPreview,
      approvalVersion,
      approvedVersion: null,
      state: "WAITING_FOR_APPROVAL"
    });
    return patchPreview;
  }

  approveProposal(proposalId: string, approvalVersion: string): AgentPatchPreview {
    const stored = this.getStored(proposalId);
    if (stored.approvalVersion !== approvalVersion) {
      throw new Error("[PATCH_APPROVAL_STALE] Freigabe passt nicht zur aktuellen Preview.");
    }
    stored.approvedVersion = approvalVersion;
    stored.state = "APPROVED";
    return { ...stored.preview, state: "APPROVED" };
  }

  rejectProposal(proposalId: string): AgentPatchPreview {
    const stored = this.getStored(proposalId);
    stored.state = "REJECTED";
    return { ...stored.preview, state: "REJECTED" };
  }

  async applyApprovedProposal(workspaceRoot: string, proposalId: string): Promise<AgentPatchApplyResult> {
    const stored = this.getStored(proposalId);
    if (stored.approvedVersion !== stored.approvalVersion) {
      throw new Error("[PATCH_REVIEW_REQUIRED] Keine gueltige Freigabe fuer diesen Patch.");
    }

    stored.state = "APPLYING";
    const filePaths = stored.proposal.changes.map((change) => change.filePath);
    let restorePoint: RestorePoint | null = null;
    const changedFiles: string[] = [];
    const deletedFiles: string[] = [];

    try {
      for (const change of stored.proposal.changes) {
        const { absolutePath } = this.resolveSafeTarget(workspaceRoot, change.filePath);
        await this.assertNoSymlinkEscape(workspaceRoot, absolutePath);
        await readTextIfExists(absolutePath);
      }

      restorePoint = await this.restorePointService.createRestorePoint(
        workspaceRoot,
        filePaths,
        "before_patch",
        `Agent patch: ${stored.proposal.title}`,
        {
          relatedRunId: stored.proposal.runId,
          relatedChangeIds: stored.proposal.changes.map((change) => change.id)
        }
      );

      for (const change of stored.proposal.changes) {
        const preview = stored.preview.previews.find((entry) => entry.changeId === change.id);
        if (!preview) {
          throw new Error(`[PATCH_PREVIEW_MISSING] Preview fehlt fuer ${change.filePath}`);
        }
        const { absolutePath } = this.resolveSafeTarget(workspaceRoot, change.filePath);

        if (change.changeType === "delete") {
          await fs.rm(absolutePath, { force: true });
          if (await exists(absolutePath)) {
            throw new Error(`[PATCH_VERIFY_DELETE_FAILED] Datei wurde nicht geloescht: ${change.filePath}`);
          }
          deletedFiles.push(change.filePath);
          continue;
        }

        await this.patchPipelineService.applyPatchWithRestorePoint(
          workspaceRoot,
          absolutePath,
          change.proposedContent ?? "",
          "before_patch",
          {
            reviewGateApproved: true,
            limits: { maxFilesChanged: this.maxFilesChanged, maxPatchSize: this.maxPatchSize }
          }
        );

        const actual = await fs.readFile(absolutePath, "utf-8");
        if (actual !== change.proposedContent) {
          throw new Error(`[PATCH_VERIFY_CONTENT_FAILED] Inhalt stimmt nicht ueberein: ${change.filePath}`);
        }
        changedFiles.push(change.filePath);
      }

      stored.state = "APPLIED";
      return {
        proposalId,
        state: "APPLIED",
        applied: true,
        restorePointId: restorePoint.id,
        changedFiles,
        deletedFiles,
        errors: []
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (restorePoint) {
        await this.restorePointService.restorePoint(workspaceRoot, restorePoint.id);
        stored.state = "ROLLED_BACK";
        return {
          proposalId,
          state: "ROLLED_BACK",
          applied: false,
          restorePointId: restorePoint.id,
          changedFiles,
          deletedFiles,
          errors: [message]
        };
      }

      stored.state = "FAILED";
      return {
        proposalId,
        state: "FAILED",
        applied: false,
        restorePointId: null,
        changedFiles,
        deletedFiles,
        errors: [message]
      };
    }
  }

  async rollback(workspaceRoot: string, restorePointId: string): Promise<AgentPatchApplyResult> {
    const result = await this.restorePointService.restorePoint(workspaceRoot, restorePointId);
    return {
      proposalId: "",
      state: result.success ? "ROLLED_BACK" : "FAILED",
      applied: false,
      restorePointId,
      changedFiles: result.restoredFiles,
      deletedFiles: result.deletedFiles,
      errors: result.errors
    };
  }

  private getStored(proposalId: string): StoredProposal {
    const stored = this.proposals.get(proposalId);
    if (!stored) {
      throw new Error(`[PATCH_PROPOSAL_NOT_FOUND] Proposal nicht gefunden: ${proposalId}`);
    }
    return stored;
  }
}

export function createAgentPatchProposal(input: {
  id: string;
  runId: string;
  title: string;
  summary: string;
  changes: Array<Omit<AgentFileChangeProposal, "runId" | "createdAt"> & { runId?: string; createdAt?: string }>;
  validationCommands?: string[];
  createdAt?: string;
}): AgentPatchProposal {
  const createdAt = input.createdAt ?? nowIso();
  return {
    id: input.id,
    runId: input.runId,
    title: input.title,
    summary: input.summary,
    validationCommands: input.validationCommands,
    createdAt,
    changes: input.changes.map((change) => ({
      ...change,
      runId: change.runId ?? input.runId,
      createdAt: change.createdAt ?? createdAt
    }))
  };
}
