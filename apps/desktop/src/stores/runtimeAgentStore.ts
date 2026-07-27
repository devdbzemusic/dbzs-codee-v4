import { create } from "zustand";
import type { ProposedChange, WorkspaceFile, WorkspaceProjectFile } from "@dbzs/shared";
import type { AgentLoopResult, AgentRunRequest, AgentStep } from "@/runtime/agent/agentContracts";
import type { PatchApprovalCallback } from "@/runtime/agent/agentLoop";
import { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import { RuntimeKernel } from "@/runtime/runtimeKernel";
import type { ToolRequest, ToolResult } from "@/runtime/tool/toolContracts";
import { AgentOutputParseError, parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import { agentRunService } from "@/services/agentRunService";
import {
  buildRuntimeToolRequest,
  ensureRuntimeKernelInitialized,
  getRuntimeKernel,
  runRuntimeTool,
  setRuntimePatchApprovalCallback
} from "@/services/runtimeKernelService";
import { isFileEditorTab, useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

interface RuntimeAgentKernel {
  events: RuntimeEventBus;
  initialize(): Promise<void>;
  runAgent(request: AgentRunRequest, signal: AbortSignal): Promise<AgentLoopResult>;
}

export interface RuntimeProposalApproval {
  id: string;
  runId: string;
  stepId: string;
  stepTitle: string;
  proposalFilePath: string;
  targetFilePath: string;
  summary: string;
  diff: string;
  proposedContent: string;
  createdAt: string;
}

export interface RuntimeAgentTimelineEntry {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

export interface RuntimeAgentPersistedState {
  pendingApproval: RuntimeProposalApproval | null;
  pendingApplyApproval: RuntimeApplyApproval | null;
  timeline: RuntimeAgentTimelineEntry[];
  lastResult: AgentLoopResult | null;
  updatedAt: string;
}

export interface RuntimeApplyApproval {
  id: string;
  filePaths: string[];
  changeIds: string[];
  summary: string;
  createdAt: string;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function selectRelevantWorkspaceFiles(
  workspaceFiles: WorkspaceProjectFile[],
  targetFilePath: string
): WorkspaceProjectFile[] {
  const normalizedTarget = normalizePath(targetFilePath).toLowerCase();
  const fileName = normalizedTarget.split("/").at(-1) ?? normalizedTarget;
  const parentDirectory = normalizedTarget.includes("/")
    ? normalizedTarget.slice(0, normalizedTarget.lastIndexOf("/"))
    : "";

  return workspaceFiles
    .map((file) => {
      const relativePath = normalizePath(file.relativePath).toLowerCase();
      let score = 0;
      if (relativePath === normalizedTarget) {
        score += 10;
      }
      if (relativePath.endsWith(`/${fileName}`) || file.name.toLowerCase() === fileName) {
        score += 4;
      }
      if (parentDirectory && relativePath.startsWith(parentDirectory)) {
        score += 2;
      }
      return { file, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => entry.file);
}

async function loadWorkspaceFile(filePath: string): Promise<WorkspaceFile | null> {
  const reader = window.dbzs.readProjectFile;
  if (!reader) {
    return null;
  }

  try {
    return await reader(filePath);
  } catch {
    return null;
  }
}

function buildImplementationPrompt(
  approval: RuntimeProposalApproval,
  workspaceRoot: string,
  targetFile: WorkspaceFile | null,
  activeFile: WorkspaceFile | null,
  relevantFiles: WorkspaceProjectFile[]
): string {
  const relevantFileList = relevantFiles.map((file) => file.relativePath);
  return [
    "[Runtime Agent Follow-Apply]",
    'Liefere ausschliesslich JSON im Format {"changes":[{"filePath":"...","proposedContent":"...","reason":"..."}]}.',
    "Keine Erklaerung ausserhalb des JSON.",
    "Nur Dateien im Workspace.",
    "Erzeuge die kleinste sichere Menge konkreter Workspace-Aenderungen aus dem freigegebenen Proposal.",
    `Workspace root: ${workspaceRoot}`,
    `Ziel-Datei: ${approval.targetFilePath}`,
    `Proposal-Datei: ${approval.proposalFilePath}`,
    `Summary: ${approval.summary}`,
    `Relevante Dateien: ${JSON.stringify(relevantFileList, null, 2)}`,
    `Preview-Diff: ${approval.diff || "-"}`,
    "Freigegebenes Proposal:",
    approval.proposedContent,
    "Aktueller Inhalt der Ziel-Datei:",
    targetFile?.content.slice(0, 12000) ?? "Nicht verfuegbar.",
    activeFile && activeFile.path !== targetFile?.path
      ? [
          "Aktive Datei im Editor:",
          `${activeFile.path} (${activeFile.language})`,
          activeFile.content.slice(0, 8000)
        ].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface RuntimeAgentStoreDependencies {
  createKernel: (requestPatchApproval: PatchApprovalCallback) => RuntimeAgentKernel;
  now: () => string;
  createId: (prefix: string) => string;
  materializeApprovedProposal: (
    approval: RuntimeProposalApproval,
    workspaceRoot: string
  ) => Promise<ProposedChange[]>;
  applyPreparedChanges: (
    approval: RuntimeApplyApproval,
    workspaceRoot: string
  ) => Promise<void>;
  loadPersistedState: (workspaceRoot: string) => Promise<RuntimeAgentPersistedState | null>;
  savePersistedState: (workspaceRoot: string, state: RuntimeAgentPersistedState) => Promise<void>;
}

interface RuntimeAgentState {
  isRunning: boolean;
  isMaterializingApproval: boolean;
  isApplyingChanges: boolean;
  error: string | null;
  lastResult: AgentLoopResult | null;
  pendingApproval: RuntimeProposalApproval | null;
  pendingApplyApproval: RuntimeApplyApproval | null;
  timeline: RuntimeAgentTimelineEntry[];
  loadPersistedState: (workspaceRoot: string | null) => Promise<void>;
  runGoal: (goal: string, workspaceRoot: string | null) => Promise<void>;
  runTool: (request: ToolRequest) => Promise<ToolResult>;
  approvePendingApproval: () => Promise<void>;
  approvePendingApplyApproval: () => Promise<void>;
  rejectPendingApplyApproval: () => void;
  rejectPendingApproval: () => void;
  cancelRun: () => void;
  clearError: () => void;
}

function defaultCreateKernel(requestPatchApproval: PatchApprovalCallback): RuntimeAgentKernel {
  setRuntimePatchApprovalCallback(requestPatchApproval);
  return getRuntimeKernel();
}

async function defaultMaterializeApprovedProposal(
  approval: RuntimeProposalApproval,
  workspaceRoot: string
): Promise<ProposedChange[]> {
  const workspaceFiles = useWorkspaceStore.getState().files;
  const activeTab = useEditorStore.getState().activeTab;
  const activeFile = isFileEditorTab(activeTab) ? activeTab : null;
  const targetFile = await loadWorkspaceFile(approval.targetFilePath);
  const relevantFiles = selectRelevantWorkspaceFiles(workspaceFiles, approval.targetFilePath);

  const response = await agentRunService.sendChat("coder", {
    messages: [
      {
        id: `msg-${Date.now().toString(36)}-sys`,
        role: "system",
        content: buildImplementationPrompt(approval, workspaceRoot, targetFile, activeFile, relevantFiles)
      },
      {
        id: `msg-${Date.now().toString(36)}-user`,
        role: "user",
        content: "Erzeuge jetzt die konkreten changes als JSON."
      }
    ],
    file_context: targetFile
      ? {
          path: targetFile.path,
          language: targetFile.language,
          content: targetFile.content.slice(0, 16000)
        }
      : undefined,
    temperature: 0.1,
    max_tokens: 1800
  });

  return parseAgentOutputToProposedChanges(response.message.content, {
    agentId: "runtime-agent",
    workspaceRoot
  });
}

async function defaultLoadPersistedState(
  workspaceRoot: string
): Promise<RuntimeAgentPersistedState | null> {
  const reader = window.dbzs.getRuntimeAgentState;
  if (!reader) {
    return null;
  }
  return reader(workspaceRoot) as Promise<RuntimeAgentPersistedState | null>;
}

async function defaultSavePersistedState(
  workspaceRoot: string,
  state: RuntimeAgentPersistedState
): Promise<void> {
  const writer = window.dbzs.setRuntimeAgentState;
  if (!writer) {
    return;
  }
  await writer(workspaceRoot, state);
}

async function defaultApplyPreparedChanges(
  approval: RuntimeApplyApproval,
  _workspaceRoot: string
): Promise<void> {
  const uniqueFilePaths = Array.from(new Set(approval.filePaths));
  if (uniqueFilePaths.length === 0) {
    return;
  }

  for (const filePath of uniqueFilePaths) {
    await useEditorStore.getState().applyPendingChange(filePath);
  }
}

export function createRuntimeAgentStore(
  dependencies: Partial<RuntimeAgentStoreDependencies> = {}
) {
  const resolvedDependencies: RuntimeAgentStoreDependencies = {
    createKernel: defaultCreateKernel,
    now: () => new Date().toISOString(),
    createId,
    materializeApprovedProposal: defaultMaterializeApprovedProposal,
    applyPreparedChanges: defaultApplyPreparedChanges,
    loadPersistedState: defaultLoadPersistedState,
    savePersistedState: defaultSavePersistedState,
    ...dependencies
  };

  let abortController: AbortController | null = null;
  let currentWorkspaceRoot: string | null = null;
  let resolvePendingApproval: ((approved: boolean) => void) | null = null;

  function toPersistedState(state: RuntimeAgentState): RuntimeAgentPersistedState {
    return {
      pendingApproval: state.pendingApproval,
      pendingApplyApproval: state.pendingApplyApproval,
      timeline: state.timeline,
      lastResult: state.lastResult,
      updatedAt: resolvedDependencies.now()
    };
  }

  function addTimeline(
    setState: (updater: (state: RuntimeAgentState) => Partial<RuntimeAgentState>) => void,
    title: string,
    description: string
  ): void {
    const createdAt = resolvedDependencies.now();
    setState((state) => ({
      timeline: [
        {
          id: resolvedDependencies.createId("runtime-agent-event"),
          title,
          description,
          createdAt
        },
        ...state.timeline
      ].slice(0, 24)
    }));
  }

  return create<RuntimeAgentState>((set, get) => ({
    isRunning: false,
    isMaterializingApproval: false,
    isApplyingChanges: false,
    error: null,
    lastResult: null,
    pendingApproval: null,
    pendingApplyApproval: null,
    timeline: [],
    loadPersistedState: async (workspaceRoot) => {
      currentWorkspaceRoot = workspaceRoot;
      if (!workspaceRoot) {
        set({
          isRunning: false,
          isMaterializingApproval: false,
          isApplyingChanges: false,
          error: null,
          lastResult: null,
          pendingApproval: null,
          pendingApplyApproval: null,
          timeline: []
        });
        return;
      }

      const persisted = await resolvedDependencies.loadPersistedState(workspaceRoot);
      set({
        isRunning: false,
        isMaterializingApproval: false,
        isApplyingChanges: false,
        error: null,
        lastResult: persisted?.lastResult ?? null,
        pendingApproval: persisted?.pendingApproval ?? null,
        pendingApplyApproval: persisted?.pendingApplyApproval ?? null,
        timeline: persisted?.timeline ?? []
      });
    },
    runTool: async (request) => {
      await ensureRuntimeKernelInitialized();
      return runRuntimeTool(request);
    },
    runGoal: async (goal, workspaceRoot) => {
      const normalizedGoal = goal.trim();
      if (!workspaceRoot) {
        set({ error: "Kein Workspace aktiv." });
        return;
      }
      if (!normalizedGoal) {
        set({ error: "Bitte ein Ziel fuer den Runtime Agent eingeben." });
        return;
      }
      if (get().isRunning) {
        set({ error: "Runtime Agent laeuft bereits." });
        return;
      }

      currentWorkspaceRoot = workspaceRoot;

      async function persistState(): Promise<void> {
        if (!currentWorkspaceRoot) {
          return;
        }
        await resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      }

      const requestPatchApproval: PatchApprovalCallback = async (
        runRequest: AgentRunRequest,
        step: AgentStep,
        patchResult: ToolResult,
        toolRequest: ToolRequest
      ) => {
        const output = (patchResult.output ?? {}) as {
          filePath?: unknown;
          diff?: unknown;
          afterContent?: unknown;
        };
        const input = (toolRequest.input ?? {}) as {
          targetPath?: unknown;
          summary?: unknown;
        };

        const approval: RuntimeProposalApproval = {
          id: resolvedDependencies.createId("runtime-agent-approval"),
          runId: runRequest.runId,
          stepId: step.id,
          stepTitle: step.title,
          proposalFilePath: String(output.filePath ?? ""),
          targetFilePath: String(input.targetPath ?? output.filePath ?? ""),
          summary: String(input.summary ?? step.objective),
          diff: String(output.diff ?? ""),
          proposedContent: String(output.afterContent ?? ""),
          createdAt: resolvedDependencies.now()
        };

        set({ pendingApproval: approval });
        addTimeline(
          set,
          "Approval angefordert",
          `${step.title}: ${approval.targetFilePath || approval.proposalFilePath || "Proposal"}`
        );
        void persistState();

        return new Promise<boolean>((resolve) => {
          resolvePendingApproval = resolve;
        });
      };

      const kernel = resolvedDependencies.createKernel(requestPatchApproval);
      const unsubscribeHandlers = [
        kernel.events.on("agent.plan.created", (event) => {
          const payload = event.payload as { summary?: string };
          addTimeline(set, "Plan erstellt", payload.summary ?? "Neuer Laufplan erstellt.");
          void persistState();
        }),
        kernel.events.on("agent.step.completed", (event) => {
          const payload = event.payload as { stepTitle?: string };
          addTimeline(set, "Schritt abgeschlossen", payload.stepTitle ?? "Agent-Schritt beendet.");
          void persistState();
        }),
        kernel.events.on("agent.run.completed", (event) => {
          const payload = event.payload as AgentLoopResult;
          addTimeline(set, "Lauf beendet", `${payload.status} · Schritte ${payload.stepsExecuted}`);
          void persistState();
        })
      ];

      abortController = new AbortController();
      set({
        isRunning: true,
        isMaterializingApproval: false,
        isApplyingChanges: false,
        error: null,
        lastResult: null,
        pendingApproval: null,
        pendingApplyApproval: null,
        timeline: []
      });
      void persistState();

      try {
        await kernel.initialize();
        const result = await kernel.runAgent(
          {
            runId: resolvedDependencies.createId("runtime-run"),
            actorId: "runtime-agent-ui",
            goal: normalizedGoal,
            mode: "agent",
            role: "coder",
            workspaceRoot
          },
          abortController.signal
        );

        set({
          lastResult: result,
          isRunning: false,
          isMaterializingApproval: false,
          isApplyingChanges: false,
          pendingApproval: null
        });
        await persistState();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Runtime Agent konnte nicht ausgefuehrt werden.",
          isRunning: false,
          isMaterializingApproval: false,
          isApplyingChanges: false,
          pendingApproval: null
        });
        await persistState();
      } finally {
        abortController = null;
        resolvePendingApproval = null;
        unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
      }
    },
    approvePendingApproval: async () => {
      const pendingApproval = get().pendingApproval;
      if (!pendingApproval || !currentWorkspaceRoot) {
        return;
      }

      set({ isMaterializingApproval: true, error: null });

      try {
        const concreteChanges = await resolvedDependencies.materializeApprovedProposal(
          pendingApproval,
          currentWorkspaceRoot
        );
        await useEditorStore.getState().queueProposedChanges(concreteChanges);

        const pendingApplyApproval: RuntimeApplyApproval = {
          id: resolvedDependencies.createId("runtime-agent-apply-approval"),
          filePaths: concreteChanges.map((change) => change.filePath),
          changeIds: concreteChanges.map((change) => change.id),
          summary: pendingApproval.summary,
          createdAt: resolvedDependencies.now()
        };

        set({
          pendingApproval: null,
          pendingApplyApproval,
          isMaterializingApproval: false
        });
        addTimeline(
          set,
          "Approval freigegeben",
          pendingApproval.targetFilePath || pendingApproval.proposalFilePath
        );
        addTimeline(
          set,
          "Konkrete Aenderungen vorbereitet",
          `${concreteChanges.length} Change(s) in die Pending-Change-Queue uebernommen.`
        );
        addTimeline(
          set,
          "Restore-Point-Gate offen",
          `${pendingApplyApproval.filePaths.length} Datei(en) warten auf Auto-Apply-Freigabe.`
        );

        await resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));

        resolvePendingApproval?.(true);
        resolvePendingApproval = null;
      } catch (error) {
        const message =
          error instanceof AgentOutputParseError
            ? `Konkrete Aenderungen konnten nicht erzeugt werden: ${error.message}`
            : error instanceof Error
              ? error.message
              : "Konkrete Aenderungen konnten nicht erzeugt werden.";

        set({ error: message, isMaterializingApproval: false });
        addTimeline(set, "Follow-Apply fehlgeschlagen", message);
        await resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      }
    },
    approvePendingApplyApproval: async () => {
      const pendingApplyApproval = get().pendingApplyApproval;
      if (!pendingApplyApproval || !currentWorkspaceRoot) {
        return;
      }

      set({ isApplyingChanges: true, error: null });
      try {
        await resolvedDependencies.applyPreparedChanges(pendingApplyApproval, currentWorkspaceRoot);
        set({ pendingApplyApproval: null, isApplyingChanges: false });
        addTimeline(
          set,
          "Auto-Apply freigegeben",
          `${pendingApplyApproval.filePaths.length} Datei(en) angewendet.`
        );
        await resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Runtime Agent Auto-Apply konnte nicht ausgefuehrt werden.";
        set({ isApplyingChanges: false, error: message });
        addTimeline(set, "Auto-Apply fehlgeschlagen", message);
        await resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      }
    },
    rejectPendingApplyApproval: () => {
      const pendingApplyApproval = get().pendingApplyApproval;
      if (!pendingApplyApproval) {
        return;
      }

      set({ pendingApplyApproval: null, isApplyingChanges: false });
      addTimeline(
        set,
        "Auto-Apply abgelehnt",
        `${pendingApplyApproval.filePaths.length} Datei(en) bleiben als Pending Changes erhalten.`
      );
      if (currentWorkspaceRoot) {
        void resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      }
    },
    rejectPendingApproval: () => {
      const pendingApproval = get().pendingApproval;
      const resolver = resolvePendingApproval;
      if (!pendingApproval) {
        return;
      }

      resolvePendingApproval = null;
      set({ pendingApproval: null, pendingApplyApproval: null, isMaterializingApproval: false });
      addTimeline(set, "Approval abgelehnt", pendingApproval.targetFilePath || pendingApproval.proposalFilePath);
      if (currentWorkspaceRoot) {
        void resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      }
      resolver?.(false);
    },
    cancelRun: () => {
      abortController?.abort();
      if (resolvePendingApproval) {
        resolvePendingApproval(false);
        resolvePendingApproval = null;
      }
      set({
        isRunning: false,
        isMaterializingApproval: false,
        isApplyingChanges: false,
        pendingApproval: null
      });
      addTimeline(set, "Lauf abgebrochen", "Runtime Agent wurde abgebrochen.");
      if (currentWorkspaceRoot) {
        void resolvedDependencies.savePersistedState(currentWorkspaceRoot, toPersistedState(get()));
      }
    },
    clearError: () => set({ error: null })
  }));
}

export const useRuntimeAgentStore = createRuntimeAgentStore();

export { buildRuntimeToolRequest };





