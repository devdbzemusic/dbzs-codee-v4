export interface AllowedCommand {
  id: string;
  label: string;
  command: string;
  args: string[];
}

export type CommandRunState = "running" | "completed" | "failed" | "cancelled";

export interface CommandRunStatus {
  runId: string;
  commandId: string;
  label: string;
  status: CommandRunState;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  timedOut: boolean;
  cancelled: boolean;
}

export interface CommandRunLogs {
  runId: string;
  stdout: string;
  stderr: string;
}

export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_verification"
  | "completed"
  | "failed"
  | "cancelled";

export type WaypointType =
  | "submitted"
  | "claimed"
  | "assigned"
  | "started"
  | "progress"
  | "checkpoint"
  | "waiting_verification"
  | "verification_passed"
  | "verification_failed"
  | "completed"
  | "failed"
  | "requeued";

export type ArtifactKind = "input" | "intermediate" | "output" | "log" | "evidence";
export type VerificationVerdict = "passed" | "failed";

export interface JobRecord {
  id: string;
  title: string;
  task_type: string;
  priority: number;
  status: JobStatus;
  assigned_agent_role: string | null;
  assigned_worker: string | null;
  attempt_count: number;
  max_attempts: number;
  lease_expires_at: string | null;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface JobEvent {
  id: number;
  job_id: string;
  worker_id: string | null;
  waypoint: WaypointType;
  message: string;
  progress: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface JobArtifact {
  id: number;
  job_id: string;
  worker_id: string | null;
  kind: ArtifactKind;
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface JobVerification {
  id: number;
  job_id: string;
  worker_id: string;
  verdict: VerificationVerdict;
  reranker_score: number | null;
  reason: string;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface JobDetail {
  job: JobRecord;
  events: JobEvent[];
  artifacts: JobArtifact[];
  verifications: JobVerification[];
}

export interface JobEnqueueRequest {
  title: string;
  task_type?: string;
  priority?: number;
  assigned_agent_role?: string | null;
  input_payload?: Record<string, unknown>;
  max_attempts?: number;
}

export interface JobClaimRequest {
  worker_id: string;
  supported_roles?: string[];
  lease_seconds?: number;
}

export interface JobClaimResponse {
  job: JobRecord | null;
}

export interface JobWaypointRequest {
  worker_id: string;
  waypoint: WaypointType;
  message?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
}

export interface JobArtifactCreateRequest {
  worker_id?: string;
  kind: ArtifactKind;
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface JobVerifyRequest {
  worker_id: string;
  verdict: VerificationVerdict;
  reranker_score?: number;
  reason?: string;
  evidence?: Record<string, unknown>;
}
