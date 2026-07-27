export type RuntimeSlotId = "quality_cpu" | "fast_gpu" | "utility" | "orchestrator_cpu";
export type RuntimeTaskType =
  | "casual_chat"
  | "normal_chat"
  | "planning"
  | "architecture"
  | "small_code_change"
  | "large_code_change"
  | "debugging"
  | "review"
  | "test_analysis"
  | "refactoring"
  | "embedding"
  | "reranking"
  | "indexing"
  | "intent_routing"
  | "workflow_routing"
  | "function_calling"
  | "clarification_detection";

export type RuntimeSlotRole = "chat" | "coding" | "embedding_reranking" | "routing_function_calling";
export type RuntimeHardwareClass = "cpu" | "gpu" | "hybrid";

export interface RuntimeSlotDefinition {
  id: RuntimeSlotId;
  purpose: "chat" | "coding" | "utility" | "orchestrator";
  hardwareClass: RuntimeHardwareClass;
  port: number;
  supportedTasks: readonly RuntimeTaskType[];
  allowImplicitFallback: false;
}

export const RUNTIME_SLOT_DEFINITIONS = {
  quality_cpu: {
    id: "quality_cpu",
    purpose: "chat",
    hardwareClass: "cpu",
    port: 8081,
    supportedTasks: ["casual_chat", "normal_chat"],
    allowImplicitFallback: false
  },
  fast_gpu: {
    id: "fast_gpu",
    purpose: "coding",
    hardwareClass: "gpu",
    port: 8082,
    supportedTasks: [
      "planning",
      "architecture",
      "small_code_change",
      "large_code_change",
      "debugging",
      "review",
      "test_analysis",
      "refactoring"
    ],
    allowImplicitFallback: false
  },
  utility: {
    id: "utility",
    purpose: "utility",
    hardwareClass: "hybrid",
    port: 8083,
    supportedTasks: ["embedding", "reranking", "indexing"],
    allowImplicitFallback: false
  },
  orchestrator_cpu: {
    id: "orchestrator_cpu",
    purpose: "orchestrator",
    hardwareClass: "cpu",
    port: 8084,
    supportedTasks: [
      "intent_routing",
      "workflow_routing",
      "function_calling",
      "clarification_detection"
    ],
    allowImplicitFallback: false
  }
} as const satisfies Record<RuntimeSlotId, RuntimeSlotDefinition>;
