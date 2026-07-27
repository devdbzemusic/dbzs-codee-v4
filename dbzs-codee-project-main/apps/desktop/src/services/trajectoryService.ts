import type { TrajectoryEvent, TrajectoryEventListResponse, TrajectoryEventType, TrajectoryRiskLevel } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

interface RawTrajectoryEvent {
  schema_version?: string;
  id: string;
  job_id: string;
  step_number: number | null;
  event_type: TrajectoryEventType;
  agent_role: string | null;
  model: string | null;
  summary: string;
  files: string[];
  risk_level: TrajectoryRiskLevel | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface RawTrajectoryEventListResponse {
  schema_version: string;
  events: RawTrajectoryEvent[];
}

function mapEvent(raw: RawTrajectoryEvent): TrajectoryEvent {
  return {
    id: raw.id,
    jobId: raw.job_id,
    stepNumber: raw.step_number,
    eventType: raw.event_type,
    agentRole: raw.agent_role,
    model: raw.model,
    summary: raw.summary,
    files: raw.files ?? [],
    riskLevel: raw.risk_level,
    metadata: raw.metadata ?? {},
    createdAt: raw.created_at,
    schemaVersion: raw.schema_version
  };
}

function mapListResponse(raw: RawTrajectoryEventListResponse): TrajectoryEventListResponse {
  return {
    schemaVersion: raw.schema_version,
    events: (raw.events ?? []).map(mapEvent)
  };
}

export const trajectoryService = {
  async listJobTrajectory(jobId: string): Promise<TrajectoryEvent[]> {
    const data = (await backendClient.listJobTrajectory(jobId)) as RawTrajectoryEventListResponse;
    return mapListResponse(data).events;
  },

  async listRecentTrajectories(limit = 100): Promise<TrajectoryEvent[]> {
    const data = (await backendClient.listRecentTrajectories(limit)) as RawTrajectoryEventListResponse;
    return mapListResponse(data).events;
  }
};
