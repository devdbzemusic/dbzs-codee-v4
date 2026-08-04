import { create } from "zustand";
import { parseStructuredCommandLine } from "@/services/structuredCommandParser";

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  output: string;
  error: string;
  isRunning: boolean;
  commandHistory: string[];
}

interface TerminalExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface TerminalStoreState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  activeView: "terminal" | "logs";
  useWorkspaceRoot: (workspaceRoot: string) => void;
  runCommand: (command: string) => Promise<void>;
  stopActive: () => Promise<void>;
}

function updateActiveSession(
  sessions: TerminalSession[],
  activeSessionId: string | null,
  updater: (session: TerminalSession) => TerminalSession
): TerminalSession[] {
  return sessions.map((session) =>
    session.id === activeSessionId
      ? updater(session)
      : session
  );
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  sessions: [
    {
      id: "terminal-1",
      name: "Terminal 1",
      cwd: "",
      output: "",
      error: "",
      isRunning: false,
      commandHistory: []
    }
  ],
  activeSessionId: "terminal-1",
  activeView: "terminal",
  useWorkspaceRoot: (workspaceRoot) => {
    set((state) => ({
      sessions: updateActiveSession(state.sessions, state.activeSessionId, (session) => ({
        ...session,
        cwd: workspaceRoot
      }))
    }));
  },
  runCommand: async (command) => {
    const cleanCommand = command.trim();
    if (!cleanCommand) {
      return;
    }

    const terminalExec = window.dbzs.terminalExec;
    if (!terminalExec) {
      set((state) => ({
        sessions: updateActiveSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          error: "terminalExec ist nicht verfuegbar."
        }))
      }));
      return;
    }

    const activeSession = get().sessions.find((session) => session.id === get().activeSessionId) ?? null;
    if (!activeSession) {
      return;
    }

    set((state) => ({
      sessions: updateActiveSession(state.sessions, state.activeSessionId, (session) => ({
        ...session,
        isRunning: true,
        error: ""
      }))
    }));

    try {
      const result = (await terminalExec(parseStructuredCommandLine(cleanCommand, activeSession.cwd)));
      const outputChunk = [
        `$ ${cleanCommand}`,
        result.stdout.trim(),
        result.stderr.trim()
      ].filter(Boolean).join("\n");

      set((state) => ({
        sessions: updateActiveSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          isRunning: false,
          output: [session.output, outputChunk].filter(Boolean).join("\n"),
          error: result.code === 0 ? "" : result.stderr,
          commandHistory: [...session.commandHistory, cleanCommand]
        }))
      }));
    } catch (error) {
      set((state) => ({
        sessions: updateActiveSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          isRunning: false,
          error: error instanceof Error ? error.message : "Befehl konnte nicht ausgefuehrt werden",
          commandHistory: [...session.commandHistory, cleanCommand]
        }))
      }));
    }
  },
  stopActive: async () => {
    const activeSession = get().sessions.find((session) => session.id === get().activeSessionId) ?? null;
    if (!activeSession) {
      return;
    }

    const terminalStop = window.dbzs.terminalStop;
    if (terminalStop) {
      await terminalStop(activeSession.id);
    }

    set((state) => ({
      sessions: updateActiveSession(state.sessions, state.activeSessionId, (session) => ({
        ...session,
        isRunning: false
      }))
    }));
  }
}));
