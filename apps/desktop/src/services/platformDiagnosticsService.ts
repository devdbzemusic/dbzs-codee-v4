import { backendClient } from "@/services/backendClient";
import type { RuntimeChatContextSnapshot } from "@/types/runtimeChatWindow";
import { trajectoryService } from "@/services/trajectoryService";
import type { TrajectoryEvent } from "@dbzs/shared";

export type PlatformCheckStatus = "ok" | "warn" | "error";

export interface PlatformCheckRow {
  id: string;
  label: string;
  status: PlatformCheckStatus;
  detail: string;
}

export interface PlatformDiagnosticsSnapshot {
  checkedAt: string;
  backendHealth: PlatformCheckRow;
  trajectoryIpc: PlatformCheckRow;
  workspaceScan: PlatformCheckRow;
  chatContextIpc: PlatformCheckRow;
  recentTrajectoryCount: number;
  recentTrajectoryError: string | null;
  chatContext: RuntimeChatContextSnapshot | null;
  recentEvents: TrajectoryEvent[];
}

async function checkBackendHealth(): Promise<PlatformCheckRow> {
  try {
    const health = await backendClient.getBackendHealth();
    const ok = health.status === "ok";
    return {
      id: "backend-health",
      label: "Backend Health",
      status: ok ? "ok" : "warn",
      detail: ok ? `Port erreichbar (${health.status})` : `Status: ${health.status}`
    };
  } catch (error) {
    return {
      id: "backend-health",
      label: "Backend Health",
      status: "error",
      detail: error instanceof Error ? error.message : "Backend nicht erreichbar"
    };
  }
}

async function checkTrajectoryIpc(): Promise<{ row: PlatformCheckRow; events: TrajectoryEvent[]; error: string | null }> {
  try {
    const events = await trajectoryService.listRecentTrajectories(8);
    return {
      row: {
        id: "trajectory-ipc",
        label: "ATIF-light / Trajectory IPC",
        status: "ok",
        detail: `${events.length} recent Event(s) über Electron-Bridge geladen`
      },
      events,
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trajectory IPC fehlgeschlagen";
    return {
      row: {
        id: "trajectory-ipc",
        label: "ATIF-light / Trajectory IPC",
        status: "error",
        detail: message
      },
      events: [],
      error: message
    };
  }
}

async function checkChatContextIpc(): Promise<{ row: PlatformCheckRow; context: RuntimeChatContextSnapshot | null }> {
  try {
    const context = window.dbzs.getRuntimeChatContext ? await window.dbzs.getRuntimeChatContext() : null;
    const fileCount = context?.workspaceFiles?.length ?? 0;
    const hasRoot = Boolean(context?.workspaceRoot);
    return {
      row: {
        id: "chat-context-ipc",
        label: "Runtime Chat Kontext (IPC Snapshot)",
        status: !hasRoot ? "warn" : fileCount > 0 ? "ok" : "warn",
        detail: hasRoot
          ? `${context?.workspaceName ?? "Workspace"} · ${fileCount} Dateien · active: ${context?.activeFile?.name ?? "keine"}`
          : "Kein Workspace im IPC-Snapshot"
      },
      context
    };
  } catch (error) {
    return {
      row: {
        id: "chat-context-ipc",
        label: "Runtime Chat Kontext (IPC Snapshot)",
        status: "error",
        detail: error instanceof Error ? error.message : "IPC-Snapshot nicht lesbar"
      },
      context: null
    };
  }
}

export async function collectPlatformDiagnostics(params: {
  workspaceRoot: string | null;
  workspaceFileCount: number;
}): Promise<PlatformDiagnosticsSnapshot> {
  const [backendHealth, trajectory, chatContext] = await Promise.all([
    checkBackendHealth(),
    checkTrajectoryIpc(),
    checkChatContextIpc()
  ]);

  const workspaceScan: PlatformCheckRow = !params.workspaceRoot
    ? {
        id: "workspace-scan",
        label: "Workspace Sync",
        status: "warn",
        detail: "Kein Projekt geöffnet"
      }
    : params.workspaceFileCount === 0
      ? {
          id: "workspace-scan",
          label: "Workspace Sync",
          status: "warn",
          detail: `${params.workspaceRoot} · 0 Dateien im Scan`
        }
      : {
          id: "workspace-scan",
          label: "Workspace Sync",
          status: "ok",
          detail: `${params.workspaceRoot} · ${params.workspaceFileCount} Dateien im Scan`
        };

  return {
    checkedAt: new Date().toISOString(),
    backendHealth,
    trajectoryIpc: trajectory.row,
    workspaceScan,
    chatContextIpc: chatContext.row,
    recentTrajectoryCount: trajectory.events.length,
    recentTrajectoryError: trajectory.error,
    chatContext: chatContext.context,
    recentEvents: trajectory.events
  };
}
