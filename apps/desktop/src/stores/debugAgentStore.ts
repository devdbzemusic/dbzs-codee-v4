import { create } from "zustand";
import type {
  CommandRunLogs,
  CommandRunStatus,
  DebugAnalysis,
  GitDiffSummary,
  GitRepositoryStatus,
  ProjectMemory,
  ProposedChange,
  RuntimeStatus,
  WorkspaceProjectFile
} from "@dbzs/shared";
import { agentRunService } from "@/services/agentRunService";
import { AgentOutputParseError, parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import { parseDebugAnalyses } from "@/services/debugAnalysisParser";
import { useEditorStore } from "@/stores/editorStore";

const MAX_RELEVANT_FILES = 4;
const MAX_FILE_CHARS = 12_000;

export interface DebugAgentRequest {
  workspaceRoot: string | null;
  workspaceFiles: WorkspaceProjectFile[];
  projectMemory?: ProjectMemory | null;
  gitRepositoryStatus?: GitRepositoryStatus | null;
  gitDiffSummary?: GitDiffSummary[];
  latestDiff?: string | null;
  relevantFiles?: string[];
  runtimeStatus: RuntimeStatus | null;
  commandRuns: CommandRunStatus[];
  commandLogs: CommandRunLogs | null;
  recentAppliedProposedChanges: ProposedChange[];
}

interface DebugAgentState {
  analyses: DebugAnalysis[];
  summary: string;
  affectedFiles: string[];
  rawLogs: string;
  stdout: string;
  stderr: string;
  lastRun: CommandRunStatus | null;
  generatedProposedChanges: ProposedChange[];
  isAnalyzing: boolean;
  error: string | null;
  inspectLatestRun: (request: DebugAgentRequest) => Promise<void>;
  generateFixSuggestions: (request: DebugAgentRequest) => Promise<void>;
  clear: () => void;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function buildLogText(commandLogs: CommandRunLogs | null): string {
  return [commandLogs?.stdout ?? "", commandLogs?.stderr ?? ""].filter(Boolean).join("\n").trim();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function findWorkspaceFile(workspaceFiles: WorkspaceProjectFile[], affectedPath: string): WorkspaceProjectFile | null {
  const normalizedAffected = normalizePath(affectedPath).toLowerCase();
  return (
    workspaceFiles.find((file) => {
      const filePath = normalizePath(file.path).toLowerCase();
      const relativePath = normalizePath(file.relativePath).toLowerCase();
      return (
        filePath === normalizedAffected ||
        relativePath === normalizedAffected ||
        filePath.endsWith(`/${normalizedAffected}`) ||
        relativePath.endsWith(`/${normalizedAffected}`)
      );
    }) ?? null
  );
}

async function loadRelevantFileSnippets(
  workspaceFiles: WorkspaceProjectFile[],
  affectedFiles: string[]
): Promise<Array<{ path: string; relativePath: string; language: string; content: string }>> {
  const reader = window.dbzs.readProjectFile;
  if (!reader) {
    return [];
  }

  const snippets: Array<{ path: string; relativePath: string; language: string; content: string }> = [];
  for (const affectedPath of affectedFiles.slice(0, MAX_RELEVANT_FILES)) {
    const descriptor = findWorkspaceFile(workspaceFiles, affectedPath);
    if (!descriptor) {
      continue;
    }

    try {
      const file = await reader(descriptor.path);
      if (!file) {
        continue;
      }

      snippets.push({
        path: file.path,
        relativePath: descriptor.relativePath,
        language: file.language,
        content: file.content.slice(0, MAX_FILE_CHARS)
      });
    } catch {
      // Read errors should not block analysis.
    }
  }

  return snippets;
}

function buildAppliedChangesSummary(changes: ProposedChange[]): Array<{
  id: string;
  filePath: string;
  reason: string;
  status: ProposedChange["status"];
}> {
  return changes.map((change) => ({
    id: change.id,
    filePath: change.filePath,
    reason: change.reason,
    status: change.status
  }));
}

function buildDebugPrompt(
  request: DebugAgentRequest,
  analyses: DebugAnalysis[],
  relevantFiles: Array<{ path: string; relativePath: string; language: string; content: string }>
): string {
  const latestRun = request.commandRuns.at(-1) ?? null;
  const commandRuns = request.commandRuns.map((run) => ({
    runId: run.runId,
    commandId: run.commandId,
    label: run.label,
    status: run.status,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    cancelled: run.cancelled,
    finishedAt: run.finishedAt
  }));

  return [
    "[Debug Agent]",
    'Analysiere die Fehlerlage und liefere ausschliesslich JSON im Format {"changes":[...]}.',
    "Keine Erklaerung ausserhalb des JSON.",
    "Keine autonomen Schleifen.",
    "Nur minimale Aenderungen.",
    "Nur Dateien im Workspace.",
    "",
    "Ziel:",
    "Erzeuge ProposedChange[] fuer den kleinsten sicheren Fix.",
    "",
    `Runtime status: ${request.runtimeStatus?.state ?? "unknown"}`,
    `Workspace root: ${request.workspaceRoot ?? "unavailable"}`,
    `Letzter Run: ${latestRun ? `${latestRun.commandId} (${latestRun.status})` : "keiner"}`,
    `Command runs: ${JSON.stringify(commandRuns, null, 2)}`,
    `Analysen: ${JSON.stringify(analyses, null, 2)}`,
    `Project Memory: ${JSON.stringify(
      request.projectMemory
        ? {
            frameworks: request.projectMemory.frameworks,
            languages: request.projectMemory.languages,
            importantFiles: request.projectMemory.importantFiles.slice(0, 8),
            knownIssues: request.projectMemory.knownIssues.slice(0, 6),
            codingPatterns: request.projectMemory.codingPatterns.slice(0, 6)
          }
        : null,
      null,
      2
    )}`,
    `Git Repository Status: ${JSON.stringify(request.gitRepositoryStatus ?? null, null, 2)}`,
    `Git Diff Summary: ${JSON.stringify(request.gitDiffSummary ?? [], null, 2)}`,
    `Aktuell ausgewaehlter Diff: ${request.latestDiff ?? ""}`,
    `Kontext-Dateien (priorisiert): ${JSON.stringify(request.relevantFiles ?? [], null, 2)}`,
    `Letzte angewendete ProposedChanges: ${JSON.stringify(buildAppliedChangesSummary(request.recentAppliedProposedChanges), null, 2)}`,
    `Relevante Workspace-Dateien: ${JSON.stringify(relevantFiles, null, 2)}`,
    `Rohlogs: ${buildLogText(request.commandLogs)}`
  ].join("\n");
}

export const useDebugAgentStore = create<DebugAgentState>((set, get) => ({
  analyses: [],
  summary: "",
  affectedFiles: [],
  rawLogs: "",
  stdout: "",
  stderr: "",
  lastRun: null,
  generatedProposedChanges: [],
  isAnalyzing: false,
  error: null,
  inspectLatestRun: async (request) => {
    const latestRun = request.commandRuns.length > 0 ? request.commandRuns[request.commandRuns.length - 1] : null;
    const rawLogs = buildLogText(request.commandLogs);
    const analyses = parseDebugAnalyses(rawLogs);
    const affectedFiles = dedupe(analyses.flatMap((analysis) => analysis.affectedFiles));

    set({
      analyses,
      summary:
        analyses.length > 0
          ? analyses.map((analysis) => `${analysis.source.toUpperCase()}: ${analysis.summary}`).join(" | ")
          : latestRun
          ? `${latestRun.label} (${latestRun.status})`
          : "Keine Debug-Analyse verfuegbar.",
      affectedFiles,
      rawLogs,
      stdout: request.commandLogs?.stdout ?? "",
      stderr: request.commandLogs?.stderr ?? "",
      lastRun: latestRun,
      error: null
    });
  },
  generateFixSuggestions: async (request) => {
    await get().inspectLatestRun(request);
    const state = get();

    if (state.analyses.length === 0) {
      set({ error: "Keine auswertbaren Fehler gefunden.", generatedProposedChanges: [] });
      return;
    }

    if (!request.workspaceRoot) {
      set({ error: "Kein Workspace aktiv. Debug-Vorschlaege koennen nicht erzeugt werden." });
      return;
    }

    if (request.runtimeStatus?.state !== "running") {
      set({
        error: "Runtime ist nicht aktiv. Debug-Analyse wurde gespeichert, aber kein Fix-Vorschlag kann erzeugt werden."
      });
      return;
    }

    const relevantFiles = await loadRelevantFileSnippets(request.workspaceFiles, state.affectedFiles);
    const prompt = buildDebugPrompt(request, state.analyses, relevantFiles);

    set({ isAnalyzing: true, error: null });
    try {
      const response = await agentRunService.sendChat("debugger", {
        messages: [
          { id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: prompt },
          { id: `msg-${Date.now().toString(36)}-user`, role: "user", content: "Erzeuge jetzt den minimalen Fix-Vorschlag als JSON." }
        ],
        temperature: 0.1,
        max_tokens: 1400
      });

      const proposedChanges = parseAgentOutputToProposedChanges(response.message.content, {
        agentId: "debug-agent",
        workspaceRoot: request.workspaceRoot
      });

      await useEditorStore.getState().queueProposedChanges(proposedChanges);
      set({
        generatedProposedChanges: proposedChanges,
        isAnalyzing: false,
        error: null
      });
    } catch (error) {
      if (error instanceof AgentOutputParseError) {
        set({
          error: `Debug-Vorschlag abgelehnt: ${error.message}`,
          generatedProposedChanges: [],
          isAnalyzing: false
        });
        return;
      }

      set({
        error: error instanceof Error ? error.message : "Debug-Vorschlag konnte nicht erzeugt werden",
        generatedProposedChanges: [],
        isAnalyzing: false
      });
    }
  },
  clear: () =>
    set({
      analyses: [],
      summary: "",
      affectedFiles: [],
      rawLogs: "",
      stdout: "",
      stderr: "",
      lastRun: null,
      generatedProposedChanges: [],
      isAnalyzing: false,
      error: null
    })
}));



