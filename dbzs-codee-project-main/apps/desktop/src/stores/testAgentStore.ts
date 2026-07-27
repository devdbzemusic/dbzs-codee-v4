import { create } from "zustand";
import type { AllowedCommand, CommandRunLogs, CommandRunStatus, WorkspaceProjectFile } from "@dbzs/shared";

const POLL_INTERVAL_MS = 250;

type CheckStage = "idle" | "running" | "completed";

interface TestAgentState {
  allowedCommands: AllowedCommand[];
  currentRun: CommandRunStatus | null;
  logs: CommandRunLogs | null;
  history: CommandRunStatus[];
  stage: CheckStage;
  summary: string;
  error: string | null;
  loadAllowedCommands: () => Promise<void>;
  runCommand: (workspaceRoot: string, commandId: string) => Promise<CommandRunStatus | null>;
  runRecommendedChecks: (workspaceRoot: string, files: WorkspaceProjectFile[]) => Promise<void>;
  stopCurrentRun: () => Promise<void>;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function hasFile(files: WorkspaceProjectFile[], name: string): boolean {
  return files.some((file) => file.name.toLowerCase() === name.toLowerCase());
}

export function selectRecommendedCommandIds(files: WorkspaceProjectFile[]): string[] {
  const isNodeWorkspace = hasFile(files, "package.json");
  const usesPnpm = hasFile(files, "pnpm-lock.yaml");
  const isPythonWorkspace = hasFile(files, "pyproject.toml") || files.some((file) => file.language === "python");

  const commands: string[] = [];

  if (isNodeWorkspace) {
    if (usesPnpm) {
      commands.push("pnpm_typecheck", "pnpm_test");
    } else {
      commands.push("npm_run_typecheck", "npm_test");
    }
  }

  if (!isNodeWorkspace && isPythonWorkspace) {
    commands.push(hasFile(files, "pyproject.toml") ? "uv_run_pytest" : "pytest");
  }

  if (commands.length === 0) {
    commands.push("git_status", "git_diff");
  }

  return commands;
}

export const useTestAgentStore = create<TestAgentState>((set, get) => ({
  allowedCommands: [],
  currentRun: null,
  logs: null,
  history: [],
  stage: "idle",
  summary: "",
  error: null,
  loadAllowedCommands: async () => {
    const listAllowedCommands = window.dbzs.listAllowedCommands;
    if (!listAllowedCommands) {
      set({ error: "Command-Bridge ist nicht verfuegbar." });
      return;
    }

    try {
      const allowedCommands = await listAllowedCommands();
      set({ allowedCommands, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Allowlist konnte nicht geladen werden" });
    }
  },
  runCommand: async (workspaceRoot, commandId) => {
    const executeSafeCommand = window.dbzs.executeSafeCommand;
    const getSafeCommandRunStatus = window.dbzs.getSafeCommandRunStatus;
    const streamSafeCommandLogs = window.dbzs.streamSafeCommandLogs;

    if (!executeSafeCommand || !getSafeCommandRunStatus || !streamSafeCommandLogs) {
      set({ error: "Safe-Command-Bridge ist nicht verfuegbar." });
      return null;
    }

    try {
      const started = await executeSafeCommand(workspaceRoot, commandId);
      set({ currentRun: started, stage: "running", logs: null, error: null });

      let current = started;
      while (current.status === "running") {
        const [nextStatus, nextLogs] = await Promise.all([
          getSafeCommandRunStatus(started.runId),
          streamSafeCommandLogs(started.runId)
        ]);
        current = nextStatus;
        set({ currentRun: nextStatus, logs: nextLogs });
        if (current.status !== "running") {
          break;
        }
        await delay(POLL_INTERVAL_MS);
      }

      set((state) => ({
        currentRun: current,
        history: [...state.history, current],
        stage: "completed"
      }));
      return current;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Command konnte nicht ausgefuehrt werden",
        stage: "completed"
      });
      return null;
    }
  },
  runRecommendedChecks: async (workspaceRoot, files) => {
    const commandIds = selectRecommendedCommandIds(files);
    set({ stage: "running", summary: "", error: null });

    const results: Array<{ id: string; status: CommandRunStatus | null }> = [];
    for (const commandId of commandIds) {
      const result = await get().runCommand(workspaceRoot, commandId);
      results.push({ id: commandId, status: result });
    }

    const summary = results
      .map((entry) => `${entry.id}: ${entry.status?.status ?? "failed"}${entry.status?.exitCode !== null && entry.status ? ` (exit ${entry.status.exitCode})` : ""}`)
      .join(" | ");

    set({
      stage: "completed",
      summary
    });
  },
  stopCurrentRun: async () => {
    const runId = get().currentRun?.runId;
    const cancelSafeCommand = window.dbzs.cancelSafeCommand;
    if (!runId || !cancelSafeCommand) {
      return;
    }

    await cancelSafeCommand(runId);
    const currentRun = get().currentRun;
    if (!currentRun) {
      return;
    }

    set({
      currentRun: {
        ...currentRun,
        status: "cancelled",
        cancelled: true,
        finishedAt: new Date().toISOString()
      },
      stage: "completed"
    });
  }
}));
