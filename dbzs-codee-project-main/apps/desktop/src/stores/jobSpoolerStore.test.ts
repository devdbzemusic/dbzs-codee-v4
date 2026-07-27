import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJobSpoolerStore } from "./jobSpoolerStore";

beforeEach(() => {
  useJobSpoolerStore.setState({
    jobs: [],
    selectedJobId: null,
    selectedJob: null,
    selectedJobDetail: null,
    selectedStatus: "all",
    isLoading: false,
    isDetailLoading: false,
    isMutating: false,
    error: null
  });

  globalThis.window = globalThis.window || ({} as Window & typeof globalThis);

  window.dbzs = {
    getAppInfo: vi.fn(),
    getBackendHealth: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openFileDialog: vi.fn(),
    saveFile: vi.fn(),
    getModelIndex: vi.fn(),
    getRuntimeStatus: vi.fn(),
    startRuntimeModel: vi.fn(),
    stopRuntimeModel: vi.fn(),
    sendRuntimeChat: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgentLogs: vi.fn().mockResolvedValue([]),
    listJobs: vi.fn().mockResolvedValue([
      {
        id: "job_1",
        title: "Implement UI",
        task_type: "implementation",
        priority: 3,
        status: "queued",
        assigned_agent_role: "coder",
        assigned_worker: null,
        attempt_count: 0,
        max_attempts: 3,
        lease_expires_at: null,
        input_payload: { source: "assistant_takeover" },
        output_payload: null,
        error_message: null,
        created_at: "2026-05-11T08:00:00Z",
        updated_at: "2026-05-11T08:00:00Z",
        completed_at: null
      }
    ]),
    getJobDetail: vi.fn().mockResolvedValue({
      job: {
        id: "job_1",
        title: "Implement UI",
        task_type: "implementation",
        priority: 3,
        status: "queued",
        assigned_agent_role: "coder",
        assigned_worker: null,
        attempt_count: 0,
        max_attempts: 3,
        lease_expires_at: null,
        input_payload: { source: "assistant_takeover" },
        output_payload: null,
        error_message: null,
        created_at: "2026-05-11T08:00:00Z",
        updated_at: "2026-05-11T08:00:00Z",
        completed_at: null
      },
      events: [],
      artifacts: [],
      verifications: []
    }),
    claimNextJob: vi.fn().mockResolvedValue({ job: null }),
    addJobWaypoint: vi.fn().mockResolvedValue({
      id: 1,
      job_id: "job_1",
      worker_id: "coder-local",
      waypoint: "progress",
      message: "ok",
      progress: 40,
      metadata: {},
      created_at: "2026-05-11T08:00:00Z"
    }),
    addJobArtifact: vi.fn().mockResolvedValue({
      id: 1,
      job_id: "job_1",
      worker_id: "coder-local",
      kind: "output",
      name: "result.json",
      content: "{}",
      metadata: {},
      created_at: "2026-05-11T08:00:00Z"
    }),
    verifyJob: vi.fn().mockResolvedValue({
      id: 1,
      job_id: "job_1",
      worker_id: "coder-local",
      verdict: "passed",
      reranker_score: 0.95,
      reason: "ok",
      evidence: {},
      created_at: "2026-05-11T08:00:00Z"
    }),
    requeueStaleJobs: vi.fn().mockResolvedValue({ requeued: 1 }),
    listProjectMemory: vi.fn().mockResolvedValue([]),
    upsertProjectMemory: vi.fn(),
    deleteProjectMemory: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    analyzeDocs: vi.fn(),
    generateDocs: vi.fn()
  };
});

describe("useJobSpoolerStore", () => {
  it("loads jobs and selected job detail", async () => {
    await useJobSpoolerStore.getState().loadJobs();

    expect(useJobSpoolerStore.getState().jobs).toHaveLength(1);
    expect(useJobSpoolerStore.getState().selectedJobId).toBe("job_1");
    expect(useJobSpoolerStore.getState().selectedJobDetail?.job.id).toBe("job_1");
  });

  it("requeues stale jobs and refreshes the list", async () => {
    await useJobSpoolerStore.getState().requeueStaleJobs();

    expect(window.dbzs.requeueStaleJobs).toHaveBeenCalledOnce();
    expect(window.dbzs.listJobs).toHaveBeenCalled();
  });

  it("adds artifact and refreshes selected job detail", async () => {
    await useJobSpoolerStore.getState().loadJobs();
    await useJobSpoolerStore.getState().addArtifact({
      worker_id: "coder-local",
      kind: "output",
      name: "result.json",
      content: "{}",
      metadata: {}
    });

    expect(window.dbzs.addJobArtifact).toHaveBeenCalledWith("job_1", {
      worker_id: "coder-local",
      kind: "output",
      name: "result.json",
      content: "{}",
      metadata: {}
    });
    expect(window.dbzs.getJobDetail).toHaveBeenCalledWith("job_1");
  });
});
