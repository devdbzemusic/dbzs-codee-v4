export type ContextSourceType =
  | "active_file"
  | "cursor"
  | "selection"
  | "open_tabs"
  | "diagnostics"
  | "terminal"
  | "git_diff"
  | "workspace"
  | "symbols"
  | "memory";

export interface ContextSignal {
  source: ContextSourceType;
  key: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ContextCollector {
  id: string;
  collect: () => Promise<ContextSignal[]>;
}

export interface RankedContextSignal extends ContextSignal {
  score: number;
  estimatedTokens: number;
}

export interface PromptContext {
  summary: string;
  signals: RankedContextSignal[];
  estimatedTokens: number;
}

export interface ContextBuildRequest {
  userGoal: string;
  maxTokens: number;
}
