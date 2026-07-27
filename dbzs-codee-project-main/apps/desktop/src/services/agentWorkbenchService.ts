import type {
  AgentEvent,
  AgentEventListResponse,
  AgentFollowUp,
  AgentFollowUpCreateRequest,
  AgentPlanStepInput,
  AgentRun,
  AgentRunCreateRequest,
  AgentRunDetail,
  AgentRunPlanRequest,
  HostAction,
  HostActionCompleteRequest,
  HostActionFailRequest
} from "@dbzs/shared";

const BACKEND_URL = `http://127.0.0.1:${import.meta.env.VITE_DBZS_BACKEND_PORT ?? "8876"}`;

function getBackendUrl(): string {
  return BACKEND_URL;
}

interface RawAgentRun {
  id: string;
  job_id: string | null;
  workspace_root: string;
  workspace_name: string;
  goal: string;
  status: AgentRun["status"];
  execution_mode: AgentRun["executionMode"];
  provider: string | null;
  model_id: string | null;
  current_step_id: string | null;
  max_steps: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  pause_reason: string | null;
  error_message: string | null;
  schema_version: string;
}

interface RawAgentStep {
  id: string;
  run_id: string;
  ordinal: number;
  title: string;
  description: string;
  status: AgentRunDetail["steps"][number]["status"];
  role: string | null;
  depends_on_json?: string[];
  depends_on?: string[];
  attempt_count: number;
  max_attempts: number;
  input_summary: string | null;
  output_summary: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface RawAgentEvent {
  sequence: number;
  id: string;
  run_id: string;
  step_id: string | null;
  event_type: AgentEvent["eventType"];
  severity: AgentEvent["severity"];
  summary: string;
  payload_json?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  created_at: string;
  schema_version?: string;
}

interface RawHostAction {
  id: string;
  run_id: string;
  step_id: string | null;
  action_type: HostAction["actionType"];
  status: HostAction["status"];
  payload_json?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  result_json?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface RawFollowUp {
  id: string;
  run_id: string;
  text: string;
  status: AgentFollowUp["status"];
  created_at: string;
  processed_at: string | null;
  effect_summary: string | null;
}

function mapRun(raw: RawAgentRun): AgentRun {
  return {
    id: raw.id,
    jobId: raw.job_id,
    workspaceRoot: raw.workspace_root,
    workspaceName: raw.workspace_name,
    goal: raw.goal,
    status: raw.status,
    executionMode: raw.execution_mode,
    provider: raw.provider,
    modelId: raw.model_id,
    currentStepId: raw.current_step_id,
    maxSteps: raw.max_steps,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    pauseReason: raw.pause_reason,
    errorMessage: raw.error_message,
    schemaVersion: raw.schema_version,
    // Safely forward potential dynamic runtime fields
    ...({
      execution_backend: (raw as any).execution_backend,
      runtime_provider: (raw as any).runtime_provider,
      runtime_model_id: (raw as any).runtime_model_id,
      runtime_model_name: (raw as any).runtime_model_name,
      runtime_endpoint: (raw as any).runtime_endpoint,
      runtime_pid: (raw as any).runtime_pid,
      runtime_health_state: (raw as any).runtime_health_state,
      runtime_verified_at: (raw as any).runtime_verified_at
    } as any)
  };
}

function mapStep(raw: RawAgentStep): AgentRunDetail["steps"][number] {
  return {
    id: raw.id,
    runId: raw.run_id,
    ordinal: raw.ordinal,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    role: raw.role,
    dependsOn: raw.depends_on_json ?? raw.depends_on ?? [],
    attemptCount: raw.attempt_count,
    maxAttempts: raw.max_attempts,
    inputSummary: raw.input_summary,
    outputSummary: raw.output_summary,
    createdAt: raw.created_at,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    errorMessage: raw.error_message
  };
}

function mapEvent(raw: RawAgentEvent): AgentEvent {
  return {
    sequence: raw.sequence,
    id: raw.id,
    runId: raw.run_id,
    stepId: raw.step_id,
    eventType: raw.event_type,
    severity: raw.severity,
    summary: raw.summary,
    payload: raw.payload_json ?? raw.payload ?? {},
    createdAt: raw.created_at,
    schemaVersion: raw.schema_version
  };
}

function mapHostAction(raw: RawHostAction): HostAction {
  return {
    id: raw.id,
    runId: raw.run_id,
    stepId: raw.step_id,
    actionType: raw.action_type,
    status: raw.status,
    payload: raw.payload_json ?? raw.payload ?? {},
    result: raw.result_json ?? raw.result ?? null,
    createdAt: raw.created_at,
    claimedAt: raw.claimed_at,
    completedAt: raw.completed_at,
    errorMessage: raw.error_message
  };
}

function mapFollowUp(raw: RawFollowUp): AgentFollowUp {
  return {
    id: raw.id,
    runId: raw.run_id,
    text: raw.text,
    status: raw.status,
    createdAt: raw.created_at,
    processedAt: raw.processed_at,
    effectSummary: raw.effect_summary
  };
}

async function parseError(response: Response, fallback: string): Promise<never> {
  let detail = fallback;
  try {
    const body = (await response.json()) as { detail?: string; message?: string };
    detail = body.detail ?? body.message ?? fallback;
  } catch {
    // ignore parse failures
  }
  throw new Error(`${detail} (${response.status})`);
}

function buildPlanBody(steps: AgentPlanStepInput[]): AgentRunPlanRequest {
  return { steps };
}

export const agentWorkbenchService = {
  getBackendUrl,

  async createRun(request: AgentRunCreateRequest, idempotencyKey?: string): Promise<AgentRun> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      body: JSON.stringify({
        goal: request.goal,
        workspace_root: request.workspaceRoot,
        workspace_name: request.workspaceName,
        execution_mode: request.executionMode ?? "supervised",
        provider: request.provider ?? null,
        model_id: request.modelId ?? null,
        max_steps: request.maxSteps ?? 20,
        job_id: request.jobId ?? null
      })
    });
    if (!response.ok) {
      await parseError(response, "AgentRun konnte nicht erstellt werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async listRuns(limit = 50): Promise<AgentRun[]> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs?limit=${limit}`);
    if (!response.ok) {
      await parseError(response, "AgentRuns konnten nicht geladen werden");
    }
    const data = (await response.json()) as { schema_version?: string; runs?: RawAgentRun[] } | RawAgentRun[];
    if (Array.isArray(data)) {
      return data.map(mapRun);
    }
    return (data.runs ?? []).map(mapRun);
  },

  async getRun(runId: string): Promise<AgentRunDetail> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) {
      await parseError(response, "AgentRun konnte nicht geladen werden");
    }
    const data = (await response.json()) as {
      run: RawAgentRun;
      steps: RawAgentStep[];
      follow_ups?: RawFollowUp[];
    };
    return {
      run: mapRun(data.run),
      steps: (data.steps ?? []).map(mapStep),
      followUps: (data.follow_ups ?? []).map(mapFollowUp)
    };
  },

  async setPlan(runId: string, steps: AgentPlanStepInput[]): Promise<AgentRunDetail> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPlanBody(steps))
    });
    if (!response.ok) {
      await parseError(response, "Plan konnte nicht gesetzt werden");
    }
    const data = (await response.json()) as {
      run: RawAgentRun;
      steps: RawAgentStep[];
    };
    return {
      run: mapRun(data.run),
      steps: data.steps.map(mapStep),
      followUps: []
    };
  },

  async startRun(runId: string): Promise<AgentRun> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/start`, {
      method: "POST"
    });
    if (!response.ok) {
      await parseError(response, "Run konnte nicht gestartet werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async pauseRun(runId: string, reason?: string): Promise<AgentRun> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? null })
    });
    if (!response.ok) {
      await parseError(response, "Run konnte nicht pausiert werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async resumeRun(runId: string): Promise<AgentRun> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/resume`, {
      method: "POST"
    });
    if (!response.ok) {
      await parseError(response, "Run konnte nicht fortgesetzt werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async acceptResumeBaseline(runId: string): Promise<AgentRun> {
    const response = await fetch(
      `${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/accept-resume-baseline`,
      {
        method: "POST"
      }
    );
    if (!response.ok) {
      await parseError(response, "Resume-Baseline konnte nicht akzeptiert werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async getWorkspaceChanges(runId: string): Promise<string[]> {
    const response = await fetch(
      `${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/workspace-changes`
    );
    if (!response.ok) {
      await parseError(response, "Workspace-Änderungen konnten nicht geladen werden");
    }
    const data = (await response.json()) as { changed_files?: string[] };
    return Array.isArray(data.changed_files) ? data.changed_files.filter((entry) => typeof entry === "string") : [];
  },

  async acceptWorkspaceChanges(runId: string, expectedChangedFiles: string[] = []): Promise<AgentRun> {
    const response = await fetch(
      `${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/accept-workspace-changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_changed_files: expectedChangedFiles })
      }
    );
    if (!response.ok) {
      await parseError(response, "Workspace-Änderungen konnten nicht akzeptiert werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async cancelRun(runId: string): Promise<AgentRun> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST"
    });
    if (!response.ok) {
      await parseError(response, "Run konnte nicht abgebrochen werden");
    }
    const data = (await response.json()) as { run: RawAgentRun };
    return mapRun(data.run);
  },

  async submitFollowUp(runId: string, text: string): Promise<AgentFollowUp> {
    const body: AgentFollowUpCreateRequest = { text };
    const response = await fetch(`${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/followups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      await parseError(response, "Follow-up konnte nicht gesendet werden");
    }
    const data = (await response.json()) as { followup: RawFollowUp };
    return mapFollowUp(data.followup);
  },

  async listEvents(runId: string, afterSequence = 0, limit = 200): Promise<AgentEventListResponse> {
    const params = new URLSearchParams({
      after_sequence: String(afterSequence),
      limit: String(limit)
    });
    const response = await fetch(
      `${getBackendUrl()}/agent-workbench/runs/${encodeURIComponent(runId)}/events?${params.toString()}`
    );
    if (!response.ok) {
      await parseError(response, "Events konnten nicht geladen werden");
    }
    const data = (await response.json()) as { schema_version?: string; events: RawAgentEvent[] };
    return {
      schemaVersion: data.schema_version ?? "agent-event-v1",
      events: (data.events ?? []).map(mapEvent)
    };
  },

  async getNextHostAction(executorId = "desktop-primary"): Promise<HostAction | null> {
    const response = await fetch(
      `${getBackendUrl()}/agent-workbench/host-actions/next?executor_id=${encodeURIComponent(executorId)}`
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      await parseError(response, "Host Action konnte nicht abgeholt werden");
    }
    const data = (await response.json()) as RawHostAction | null;
    if (!data) {
      return null;
    }
    return mapHostAction(data);
  },

  async claimHostAction(actionId: string, executorId = "desktop-primary"): Promise<HostAction> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/host-actions/${encodeURIComponent(actionId)}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executor_id: executorId })
    });
    if (!response.ok) {
      await parseError(response, "Host Action konnte nicht geclaimt werden");
    }
    const data = (await response.json()) as { action: RawHostAction };
    return mapHostAction(data.action);
  },

  async completeHostAction(actionId: string, request: HostActionCompleteRequest = {}): Promise<HostAction> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/host-actions/${encodeURIComponent(actionId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result_json: request.result ?? {} })
    });
    if (!response.ok) {
      await parseError(response, "Host Action konnte nicht abgeschlossen werden");
    }
    const data = (await response.json()) as { action: RawHostAction };
    return mapHostAction(data.action);
  },

  async failHostAction(actionId: string, request: HostActionFailRequest): Promise<HostAction> {
    const response = await fetch(`${getBackendUrl()}/agent-workbench/host-actions/${encodeURIComponent(actionId)}/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error_message: request.errorMessage,
        result_json: request.result ?? {}
      })
    });
    if (!response.ok) {
      await parseError(response, "Host Action konnte nicht als fehlgeschlagen markiert werden");
    }
    const data = (await response.json()) as { action: RawHostAction };
    return mapHostAction(data.action);
  }
};
