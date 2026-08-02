export interface RuntimeRouteRequest {
  task_type: string;
  has_image_input?: boolean;
  requires_vision?: boolean;
  prefer_planner_first?: boolean;
  manual_model_id?: string;
  user_message?: string;
  workflow_kind?: string;
  phase?: string;
  effective_agent?: string;
  model_role?: string;
}

export interface RuntimeRouteResponse {
  decision_id: string;
  task_type: string;
  target_agent: string;
  slot_id: string;
  model_id: string;
  model_name: string;
  configured_model_id: string;
  resolved_model_id: string;
  resolved_model_name: string;
  selection_source: string;
  fallback_reason?: string;
  capabilities: string[];
  has_image_input: boolean;
  requires_vision: boolean;
  projector_artifact_id?: string;
  provider_id: string;
  reason: string[];
  fallback_policy: string;
  decision_settings_revision: number;
}
