import type { WorkspaceFile, WorkspaceProjectFile } from "@dbzs/shared";

export interface RuntimeChatContextSnapshot {
  activeFile: WorkspaceFile | null;
  contextHint: string | null;
  workspaceRoot: string | null;
  workspaceName: string | null;
  workspaceFiles: WorkspaceProjectFile[];
}

export interface RuntimeChatWindowState {
  open: boolean;
}
