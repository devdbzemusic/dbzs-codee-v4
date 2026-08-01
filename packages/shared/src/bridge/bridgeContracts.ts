import type {
  AppInfo,
  BackendHealth,
  ModelIndex,
  RuntimeChatRequest,
  RuntimeChatResponse,
  RuntimeErrorCode,
  RuntimeSlotId,
  RuntimeStatus
} from "../index.js";

export type IpcChannel =
  | "dbzs:app-info"
  | "dbzs:backend-health"
  | "dbzs:models:index"
  | "dbzs:runtime:status"
  | "dbzs:runtime:start"
  | "dbzs:runtime:stop"
  | "dbzs:runtime:chat"
  | "dbzs:runtime:chat:cancel"
  | "dbzs:runtime:chat-stream"
  | "dbzs:runtime:chat-stream:cancel"
  | "dbzs:runtime:chat-stream-chunk";

export const IPC_CHANNELS = [
  "dbzs:app-info",
  "dbzs:backend-health",
  "dbzs:models:index",
  "dbzs:runtime:status",
  "dbzs:runtime:start",
  "dbzs:runtime:stop",
  "dbzs:runtime:chat",
  "dbzs:runtime:chat:cancel",
  "dbzs:runtime:chat-stream",
  "dbzs:runtime:chat-stream:cancel",
  "dbzs:runtime:chat-stream-chunk"
] as const satisfies readonly IpcChannel[];

export function isIpcChannel(value: string): value is IpcChannel {
  return (IPC_CHANNELS as readonly string[]).includes(value);
}

export interface CodeeError {
  code: RuntimeErrorCode | string;
  message: string;
  layer: "renderer" | "preload" | "electron-main" | "backend" | "provider" | "runtime" | string;
  requestId?: string | null;
  diagnosticId?: string | null;
  retryable?: boolean;
  recommendedAction?: string | null;
  diagnosticContext?: Record<string, unknown> | null;
}

export type BridgeResult<T> =
  | { ok: true; value: T; requestId?: string | null }
  | { ok: false; error: CodeeError; requestId?: string | null };

export interface RuntimeRoutingTrace {
  workflow?: string | null;
  phase?: string | null;
  targetAgent?: string | null;
  role?: string | null;
  slotId?: RuntimeSlotId | string | null;
  modelId?: string | null;
  modelName?: string | null;
  providerId?: string | null;
  selectionSource?: string | null;
  fallbackReason?: string | null;
  routingPath?: "broker" | "legacy" | string | null;
  settingsRevision?: number | null;
}

export interface RuntimeChatBridgeRequest extends RuntimeChatRequest {
  request_id: string;
  routing_trace?: RuntimeRoutingTrace | null;
}

export interface RuntimeStreamBridgeRequest extends RuntimeChatBridgeRequest {
  stream?: true;
}

export interface RuntimeStreamChunk {
  requestId?: string;
  delta: string;
  totalLength: number;
}

export interface DesktopBridgeV1 {
  getAppInfo: () => Promise<AppInfo>;
  getBackendHealth: () => Promise<BackendHealth>;
  getModelIndex: () => Promise<ModelIndex>;
  getRuntimeStatus: () => Promise<RuntimeStatus>;
  startRuntimeModel: (modelId: string, profile?: string) => Promise<RuntimeStatus>;
  stopRuntimeModel: () => Promise<RuntimeStatus>;
  sendRuntimeChat: (request: RuntimeChatRequest, requestId?: string) => Promise<RuntimeChatResponse>;
  cancelRuntimeChat?: (requestId: string) => Promise<{ status: string }>;
  streamRuntimeChat?: (
    request: RuntimeChatRequest,
    onChunk: (payload: RuntimeStreamChunk) => void,
    requestId?: string
  ) => Promise<RuntimeChatResponse>;
  cancelRuntimeChatStream?: (requestId?: string) => Promise<{ status: string }>;
}

export interface RuntimeBridgeTimeoutPolicy {
  connectMs: number;
  firstTokenMs: number;
  streamIdleMs: number;
  generationMs: number;
}
