import { create } from "zustand";
import {
  isTerminalAllowlisted,
  listTerminalAllowlist,
  rememberTerminalAllowlist,
  revokeTerminalAllowlist,
  type TerminalAllowlistEntry,
  type TerminalAllowlistMode
} from "@/runtime/tool/terminalAllowlist";

interface TerminalAllowlistState {
  workspaceRoot: string | null;
  entries: TerminalAllowlistEntry[];
  setWorkspaceRoot: (workspaceRoot: string | null) => void;
  refresh: () => void;
  remember: (command: string, mode?: TerminalAllowlistMode) => void;
  revoke: (pattern: string) => void;
  isAllowlisted: (command: string) => boolean;
}

export const useTerminalAllowlistStore = create<TerminalAllowlistState>((set, get) => ({
  workspaceRoot: null,
  entries: [],
  setWorkspaceRoot: (workspaceRoot) => {
    set({
      workspaceRoot,
      entries: workspaceRoot ? listTerminalAllowlist(workspaceRoot) : []
    });
  },
  refresh: () => {
    const workspaceRoot = get().workspaceRoot;
    set({ entries: workspaceRoot ? listTerminalAllowlist(workspaceRoot) : [] });
  },
  remember: (command, mode = "prefix") => {
    const workspaceRoot = get().workspaceRoot;
    if (!workspaceRoot) {
      return;
    }
    rememberTerminalAllowlist(workspaceRoot, command, mode);
    get().refresh();
  },
  revoke: (pattern) => {
    const workspaceRoot = get().workspaceRoot;
    if (!workspaceRoot) {
      return;
    }
    revokeTerminalAllowlist(workspaceRoot, pattern);
    get().refresh();
  },
  isAllowlisted: (command) => {
    const workspaceRoot = get().workspaceRoot;
    if (!workspaceRoot) {
      return false;
    }
    return isTerminalAllowlisted(workspaceRoot, command);
  }
}));
