import { create } from "zustand";
import type {
  JobArtifactCreateRequest,
  JobClaimRequest,
  JobDetail,
  JobEnqueueRequest,
  JobRecord,
  JobStatus,
  JobVerifyRequest,
  JobWaypointRequest
} from "@dbzs/shared";
import { backendClient } from "../services/backendClient";
import { useToastStore } from "./toastStore";
import { connectToSse, disconnectFromSse, type SseJobUpdatePayload } from "../services/sseClient";

export type JobStatusFilter = JobStatus | "all";

interface JobSpoolerState {
  jobs: JobRecord[];
  selectedJobId: string | null;
  selectedJob: JobRecord | null;
  selectedJobDetail: JobDetail | null;
  selectedStatus: JobStatusFilter;
  isLoading: boolean;
  isDetailLoading: boolean;
  isMutating: boolean;
  error: string | null;
  sseConnected: boolean;
  loadJobs: () => Promise<void>;
  loadJobDetail: (jobId?: string) => Promise<void>;
  selectJob: (jobId: string | null) => Promise<void>;
  setStatusFilter: (status: JobStatusFilter) => void;
  enqueueJob: (request: JobEnqueueRequest) => Promise<void>;
  claimNextJob: (request: JobClaimRequest) => Promise<void>;
  addWaypoint: (request: JobWaypointRequest, jobId?: string) => Promise<void>;
  addArtifact: (request: JobArtifactCreateRequest, jobId?: string) => Promise<void>;
  verifySelectedJob: (request: JobVerifyRequest, jobId?: string) => Promise<void>;
  requeueStaleJobs: () => Promise<void>;
  clearAllJobs: () => Promise<void>;
  pruneFinishedJobs: () => Promise<void>;
  connectSse: () => void;
  disconnectSse: () => void;
  handleSseUpdate: (payload: SseJobUpdatePayload) => void;
}

function sortJobs(left: JobRecord, right: JobRecord): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return right.created_at.localeCompare(left.created_at);
}

function upsertJob(jobs: JobRecord[], next: JobRecord): JobRecord[] {
  const index = jobs.findIndex((job) => job.id === next.id);
  if (index === -1) {
    return [next, ...jobs].sort(sortJobs);
  }

  const copy = [...jobs];
  copy[index] = next;
  return copy.sort(sortJobs);
}

function getJobFilter(status: JobStatusFilter): JobStatus | undefined {
  return status === "all" ? undefined : status;
}

export const useJobSpoolerStore = create<JobSpoolerState>((set, get) => ({
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  selectedJobDetail: null,
  selectedStatus: "all",
  isLoading: false,
  isDetailLoading: false,
  isMutating: false,
  error: null,
  sseConnected: false,
  loadJobs: async () => {
    set({ isLoading: true, error: null });
    try {
      const jobs = await backendClient.listJobs(getJobFilter(get().selectedStatus), 30);
      const sortedJobs = jobs.sort(sortJobs);
      const selectedJobId = get().selectedJobId ?? sortedJobs[0]?.id ?? null;
      const selectedJob = selectedJobId ? sortedJobs.find((job) => job.id === selectedJobId) ?? null : null;

      set({ jobs: sortedJobs, selectedJobId, selectedJob, isLoading: false });

      if (selectedJobId) {
        await get().loadJobDetail(selectedJobId);
      } else {
        set({ selectedJobDetail: null, isDetailLoading: false });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Job-Spooler konnte nicht geladen werden",
        isLoading: false
      });
    }
  },
  loadJobDetail: async (jobId) => {
    const resolvedJobId = jobId ?? get().selectedJobId;
    if (!resolvedJobId) {
      set({ selectedJobDetail: null, isDetailLoading: false });
      return;
    }

    set({ isDetailLoading: true, error: null });
    try {
      const detail = await backendClient.getJobDetail(resolvedJobId);
      const jobs = upsertJob(get().jobs, detail.job);
      const selectedJob = jobs.find((job) => job.id === detail.job.id) ?? detail.job;

      set({
        jobs,
        selectedJobId: detail.job.id,
        selectedJob,
        selectedJobDetail: detail,
        isDetailLoading: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Job-Detail konnte nicht geladen werden",
        isDetailLoading: false
      });
    }
  },
  selectJob: async (jobId) => {
    if (!jobId) {
      set({ selectedJobId: null, selectedJob: null, selectedJobDetail: null });
      return;
    }

    const selectedJob = get().jobs.find((job) => job.id === jobId) ?? null;
    set({ selectedJobId: jobId, selectedJob, selectedJobDetail: null });
    await get().loadJobDetail(jobId);
  },
  setStatusFilter: (status) => {
    set({ selectedStatus: status });
  },
  enqueueJob: async (request) => {
    set({ isMutating: true, error: null });
    try {
      const job = await backendClient.enqueueJob(request);
      const jobs = upsertJob(get().jobs, job);
      set({ jobs, selectedJobId: job.id, selectedJob: job });
      await get().loadJobDetail(job.id);
      useToastStore.getState().success(`Job erstellt: ${job.title}`, `Status: queued · P${job.priority}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Job konnte nicht erstellt werden";
      set({ error: msg });
      useToastStore.getState().error("Job konnte nicht erstellt werden", msg);
    } finally {
      set({ isMutating: false });
    }
  },
  claimNextJob: async (request) => {
    set({ isMutating: true, error: null });
    try {
      const response = await backendClient.claimNextJob(request);
      const claimedJob = response.job;

      if (claimedJob) {
        set((state) => ({
          jobs: upsertJob(state.jobs, claimedJob),
          selectedJobId: claimedJob.id,
          selectedJob: claimedJob
        }));
        await get().loadJobDetail(claimedJob.id);
      } else {
        await get().loadJobs();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Job konnte nicht geclaimt werden"
      });
    } finally {
      set({ isMutating: false });
    }
  },
  addWaypoint: async (request, jobId) => {
    const selectedJobId = jobId ?? get().selectedJobId;
    if (!selectedJobId) {
      set({ error: "Kein Job ausgewählt." });
      return;
    }

    set({ isMutating: true, error: null });
    try {
      await backendClient.addJobWaypoint(selectedJobId, request);
      await get().loadJobDetail(selectedJobId);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Waypoint konnte nicht gespeichert werden"
      });
    } finally {
      set({ isMutating: false });
    }
  },
  addArtifact: async (request, jobId) => {
    const selectedJobId = jobId ?? get().selectedJobId;
    if (!selectedJobId) {
      set({ error: "Kein Job ausgewählt." });
      return;
    }

    set({ isMutating: true, error: null });
    try {
      await backendClient.addJobArtifact(selectedJobId, request);
      await get().loadJobDetail(selectedJobId);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Artefakt konnte nicht gespeichert werden"
      });
    } finally {
      set({ isMutating: false });
    }
  },
  verifySelectedJob: async (request, jobId) => {
    const selectedJobId = jobId ?? get().selectedJobId;
    if (!selectedJobId) {
      set({ error: "Kein Job ausgewählt." });
      return;
    }

    set({ isMutating: true, error: null });
    try {
      await backendClient.verifyJob(selectedJobId, request);
      await get().loadJobDetail(selectedJobId);
      const verdict = request.verdict === "passed" ? "Bestanden" : "Fehlgeschlagen";
      useToastStore.getState().info(`Verifikation: ${verdict}`, `Job ${selectedJobId.slice(0, 8)}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Verifikation konnte nicht gespeichert werden";
      set({ error: msg });
      useToastStore.getState().error("Verifikation fehlgeschlagen", msg);
    } finally {
      set({ isMutating: false });
    }
  },
  requeueStaleJobs: async () => {
    set({ isMutating: true, error: null });
    try {
      await backendClient.requeueStaleJobs();
      await get().loadJobs();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Stale Jobs konnten nicht neu eingereiht werden"
      });
    } finally {
      set({ isMutating: false });
    }
  },
  clearAllJobs: async () => {
    set({ isMutating: true, error: null });
    try {
      if (backendClient.clearAllJobs) {
        await backendClient.clearAllJobs();
      }
      set({ selectedJobId: null, selectedJob: null, selectedJobDetail: null });
      await get().loadJobs();
      useToastStore.getState().success("Job-Queue geleert", "Alle Einträge wurden vollständig gelöscht.");
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Jobs konnten nicht gelöscht werden"
      });
    } finally {
      set({ isMutating: false });
    }
  },
  pruneFinishedJobs: async () => {
    set({ isMutating: true, error: null });
    try {
      if (backendClient.pruneFinishedJobs) {
        await backendClient.pruneFinishedJobs();
      }
      const activeRunningSelected = get().selectedJob && ["queued", "claimed", "running", "waiting_verification"].includes(get().selectedJob!.status);
      if (!activeRunningSelected) {
        set({ selectedJobId: null, selectedJob: null, selectedJobDetail: null });
      }
      await get().loadJobs();
      useToastStore.getState().success("Job-Queue bereinigt", "Terminierte (completed/failed) und abgebrochene Jobs gelöscht.");
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Erledigte Jobs konnten nicht entfernt werden"
      });
    } finally {
      set({ isMutating: false });
    }
  },
  connectSse: () => {
    if (get().sseConnected) return;
    
    connectToSse((payload: SseJobUpdatePayload) => {
      get().handleSseUpdate(payload);
    });
    set({ sseConnected: true });
  },
  disconnectSse: () => {
    disconnectFromSse();
    set({ sseConnected: false });
  },
  handleSseUpdate: (payload: SseJobUpdatePayload) => {
    const { job: updatedJob } = payload;
    const jobs = get().jobs;
    const existingIndex = jobs.findIndex((j) => j.id === updatedJob.id);
    
    if (existingIndex >= 0) {
      // Job existiert bereits – aktualisieren
      const updatedJobs = [...jobs];
      updatedJobs[existingIndex] = {
        ...updatedJobs[existingIndex],
        status: updatedJob.status as JobStatus,
        priority: updatedJob.priority,
        assigned_agent_role: updatedJob.assigned_agent_role ?? null,
        updated_at: updatedJob.updated_at
      };
      set({ jobs: updatedJobs.sort(sortJobs) });
      console.log(`[SSE] Job ${updatedJob.id} aktualisiert: ${updatedJob.status}`);
    } else {
      // Neuer Job – zur Liste hinzufügen (mit Default-Werten für nicht-gelieferte Felder)
      const newJob: JobRecord = {
        id: updatedJob.id,
        title: updatedJob.title,
        task_type: "generic",
        priority: updatedJob.priority,
        status: updatedJob.status as JobStatus,
        assigned_agent_role: updatedJob.assigned_agent_role ?? null,
        assigned_worker: null,
        attempt_count: 0,
        max_attempts: 3,
        lease_expires_at: null,
        input_payload: {},
        output_payload: null,
        error_message: null,
        created_at: updatedJob.created_at,
        updated_at: updatedJob.updated_at,
        completed_at: null
      };
      set({ jobs: upsertJob(jobs, newJob) });
      console.log(`[SSE] Neuer Job ${updatedJob.id} hinzugefügt`);
    }
    
    // Wenn der selektierte Job aktualisiert wurde, Detail neu laden
    if (get().selectedJobId === updatedJob.id) {
      get().loadJobDetail(updatedJob.id);
    }
  }
}));
