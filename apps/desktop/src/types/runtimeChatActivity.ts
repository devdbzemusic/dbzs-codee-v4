import type { ModelTargetAgent, RuntimeSlotId } from "@dbzs/shared";

export type RuntimeChatActivityStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface RuntimeChatActivityStep {
  id: string;
  label: string;
  detail: string;
  status: RuntimeChatActivityStepStatus;
}

export interface RuntimeChatActivityRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  userPrompt: string;
  targetAgent: ModelTargetAgent;
  modelId?: string;
  modelName?: string;
  providerId?: string;
  steps: RuntimeChatActivityStep[];
  summary?: string;
}

export interface RuntimeChatRoutingInfo {
  targetAgent: ModelTargetAgent;
  modelId: string | null;
  modelName: string | null;
  providerId: string | null;
  slotId?: RuntimeSlotId | null;
  rolloutStage?: string | null;
  routingPath?: "broker" | "legacy" | null;
  canaryPercent?: number | null;
  shadowMode?: boolean;
  shadowMatch?: boolean | null;
  stopOnShadowMismatch?: boolean;
  configuredModelId?: string | null;
  selectionSource?: string | null;
  fallbackReason?: string | null;
  degradedReason?: string | null;
  settingsRevision?: number | null;
  warmupStatus?: "pending" | "ready" | "failed" | "skipped" | null;
}
