export interface ToolCapability {
  id: string;
  category: string;
  description: string;
  scopes: string[];
  enabled: boolean;
}

export interface ContextPrepareRequest {
  user_request: string;
  ui?: {
    left_panel_collapsed?: boolean;
    right_panel_collapsed?: boolean;
    terminal_collapsed?: boolean;
    bottom_panel?: string | null;
  };
  workspace?: {
    root_path?: string | null;
    project_name?: string | null;
    active_file_path?: string | null;
    indexed_file_count?: number;
  };
}

export interface ContextPrepareResponse {
  intent_summary: string;
  decomposition_steps: string[];
  context_hints: string[];
  suggested_agents: string[];
  work_items: Array<{
    id: string;
    role: string;
    objective: string;
    depends_on: string[];
    tools: string[];
  }>;
  tool_capabilities: ToolCapability[];
}

export interface ToolCatalogResponse {
  tools: ToolCapability[];
}

export type ToolExecutionScope = "read" | "write" | "network" | "vision";

export interface ToolExecutionRequest {
  tool_id: string;
  scope: ToolExecutionScope;
  workspace_root?: string | null;
  params?: Record<string, string | number | boolean | null>;
}

export interface ToolExecutionResponse {
  tool_id: string;
  scope: ToolExecutionScope;
  status: "ok" | "error";
  message: string;
  output: Record<string, string | number | boolean | null | string[]>;
}
