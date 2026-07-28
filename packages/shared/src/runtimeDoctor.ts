export type RuntimeCheckStatus = "ok" | "warn" | "error";

export interface RuntimeCheck {
  id: string;
  status: RuntimeCheckStatus;
  message: string;
  recommendation: string;
}

export interface ModelDoctorEntry {
  model_id: string;
  name: string;
  format: string;
  artifact_type: string;
  runtime_launcher: string;
  provider: string;
  compatibility: string;
  runnable: boolean;
  estimated_role: string;
  safe_preset: Record<string, unknown>;
  command_preview: string;
  blockers: string[];
  warnings: string[];
}

export interface SuggestedProfile {
  name: string;
  description: string;
  hardware_class: string;
  preset: Record<string, unknown>;
}

export interface RuntimeDoctorReport {
  checks: RuntimeCheck[];
  models: ModelDoctorEntry[];
  suggested_profiles: SuggestedProfile[];
  summary: string;
}

export interface RuntimeDryRunRequest {
  model_id: string;
  profile_name?: string | null;
}

export interface RuntimeDryRunResponse {
  model_id: string;
  command_preview: string;
  preset: Record<string, unknown>;
  warnings: string[];
}

export interface RuntimeProbeRequest {
  allow_start: boolean;
  model_id?: string | null;
  projector_artifact_id?: string | null;
}

export interface RuntimeProbeResponse {
  allowed: boolean;
  message: string;
  stderr_tail: string;
  stdout_tail: string;
  projector_artifact_id?: string | null;
  mmproj_path?: string | null;
  endpoint_verified?: boolean;
  models_endpoint_verified?: boolean;
  advertised_models?: string[];
}

export interface RuntimeLogsResponse {
  state: string;
  model_id: string | null;
  stderr_tail: string;
  stdout_tail: string;
}

export type RuntimeDoctorAction = "dry-run" | "probe" | "start" | "stop" | null;

export interface RuntimeDoctorActionResult {
  action: RuntimeDoctorAction;
  success: boolean;
  message: string;
  command_preview?: string;
  preset?: Record<string, unknown>;
  stderr_tail?: string;
  stdout_tail?: string;
}
