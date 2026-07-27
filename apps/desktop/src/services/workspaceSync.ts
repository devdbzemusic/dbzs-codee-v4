import type { WorkspaceState } from "@dbzs/shared";

export interface WorkspaceSyncPayload {
  projectPath: string;
  projectName: string | null;
  fileCount: number;
}

type WorkspaceSyncListener = (payload: WorkspaceSyncPayload) => void;

const listeners = new Set<WorkspaceSyncListener>();

export function onWorkspaceSynced(listener: WorkspaceSyncListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyWorkspaceSynced(state: WorkspaceState, fileCount: number): void {
  if (!state.projectPath) {
    return;
  }

  const payload: WorkspaceSyncPayload = {
    projectPath: state.projectPath,
    projectName: state.projectName,
    fileCount
  };

  for (const listener of listeners) {
    listener(payload);
  }
}
