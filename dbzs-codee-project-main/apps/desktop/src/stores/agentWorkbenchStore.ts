import type {
  AgentActivityFilter,
  AgentEvent,
  AgentFollowUp,
  AgentOutputTab,
  AgentRun,
  AgentRunCreateRequest,
  AgentStep
} from "@dbzs/shared";
import { create } from "zustand";
import { agentHostExecutor, type HostExecutorStatus } from "@/services/agentHostExecutor";
import { agentWorkbenchService } from "@/services/agentWorkbenchService";
import {
  connectAgentWorkbenchSse,
  disconnectAgentWorkbenchSse,
  getAgentWorkbenchSseSequence
} from "@/services/agentWorkbenchSse";
import { reviewGateService } from "@/services/reviewGateService";
import { workspaceScopeId } from "@dbzs/shared";

interface PendingReviewItem {
  gateId: string;
  filePath: string;
  diff: string;
  riskLevel: "low" | "medium" | "high";
  stepId: string | null;
}

interface AgentWorkbenchState {
  runs: AgentRun[];
  selectedRunId: string | null;
  selectedRun: AgentRun | null;
  steps: AgentStep[];
  events: AgentEvent[];
  followUps: AgentFollowUp[];
  pendingReviews: PendingReviewItem[];
  workspaceChangeFiles: string[];
  selectedReviewGateId: string | null;
  activityFilter: AgentActivityFilter;
  outputTab: AgentOutputTab;
  sseConnected: boolean;
  hostExecutorStatus: HostExecutorStatus;
  isLoadingRuns: boolean;
  isLoadingDetail: boolean;
  isMutating: boolean;
  error: string | null;
  newRunGoal: string;
  lastCommandSummary: string | null;
  loadRuns: () => Promise<void>;
  selectRun: (runId: string | null) => Promise<void>;
  createRun: (request: AgentRunCreateRequest) => Promise<AgentRun | null>;
  startSelectedRun: () => Promise<void>;
  pauseSelectedRun: () => Promise<void>;
  resumeSelectedRun: () => Promise<void>;
  acceptResumeBaselineForSelectedRun: () => Promise<void>;
  acceptWorkspaceChangesForSelectedRun: () => Promise<void>;
  cancelSelectedRun: () => Promise<void>;
  submitFollowUp: (text: string) => Promise<void>;
  setActivityFilter: (filter: AgentActivityFilter) => void;
  setOutputTab: (tab: AgentOutputTab) => void;
  setNewRunGoal: (goal: string) => void;
  connectStream: () => void;
  disconnectStream: () => void;
  refreshSelectedRun: () => Promise<void>;
  loadPendingReviews: () => Promise<void>;
  approveReview: (gateId: string, comment?: string) => Promise<void>;
  rejectReview: (gateId: string, reason?: string) => Promise<void>;
  selectReviewGate: (gateId: string | null) => void;
  startHostExecutor: (workspaceRoot: string | null) => void;
  stopHostExecutor: () => void;
  ingestEvent: (event: AgentEvent) => void;
}

function upsertRun(runs: AgentRun[], run: AgentRun): AgentRun[] {
  const index = runs.findIndex((entry) => entry.id === run.id);
  if (index === -1) {
    return [run, ...runs];
  }
  const next = [...runs];
  next[index] = run;
  return next;
}

function mergeEvents(existing: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const map = new Map<number, AgentEvent>();
  for (const event of existing) {
    map.set(event.sequence, event);
  }
  for (const event of incoming) {
    map.set(event.sequence, event);
  }
  return [...map.values()].sort((left, right) => left.sequence - right.sequence);
}

function deriveReviewsFromEvents(events: AgentEvent[]): PendingReviewItem[] {
  return events
    .filter((event) => event.eventType === "file.change_proposed" || event.eventType === "review.requested")
    .map((event) => ({
      gateId:
        (typeof event.payload.review_gate_id === "string" && event.payload.review_gate_id) ||
        (typeof event.payload.file_change_id === "string" && event.payload.file_change_id) ||
        event.id,
      filePath: typeof event.payload.file_path === "string" ? event.payload.file_path : "unknown",
      diff: typeof event.payload.diff === "string" ? event.payload.diff : "",
      riskLevel:
        event.payload.risk_level === "high" || event.payload.risk_level === "low"
          ? event.payload.risk_level
          : "medium",
      stepId: event.stepId
    }));
}

export const useAgentWorkbenchStore = create<AgentWorkbenchState>((set, get) => ({
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  steps: [],
  events: [],
  followUps: [],
  pendingReviews: [],
  workspaceChangeFiles: [],
  selectedReviewGateId: null,
  activityFilter: "all",
  outputTab: "agent",
  sseConnected: false,
  hostExecutorStatus: agentHostExecutor.getStatus(),
  isLoadingRuns: false,
  isLoadingDetail: false,
  isMutating: false,
  error: null,
  newRunGoal: "",
  lastCommandSummary: null,

  loadRuns: async () => {
    set({ isLoadingRuns: true, error: null });
    try {
      const runs = await agentWorkbenchService.listRuns();
      set({ runs, isLoadingRuns: false });
    } catch (error) {
      set({
        isLoadingRuns: false,
        error: error instanceof Error ? error.message : "Runs konnten nicht geladen werden."
      });
    }
  },

  selectRun: async (runId) => {
    get().disconnectStream();
    if (!runId) {
      set({
        selectedRunId: null,
        selectedRun: null,
        steps: [],
        events: [],
        followUps: [],
        pendingReviews: [],
        workspaceChangeFiles: [],
        selectedReviewGateId: null
      });
      return;
    }

    set({ selectedRunId: runId, isLoadingDetail: true, error: null });
    try {
      const detail = await agentWorkbenchService.getRun(runId);
      const eventsResponse = await agentWorkbenchService.listEvents(runId, 0);
      const workspaceChangeFiles =
        detail.run.status === "workspace_review_required"
          ? await agentWorkbenchService.getWorkspaceChanges(runId)
          : [];
      const pendingReviews = deriveReviewsFromEvents(eventsResponse.events);
      set({
        selectedRun: detail.run,
        steps: detail.steps,
        followUps: detail.followUps ?? [],
        events: eventsResponse.events,
        pendingReviews,
        workspaceChangeFiles,
        selectedReviewGateId: pendingReviews[0]?.gateId ?? null,
        isLoadingDetail: false
      });
      get().connectStream();
      await get().loadPendingReviews();
    } catch (error) {
      set({
        isLoadingDetail: false,
        error: error instanceof Error ? error.message : "Run konnte nicht geladen werden."
      });
    }
  },

  createRun: async (request) => {
    set({ isMutating: true, error: null });
    try {
      const run = await agentWorkbenchService.createRun(request);
      set((state) => ({
        runs: upsertRun(state.runs, run),
        newRunGoal: "",
        isMutating: false
      }));
      await get().selectRun(run.id);
      return run;
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Run konnte nicht erstellt werden."
      });
      return null;
    }
  },

  startSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const run = await agentWorkbenchService.startRun(runId);
      set((state) => ({
        selectedRun: run,
        runs: upsertRun(state.runs, run),
        isMutating: false
      }));
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Start fehlgeschlagen."
      });
    }
  },

  pauseSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const run = await agentWorkbenchService.pauseRun(runId);
      set((state) => ({
        selectedRun: run,
        runs: upsertRun(state.runs, run),
        isMutating: false
      }));
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Pause fehlgeschlagen."
      });
    }
  },

  resumeSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const run = await agentWorkbenchService.resumeRun(runId);
      set((state) => ({
        selectedRun: run,
        runs: upsertRun(state.runs, run),
        workspaceChangeFiles: [],
        isMutating: false
      }));
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Resume fehlgeschlagen."
      });
      await get().refreshSelectedRun();
    }
  },

  acceptResumeBaselineForSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const run = await agentWorkbenchService.acceptResumeBaseline(runId);
      set((state) => ({
        selectedRun: run,
        runs: upsertRun(state.runs, run),
        workspaceChangeFiles: [],
        lastCommandSummary: "Resume-Baseline akzeptiert.",
        isMutating: false
      }));
      await get().refreshSelectedRun();
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Resume-Baseline konnte nicht akzeptiert werden."
      });
    }
  },

  acceptWorkspaceChangesForSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const changedFiles = await agentWorkbenchService.getWorkspaceChanges(runId);
      const run = await agentWorkbenchService.acceptWorkspaceChanges(runId, changedFiles);
      set((state) => ({
        selectedRun: run,
        runs: upsertRun(state.runs, run),
        workspaceChangeFiles: [],
        lastCommandSummary: `${changedFiles.length} Workspace-Änderung(en) als neue Resume-Baseline akzeptiert.`,
        isMutating: false
      }));
      await get().refreshSelectedRun();
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Workspace-Änderungen konnten nicht akzeptiert werden."
      });
      await get().refreshSelectedRun();
    }
  },

  cancelSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const run = await agentWorkbenchService.cancelRun(runId);
      set((state) => ({
        selectedRun: run,
        runs: upsertRun(state.runs, run),
        isMutating: false
      }));
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Abbruch fehlgeschlagen."
      });
    }
  },

  submitFollowUp: async (text) => {
    const runId = get().selectedRunId;
    const normalized = text.trim();
    if (!runId || !normalized) {
      return;
    }
    set({ isMutating: true, error: null });
    try {
      const followUp = await agentWorkbenchService.submitFollowUp(runId, normalized);
      set((state) => ({
        followUps: [...state.followUps, followUp],
        isMutating: false
      }));
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Follow-up fehlgeschlagen."
      });
    }
  },

  setActivityFilter: (filter) => set({ activityFilter: filter }),
  setOutputTab: (tab) => set({ outputTab: tab }),
  setNewRunGoal: (goal) => set({ newRunGoal: goal }),

  connectStream: () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    connectAgentWorkbenchSse(runId, getAgentWorkbenchSseSequence(), {
      onConnected: () => set({ sseConnected: true }),
      onDisconnected: () => set({ sseConnected: false }),
      onEvent: (event) => get().ingestEvent(event)
    });
  },

  disconnectStream: () => {
    disconnectAgentWorkbenchSse();
    set({ sseConnected: false });
  },

  refreshSelectedRun: async () => {
    const runId = get().selectedRunId;
    if (!runId) {
      return;
    }
    try {
      const detail = await agentWorkbenchService.getRun(runId);
      const workspaceChangeFiles =
        detail.run.status === "workspace_review_required"
          ? await agentWorkbenchService.getWorkspaceChanges(runId)
          : [];
      set({
        selectedRun: detail.run,
        steps: detail.steps,
        followUps: detail.followUps ?? get().followUps,
        workspaceChangeFiles
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Run-Refresh fehlgeschlagen."
      });
    }
  },

  loadPendingReviews: async () => {
    const run = get().selectedRun;
    if (!run?.jobId) {
      return;
    }
    try {
      const gates = await reviewGateService.listPending({
        jobId: run.jobId,
        workspaceId: workspaceScopeId(run.workspaceRoot)
      });
      const pendingReviews = gates.flatMap((gate) =>
        gate.proposedChanges.map((change) => ({
          gateId: gate.id,
          filePath: change.filePath,
          diff: change.diff,
          riskLevel: change.riskLevel,
          stepId: null
        }))
      );
      set({
        pendingReviews: pendingReviews.length > 0 ? pendingReviews : get().pendingReviews,
        selectedReviewGateId: pendingReviews[0]?.gateId ?? get().selectedReviewGateId
      });
    } catch {
      // keep event-derived reviews as fallback
    }
  },

  approveReview: async (gateId, comment) => {
    set({ isMutating: true, error: null });
    try {
      const run = get().selectedRun;
      if (!run) throw new Error("Kein aktiver Agent-Run.");
      await reviewGateService.approve(
        gateId,
        workspaceScopeId(run.workspaceRoot),
        comment ?? "Freigegeben im Agent Workbench"
      );
      await get().loadPendingReviews();
      await get().refreshSelectedRun();
      set({ isMutating: false });
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Review-Freigabe fehlgeschlagen."
      });
    }
  },

  rejectReview: async (gateId, reason) => {
    set({ isMutating: true, error: null });
    try {
      const run = get().selectedRun;
      if (!run) throw new Error("Kein aktiver Agent-Run.");
      await reviewGateService.reject(
        gateId,
        workspaceScopeId(run.workspaceRoot),
        reason ?? "Abgelehnt im Agent Workbench"
      );
      await get().loadPendingReviews();
      await get().refreshSelectedRun();
      set({ isMutating: false });
    } catch (error) {
      set({
        isMutating: false,
        error: error instanceof Error ? error.message : "Review-Ablehnung fehlgeschlagen."
      });
    }
  },

  selectReviewGate: (gateId) => set({ selectedReviewGateId: gateId }),

  startHostExecutor: (workspaceRoot) => {
    agentHostExecutor.setStatusListener((next) => set({ hostExecutorStatus: next }));
    agentHostExecutor.start(workspaceRoot);
  },

  stopHostExecutor: () => {
    agentHostExecutor.stop();
    set({ hostExecutorStatus: agentHostExecutor.getStatus() });
  },

  ingestEvent: (event) => {
    set((state) => {
      const events = mergeEvents(state.events, [event]);
      const pendingReviews = deriveReviewsFromEvents(events);
      const selectedRun =
        state.selectedRun && state.selectedRun.id === event.runId
          ? { ...state.selectedRun, updatedAt: event.createdAt }
          : state.selectedRun;
      const lastCommandSummary =
        event.eventType.startsWith("command.") ? event.summary : state.lastCommandSummary;
      const workspaceChangeFiles =
        event.eventType === "run.workspace_changes_detected" && Array.isArray(event.payload.changed_files)
          ? event.payload.changed_files.filter((entry): entry is string => typeof entry === "string")
          : state.workspaceChangeFiles;
      return {
        events,
        pendingReviews: pendingReviews.length > 0 ? pendingReviews : state.pendingReviews,
        selectedRun,
        workspaceChangeFiles,
        lastCommandSummary
      };
    });
    if (
      event.eventType.startsWith("run.") ||
      event.eventType.startsWith("step.") ||
      event.eventType === "plan.revised"
    ) {
      void get().refreshSelectedRun();
    }
  }
}));
