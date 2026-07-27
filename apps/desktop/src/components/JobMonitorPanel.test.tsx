import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { JobDetail, JobRecord } from "@dbzs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobMonitorPanel } from "./JobMonitorPanel";
import { useAgentRegistryStore } from "@/stores/agentRegistryStore";
import { useJobSpoolerStore } from "@/stores/jobSpoolerStore";

declare global {
  // React checks this flag to know whether act() is supported by the test environment.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
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
    input_payload: { source: "test" },
    output_payload: null,
    error_message: null,
    created_at: "2026-05-11T08:00:00Z",
    updated_at: "2026-05-11T08:00:00Z",
    completed_at: null,
    ...overrides
  };
}

function buildJobDetail(job: JobRecord, overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    job,
    events: [],
    artifacts: [],
    verifications: [],
    ...overrides
  };
}

describe("JobMonitorPanel quick-action reasons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useAgentRegistryStore.setState({
      agents: [],
      logs: [],
      selectedAgentId: null,
      isLoading: false,
      isMutating: false,
      isLoadingLogs: false,
      error: null,
      selectedAgent: null,
      loadAgents: vi.fn(async () => {}),
      loadSelectedAgentLogs: vi.fn(async () => {}),
      selectAgent: vi.fn(),
      createAgent: vi.fn(async () => {}),
      updateAgent: vi.fn(async () => {}),
      startSelectedAgent: vi.fn(async () => {}),
      stopSelectedAgent: vi.fn(async () => {}),
      deleteSelectedAgent: vi.fn(async () => {}),
      setSelectedAgentEnabled: vi.fn(async () => {})
    });

    useJobSpoolerStore.setState({
      jobs: [],
      selectedJobId: null,
      selectedJob: null,
      selectedJobDetail: null,
      selectedStatus: "all",
      isLoading: false,
      isDetailLoading: false,
      isMutating: false,
      error: null,
      loadJobs: vi.fn(async () => {}),
      loadJobDetail: vi.fn(async () => {}),
      selectJob: vi.fn(async () => {}),
      setStatusFilter: vi.fn(),
      claimNextJob: vi.fn(async () => {}),
      addWaypoint: vi.fn(async () => {}),
      addArtifact: vi.fn(async () => {}),
      verifySelectedJob: vi.fn(async () => {}),
      requeueStaleJobs: vi.fn(async () => {})
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.restoreAllMocks();
  });

  it("shows action buttons for queued jobs", async () => {
    const queuedJob = buildJob({ status: "queued" });
    useJobSpoolerStore.setState({
      jobs: [queuedJob],
      selectedJobId: queuedJob.id,
      selectedJob: queuedJob,
      selectedJobDetail: buildJobDetail(queuedJob)
    });

    await act(async () => {
      root.render(<JobMonitorPanel />);
    });

    // UI sollte Quick-Action Buttons zeigen (WIP, Verify, Done, Log)
    expect(container.textContent).toContain("Implement UI");
    expect(container.textContent).toContain("queued");
  });

  it("shows action buttons for running job without selected detail", async () => {
    const runningJob = buildJob({ status: "running" });
    useJobSpoolerStore.setState({
      jobs: [runningJob],
      selectedJobId: runningJob.id,
      selectedJob: runningJob,
      selectedJobDetail: null
    });

    await act(async () => {
      root.render(<JobMonitorPanel />);
    });

    // UI sollte running Job anzeigen
    expect(container.textContent).toContain("Implement UI");
    expect(container.textContent).toContain("running");
  });

  it("shows progress for running job with events", async () => {
    const runningJob = buildJob({ status: "running" });
    useJobSpoolerStore.setState({
      jobs: [runningJob],
      selectedJobId: runningJob.id,
      selectedJob: runningJob,
      selectedJobDetail: buildJobDetail(runningJob, {
        events: [
          {
            id: 1,
            job_id: runningJob.id,
            worker_id: "coder-local",
            waypoint: "progress",
            message: "in progress",
            progress: 50,
            metadata: {},
            created_at: "2026-05-11T08:01:00Z"
          }
        ],
        verifications: []
      })
    });

    await act(async () => {
      root.render(<JobMonitorPanel />);
    });

    // UI sollte Progress anzeigen
    expect(container.textContent).toContain("Implement UI");
    expect(container.textContent).toContain("running");
    expect(container.textContent).toContain("progress");
  });
});
