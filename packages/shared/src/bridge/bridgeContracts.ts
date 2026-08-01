import type {
  AppInfo,
  BackendHealth,
  ModelLabBenchmarkRequest,
  ModelLabBenchmarkRun,
  ModelLabBundle,
  ModelLabCertificationRecord,
  ModelLabCertificationRequest,
  ModelLabCollection,
  ModelLabCollectionCreate,
  ModelLabDuplicateGroup,
  ModelLabFailureRecord,
  ModelLabHardwareProfile,
  ModelLabHuggingFaceRepoInfo,
  ModelLabHuggingFaceSearchResult,
  ModelLabLogicalModel,
  ModelLabMetadataUpdate,
  ModelLabModel,
  ModelLabProbeRequest,
  ModelLabProbeRun,
  ModelLabRoleAssignment,
  ModelLabRoleAssignmentRequest,
  ModelLabRuntimeAdapter,
  ModelLabRuntimePreset,
  ModelLabScanJob,
  ModelLabScanRequest,
  ModelLabScanResult,
  ModelLabSource,
  ModelLabSourceCreate,
  ModelLabVariant,
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

export const IPC_CHANNEL = {
  appInfo: "dbzs:app-info",
  backendHealth: "dbzs:backend-health",
  modelsIndex: "dbzs:models:index",
  runtimeStatus: "dbzs:runtime:status",
  runtimeStart: "dbzs:runtime:start",
  runtimeStop: "dbzs:runtime:stop",
  runtimeChat: "dbzs:runtime:chat",
  runtimeChatCancel: "dbzs:runtime:chat:cancel",
  runtimeChatStream: "dbzs:runtime:chat-stream",
  runtimeChatStreamCancel: "dbzs:runtime:chat-stream:cancel",
  runtimeChatStreamChunk: "dbzs:runtime:chat-stream-chunk"
} as const satisfies Record<string, IpcChannel>;

export const IPC_CHANNELS = Object.values(IPC_CHANNEL) as readonly IpcChannel[];

export const BRIDGE_REQUEST_IPC_CHANNELS = [
  IPC_CHANNEL.appInfo,
  IPC_CHANNEL.backendHealth,
  IPC_CHANNEL.modelsIndex,
  IPC_CHANNEL.runtimeStatus,
  IPC_CHANNEL.runtimeStart,
  IPC_CHANNEL.runtimeStop,
  IPC_CHANNEL.runtimeChat,
  IPC_CHANNEL.runtimeChatCancel,
  IPC_CHANNEL.runtimeChatStream,
  IPC_CHANNEL.runtimeChatStreamCancel
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
  listModelLabSources?: () => Promise<ModelLabSource[]>;
  createModelLabSource?: (request: ModelLabSourceCreate) => Promise<ModelLabSource>;
  runModelLabScan?: (request?: ModelLabScanRequest) => Promise<ModelLabScanResult>;
  listModelLabJobs?: () => Promise<ModelLabScanJob[]>;
  listModelLabModels?: () => Promise<ModelLabModel[]>;
  getModelLabModel?: (bundleId: string) => Promise<ModelLabModel>;
  updateModelLabMetadata?: (bundleId: string, request: ModelLabMetadataUpdate) => Promise<ModelLabBundle>;
  listModelLabCollections?: () => Promise<ModelLabCollection[]>;
  createModelLabCollection?: (request: ModelLabCollectionCreate) => Promise<ModelLabCollection>;
  addModelLabCollectionMember?: (collectionId: string, bundleId: string) => Promise<{ status: string }>;
  removeModelLabCollectionMember?: (collectionId: string, bundleId: string) => Promise<{ status: string }>;
  findModelLabDuplicates?: () => Promise<ModelLabDuplicateGroup[]>;
  searchModelLabHuggingFace?: (
    query: string,
    category?: string,
    limit?: number
  ) => Promise<ModelLabHuggingFaceSearchResult[]>;
  getModelLabHuggingFaceRepo?: (repoId: string, revision?: string) => Promise<ModelLabHuggingFaceRepoInfo>;
  getModelLabHardware?: () => Promise<ModelLabHardwareProfile>;
  listLogicalModels?: () => Promise<ModelLabLogicalModel[]>;
  getLogicalModel?: (logicalModelId: string) => Promise<ModelLabLogicalModel>;
  listModelVariants?: (logicalModelId?: string) => Promise<ModelLabVariant[]>;
  listModelRuntimeAdapters?: () => Promise<ModelLabRuntimeAdapter[]>;
  listModelRuntimePresets?: () => Promise<ModelLabRuntimePreset[]>;
  probeModel?: (request: ModelLabProbeRequest) => Promise<ModelLabProbeRun>;
  listModelProbeRuns?: (bundleId?: string) => Promise<ModelLabProbeRun[]>;
  benchmarkModel?: (request: ModelLabBenchmarkRequest) => Promise<ModelLabBenchmarkRun>;
  listModelBenchmarkRuns?: (bundleId?: string) => Promise<ModelLabBenchmarkRun[]>;
  certifyModel?: (request: ModelLabCertificationRequest) => Promise<ModelLabCertificationRecord>;
  listModelCertifications?: (bundleId?: string) => Promise<ModelLabCertificationRecord[]>;
  assignModelRole?: (request: ModelLabRoleAssignmentRequest) => Promise<ModelLabRoleAssignment>;
  listModelRoleAssignments?: (role?: string) => Promise<ModelLabRoleAssignment[]>;
  listModelFailures?: (bundleId?: string) => Promise<ModelLabFailureRecord[]>;
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
