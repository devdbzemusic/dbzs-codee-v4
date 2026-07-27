import type { CommitRequest, HostAction, RestorePointReason } from "@dbzs/shared";
import { agentWorkbenchService } from "@/services/agentWorkbenchService";

export type HostExecutorState = "stopped" | "running" | "busy" | "error";

export interface HostExecutorStatus {
  state: HostExecutorState;
  executorId: string;
  lastActionId: string | null;
  lastActionType: HostAction["actionType"] | null;
  lastError: string | null;
  processedCount: number;
}

type DbzsBridge = Window["dbzs"] & Record<string, unknown>;

const DEFAULT_EXECUTOR_ID = "desktop-primary";
const POLL_INTERVAL_MS = 1500;

let pollTimer: number | null = null;
let processing = false;
let workspaceRoot: string | null = null;
let status: HostExecutorStatus = {
  state: "stopped",
  executorId: DEFAULT_EXECUTOR_ID,
  lastActionId: null,
  lastActionType: null,
  lastError: null,
  processedCount: 0
};
let statusListener: ((next: HostExecutorStatus) => void) | null = null;

function bridge(): DbzsBridge | null {
  return (window.dbzs as DbzsBridge | undefined) ?? null;
}

function emitStatus(next: Partial<HostExecutorStatus>): void {
  status = { ...status, ...next };
  statusListener?.(status);
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function dispatchHostAction(action: HostAction): Promise<Record<string, unknown>> {
  const root = workspaceRoot ?? readString(action.payload, "workspace_root");
  if (!root) {
    throw new Error("Workspace-Root fehlt für Host Action.");
  }

  switch (action.actionType) {
    case "apply_patch": {
      const filePath = readString(action.payload, "file_path");
      const proposedContent = readString(action.payload, "proposed_content");
      if (!filePath || proposedContent === null) {
        throw new Error("apply_patch benötigt file_path und proposed_content.");
      }
      const applyPatchWithRestorePoint = bridge()?.applyPatchWithRestorePoint;
      const applyWorkspacePatch = bridge()?.applyWorkspacePatch;
      const reason = (readString(action.payload, "restore_reason") ?? "before_patch") as RestorePointReason;
      if (applyPatchWithRestorePoint) {
        const result = await applyPatchWithRestorePoint(filePath, proposedContent, reason);
        return {
          file_path: filePath,
          restore_point_id: result.restorePointId ?? null,
          snapshot_id: result.snapshotId
        };
      }
      if (applyWorkspacePatch) {
        const result = await applyWorkspacePatch(filePath, proposedContent, undefined, {
          reason,
          label: readString(action.payload, "label") ?? `Agent Workbench: ${action.id}`
        });
        return {
          file_path: filePath,
          restore_point_id: result.restorePointId ?? null,
          snapshot_id: result.snapshotId
        };
      }
      throw new Error("Safe Patch Pipeline nicht verfügbar.");
    }
    case "run_command": {
      const commandId = readString(action.payload, "command_id");
      if (!commandId) {
        throw new Error("run_command benötigt command_id.");
      }
      const executeSafeCommand = bridge()?.executeSafeCommand;
      if (!executeSafeCommand) {
        throw new Error("executeSafeCommand nicht verfügbar.");
      }
      const run = await executeSafeCommand(root, commandId);
      return {
        run_id: run.runId,
        status: run.status,
        exit_code: run.exitCode
      };
    }
    case "cancel_command": {
      const runId = readString(action.payload, "run_id");
      if (!runId) {
        throw new Error("cancel_command benötigt run_id.");
      }
      const cancelSafeCommand = bridge()?.cancelSafeCommand;
      if (!cancelSafeCommand) {
        throw new Error("cancelSafeCommand nicht verfügbar.");
      }
      const cancelled = await cancelSafeCommand(runId);
      return { run_id: runId, cancelled: cancelled.cancelled };
    }
    case "git_create_branch": {
      const branchName = readString(action.payload, "branch_name");
      if (!branchName) {
        throw new Error("git_create_branch benötigt branch_name.");
      }
      const gitCreateBranch = bridge()?.gitCreateBranch as
        | ((workspace: string, name: string) => Promise<unknown>)
        | undefined;
      if (!gitCreateBranch) {
        throw new Error("gitCreateBranch nicht verfügbar.");
      }
      await gitCreateBranch(root, branchName);
      return { branch_name: branchName };
    }
    case "git_commit": {
      const title = readString(action.payload, "title");
      const includeFiles = action.payload.include_files;
      if (!title) {
        throw new Error("git_commit benötigt title.");
      }
      const createCommit = bridge()?.createCommit;
      if (!createCommit) {
        throw new Error("createCommit nicht verfügbar.");
      }
      const request: CommitRequest = {
        message: {
          id: `host-commit-${action.id}`,
          title,
          body: readString(action.payload, "body") ?? undefined,
          type: "feat",
          affectedFiles: Array.isArray(includeFiles)
            ? includeFiles.filter((entry): entry is string => typeof entry === "string")
            : [],
          riskLevel: "low",
          createdAt: new Date().toISOString()
        },
        includeFiles: Array.isArray(includeFiles)
          ? includeFiles.filter((entry): entry is string => typeof entry === "string")
          : []
      };
      const result = await createCommit(root, request);
      return {
        success: result.success,
        commit_hash: result.commitHash ?? null,
        error: result.error ?? null
      };
    }
    case "refresh_workspace": {
      const scanProjectFiles = bridge()?.scanProjectFiles;
      if (!scanProjectFiles) {
        throw new Error("scanProjectFiles nicht verfügbar.");
      }
      const files = await scanProjectFiles(root);
      return { file_count: files.length };
    }
    default: {
      const unknown: never = action.actionType;
      throw new Error(`Unbekannter Host-Action-Typ: ${unknown}`);
    }
  }
}

async function processNextAction(): Promise<void> {
  if (processing || status.state !== "running") {
    return;
  }

  processing = true;
  let markedBusy = false;
  emitStatus({ state: "busy", lastError: null });
  markedBusy = true;

  try {
    const next = await agentWorkbenchService.getNextHostAction(status.executorId);
    if (!next) {
      emitStatus({ state: "running" });
      markedBusy = false;
      return;
    }

    const claimed = await agentWorkbenchService.claimHostAction(next.id, status.executorId);
    emitStatus({
      lastActionId: claimed.id,
      lastActionType: claimed.actionType
    });

    const result = await dispatchHostAction(claimed);
    await agentWorkbenchService.completeHostAction(claimed.id, { result });
    emitStatus({
      state: "running",
      processedCount: status.processedCount + 1,
      lastError: null
    });
    markedBusy = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Host Action fehlgeschlagen.";
    emitStatus({ state: "error", lastError: message });
    if (status.lastActionId) {
      try {
        await agentWorkbenchService.failHostAction(status.lastActionId, {
          errorMessage: message
        });
      } catch {
        // ignore secondary failure
      }
    }
  } finally {
    processing = false;
    if (markedBusy) {
      emitStatus({ state: "running" });
    }
  }
}

function tick(): void {
  void processNextAction();
}

export const agentHostExecutor = {
  getStatus(): HostExecutorStatus {
    return status;
  },

  setStatusListener(listener: ((next: HostExecutorStatus) => void) | null): void {
    statusListener = listener;
    if (listener) {
      listener(status);
    }
  },

  start(nextWorkspaceRoot: string | null, executorId = DEFAULT_EXECUTOR_ID): void {
    workspaceRoot = nextWorkspaceRoot;
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
    emitStatus({
      state: "running",
      executorId,
      lastError: null
    });
    pollTimer = window.setInterval(tick, POLL_INTERVAL_MS);
    void processNextAction();
  },

  stop(markBusyActionsFailed = true): void {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (markBusyActionsFailed && status.lastActionId && processing) {
      void agentWorkbenchService.failHostAction(status.lastActionId, {
        errorMessage: "Desktop Host Executor gestoppt."
      }).catch(() => undefined);
    }
    processing = false;
    emitStatus({ state: "stopped" });
  },

  setWorkspaceRoot(nextWorkspaceRoot: string | null): void {
    workspaceRoot = nextWorkspaceRoot;
  },

  async runOnce(action: HostAction): Promise<Record<string, unknown>> {
    return dispatchHostAction(action);
  }
};
