export type TrajectoryEventType =
  | "job_created"
  | "loop_started"
  | "step_started"
  | "step_completed"
  | "tool_call"
  | "finding"
  | "patch_proposed"
  | "review_gate_created"
  | "review_approved"
  | "review_rejected"
  | "auto_apply_checked"
  | "error"
  | "completed"
  | "cancelled";

export type TrajectoryRiskLevel = "none" | "low" | "medium" | "high" | "critical";

export interface TrajectoryEvent {
  id: string;
  jobId: string;
  stepNumber: number | null;
  eventType: TrajectoryEventType;
  agentRole: string | null;
  model: string | null;
  summary: string;
  files: string[];
  riskLevel: TrajectoryRiskLevel | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  schemaVersion?: string;
}

export interface TrajectoryEventListResponse {
  schemaVersion: string;
  events: TrajectoryEvent[];
}
