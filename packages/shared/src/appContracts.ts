export type TerminalShell = "powershell" | "cmd" | "pwsh";

export interface TerminalCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}

export type ReasoningDisplayMode =
  | "hidden"
  | "summary"
  | "expanded";
export type ReasoningTraceDisplayMode = ReasoningDisplayMode;

export interface SettingsPatchRequest {
  baseRevision: number;
  changes: Partial<AppSettings>;
}

export interface SettingsPatchResponse {
  settings: AppSettings;
  revision: number;
  appliedKeys: string[];
  restartRequirements: Record<string, string>;
}

export interface SettingsDiagnostics {
  schemaVersion: number;
  revision: number;
  settingsPath: string;
  appDataDir: string;
  modelsDir: string;
  loadedAt: string;
  lastSavedAt?: string | null;
  validationErrors: string[];
  orphanedSettings: string[];
  hiddenUserTunableSettings: string[];
  hardcodedRuntimeValues: Array<{
    key: string;
    value: unknown;
    path: string;
    classification: string;
  }>;
  effectiveSources: Record<string, string>;
  settingsRedacted?: Partial<AppSettings> & Record<string, unknown>;
  winRuntimesDir?: string;
}

export interface AppSettings {
  schemaVersion?: number;
  revision?: number;
  updatedAt?: string | null;
  theme: "dark" | "light";
  autoSave: boolean;
  reasoningDisplayMode?: ReasoningDisplayMode;
  editorFontSize: number;
  terminalShell: TerminalShell;
  safeCommandConfirmation: boolean;
  telemetryEnabled: false;
  modelsPath: string;
  defaultModelId: string;
  defaultChatModelId: string;
  backendUrl: string;
  agentExecutionEnabled: boolean;
  safeMode: boolean;
  maxAgentRuntimeSeconds: number;
  maxFileScanCount: number;
  cloudModelsEnabled: boolean;
  preferLocalModels: boolean;
  localOnlyModels: boolean;
  ollamaBaseUrl: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  defaultPlannerModelId: string;
  defaultCoderModelId: string;
  defaultReviewerModelId: string;
  defaultDebugModelId: string;
  autoStartChatRuntime: boolean;
  autoStartCodingRuntime: boolean;
  autoStartVisionRuntime?: boolean;
  autoStartReviewRuntime?: boolean;
  defaultUtilityModelId?: string;
  idleUnloadWorkModelsMinutes?: number;
  chatRuntimeSlot: "quality_cpu";
  codingRuntimeSlot: "fast_gpu";
  chatRuntimePort: number;
  codingRuntimePort: number;
  stopDesktopRuntimesOnExit: boolean;
  maxAutonomousSteps: number;
  maxDebugRetries: number;
  maxFailedTaskRetries: number;
  localOnly: boolean;
  defaultModelName?: string;
  modelDiscoveryMode?: "project_local_strict" | "local_with_ollama" | "cloud_enabled";
  runtimeChatUseBroker?: boolean;
  runtimeChatEnableSlotValidation?: boolean;
  runtimeChatEnableAgentTurnLoop?: boolean;
  runtimeChatEnableStrictFallback?: boolean;
  runtimeChatEnableDiagnostics?: boolean;
  runtimeChatShadowMode?: boolean;
  runtimeChatCanaryPercent?: number;
  runtimeChatStopOnShadowMismatch?: boolean;
  contextSpoolerEnabled?: boolean;
  ragEnabled?: boolean;
  hybridRetrievalEnabled?: boolean;
  reasoningTraceEnabled?: boolean;
  tokenBudgetOutputReserveRatio?: number;
  tokenBudgetToolReserveRatio?: number;
  tokenBudgetSafetyReserveRatio?: number;
  conversationControlV2?: boolean;
  legacyStructuredMarkupParser?: boolean;
  defaultOrchestratorModelId?: string;
  autoStartOrchestratorRuntime?: boolean;
  orchestratorRuntimeSlot?: "orchestrator_cpu";
  orchestratorRuntimePort?: number;
  timeoutStreamIdleSeconds?: number;
  timeoutFirstTokenSeconds?: number;
  timeoutGenerationSeconds?: number;
  timeoutPromptEvalSeconds?: number;
  timeoutCpuSafeStreamIdleSeconds?: number;
  timeoutCpuSafeFirstTokenSeconds?: number;
  timeoutCpuSafeGenerationSeconds?: number;
}

export interface BackendHealth {
  status: "ok";
  app: "DBZS Code Assistant";
  version: string;
}

export type BackendStartupState =
  | "idle"
  | "starting"
  | "live"
  | "ready"
  | "degraded"
  | "failed"
  | "stopped";

export type BackendProcessOwnership = "spawned-by-desktop" | "preexisting-local" | "unknown";

export interface BackendStartupStatus {
  state: BackendStartupState;
  message: string | null;
  port: number;
  ownership: BackendProcessOwnership;
  instanceId: string | null;
}

export interface AppInfo {
  name: "DBZS Code Assistant";
  version: string;
  backendUrl: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  revision: 0,
  updatedAt: null,
  theme: "dark",
  autoSave: true,
  reasoningDisplayMode: "summary",
  ragEnabled: true,
  hybridRetrievalEnabled: true,
  reasoningTraceEnabled: true,
  editorFontSize: 14,
  terminalShell: "powershell",
  safeCommandConfirmation: true,
  telemetryEnabled: false,
  modelsPath: "D:/Models",
  defaultModelId: "",
  defaultChatModelId: "",
  backendUrl: "http://127.0.0.1:8876",
  agentExecutionEnabled: true,
  safeMode: true,
  maxAgentRuntimeSeconds: 3600,
  maxFileScanCount: 2500,
  cloudModelsEnabled: false,
  preferLocalModels: true,
  localOnlyModels: true,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  anthropicApiKey: "",
  openaiApiKey: "",
  defaultPlannerModelId: "",
  defaultCoderModelId: "",
  defaultReviewerModelId: "",
  defaultDebugModelId: "",
  autoStartChatRuntime: false,
  autoStartCodingRuntime: false,
  autoStartVisionRuntime: false,
  autoStartReviewRuntime: false,
  defaultUtilityModelId: "",
  idleUnloadWorkModelsMinutes: 10,
  chatRuntimeSlot: "quality_cpu",
  codingRuntimeSlot: "fast_gpu",
  chatRuntimePort: 8081,
  codingRuntimePort: 8082,
  stopDesktopRuntimesOnExit: true,
  maxAutonomousSteps: 20,
  maxDebugRetries: 2,
  maxFailedTaskRetries: 1,
  localOnly: true,
  defaultModelName: "Default Model",
  modelDiscoveryMode: "project_local_strict",
  runtimeChatUseBroker: true,
  runtimeChatEnableSlotValidation: true,
  runtimeChatEnableAgentTurnLoop: true,
  runtimeChatEnableStrictFallback: true,
  runtimeChatEnableDiagnostics: true,
  runtimeChatShadowMode: false,
  runtimeChatCanaryPercent: 100,
  runtimeChatStopOnShadowMismatch: false,
  contextSpoolerEnabled: true,
  tokenBudgetOutputReserveRatio: 0.22,
  tokenBudgetToolReserveRatio: 0.07,
  tokenBudgetSafetyReserveRatio: 0.05,
  conversationControlV2: true,
  legacyStructuredMarkupParser: false,
  defaultOrchestratorModelId: "",
  autoStartOrchestratorRuntime: true,
  orchestratorRuntimeSlot: "orchestrator_cpu",
  orchestratorRuntimePort: 8084,
  timeoutStreamIdleSeconds: 30,
  timeoutFirstTokenSeconds: 90,
  timeoutGenerationSeconds: 300,
  timeoutPromptEvalSeconds: 90,
  timeoutCpuSafeStreamIdleSeconds: 180,
  timeoutCpuSafeFirstTokenSeconds: 120,
  timeoutCpuSafeGenerationSeconds: 600
};
