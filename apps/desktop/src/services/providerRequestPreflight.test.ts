import { describe, expect, it } from "vitest";
import { evaluateProviderRequestPreflight } from "@/services/providerRequestPreflight";
import { freezePreparedRuntimeRequest } from "@/services/preparedRuntimeRequest";
import type { ProviderToolBudgetEstimate } from "@/services/providerToolBudget";

function makePreparedRequestInput(
  overrides: Partial<Parameters<typeof freezePreparedRuntimeRequest>[0]> = {}
): Parameters<typeof freezePreparedRuntimeRequest>[0] {
  return {
    runId: "run-default",
    turnIndex: 0,
    bindingDecisionId: "decision-1",
    workflowKind: "planning",
    phase: "planning",
    targetAgent: "planner",
    modelRole: "planning",
    toolProfile: "planner",
    modelId: "model-1",
    modelName: "Codestral",
    slotId: "quality_cpu",
    providerId: "llama-cpp",
    protocolMode: "prompt",
    messages: [{ id: "u1", role: "user", content: "default" }],
    tools: [],
    contextVersion: 1,
    contextStage: 1,
    outputReserveTokens: 512,
    safetyMarginTokens: 128,
    ...overrides
  };
}

function makeToolEstimate(overrides: Partial<ProviderToolBudgetEstimate> = {}): ProviderToolBudgetEstimate {
  return {
    protocolMode: "prompt",
    toolSystemMessages: [],
    nativeDefinitions: [],
    toolsText: "[Tool Catalog]\n- read_file",
    toolTokens: 400,
    toolBodyBytes: 1200,
    toolCount: 4,
    toolsHash: "hash-tools",
    exposedNames: ["read_file", "grep", "ask_user", "list_files"],
    ...overrides
  };
}

describe("providerRequestPreflight", () => {
  it("accepts a compact planning request", () => {
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-ok",
      messages: [{ id: "u1", role: "user", content: "Plane die nächsten Schritte." }],
      tools: [{ name: "read_file" }],
      promptTokens: 600,
      toolPayloadTokens: 400,
      outputReserveTokens: 512,
      safetyMarginTokens: 128
    }));
    const result = evaluateProviderRequestPreflight({
      preparedRequest: prepared,
      toolEstimate: makeToolEstimate(),
      runtimeContextLimit: 4096,
      requestBodyBytes: 5000,
      taskType: "planning",
      currentPhase: "planning",
      providerId: "llama-cpp"
    });
    expect(result.compatible).toBe(true);
    expect(result.rejectionReasons).toEqual([]);
  });

  it("blocks prompt-protocol planning payloads that are too heavy for 4k context", () => {
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-heavy",
      messages: [{ id: "u1", role: "user", content: "Plane alles komplett." }],
      tools: [{ name: "read_file" }],
      promptTokens: 1800,
      toolPayloadTokens: 1100,
      outputReserveTokens: 768,
      safetyMarginTokens: 0
    }));
    const result = evaluateProviderRequestPreflight({
      preparedRequest: prepared,
      toolEstimate: makeToolEstimate({ toolTokens: 1100, toolBodyBytes: 3400, toolCount: 8 }),
      runtimeContextLimit: 4096,
      requestBodyBytes: 15000,
      taskType: "planning",
      currentPhase: "planning",
      providerId: "llama-cpp"
    });
    expect(result.compatible).toBe(false);
    expect(result.rejectionReasons).toContain("tool_protocol_incompatible");
    expect(result.rejectionReasons).toContain("request_body_too_large");
  });

  it("flags context overflow independently of request size", () => {
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-overflow",
      workflowKind: "code_change",
      phase: "implementation",
      targetAgent: "coder",
      modelRole: "primary_coding",
      toolProfile: "coder",
      messages: [{ id: "u1", role: "user", content: "Fix it." }],
      tools: [{ name: "apply_patch" }],
      promptTokens: 2500,
      toolPayloadTokens: 1200,
      outputReserveTokens: 768,
      safetyMarginTokens: 0
    }));
    const result = evaluateProviderRequestPreflight({
      preparedRequest: prepared,
      toolEstimate: makeToolEstimate({ toolTokens: 1200 }),
      runtimeContextLimit: 4096,
      requestBodyBytes: 9000,
      taskType: "small_code_change",
      currentPhase: "implementation",
      providerId: "llama-cpp"
    });
    expect(result.compatible).toBe(false);
    expect(result.rejectionReasons).toContain("context_budget_exceeded");
  });

  it("blocks screenshot turns while the runtime request transport has no image payload support", () => {
    const prepared = freezePreparedRuntimeRequest(makePreparedRequestInput({
      runId: "run-image-turn",
      workflowKind: "review",
      phase: "implementation",
      targetAgent: "reviewer",
      modelRole: "review",
      toolProfile: "reviewer",
      messages: [{ id: "u1", role: "user", content: "Review this screenshot." }],
      promptTokens: 700,
      toolPayloadTokens: 0,
      outputReserveTokens: 512,
      safetyMarginTokens: 0
    }));

    const result = evaluateProviderRequestPreflight({
      preparedRequest: prepared,
      toolEstimate: makeToolEstimate({ toolTokens: 0, toolBodyBytes: 0, toolCount: 0 }),
      runtimeContextLimit: 8192,
      requestBodyBytes: 4000,
      taskType: "review",
      currentPhase: "implementation",
      providerId: "llama-cpp",
      hasImageInput: true
    });

    expect(result.compatible).toBe(false);
    expect(result.rejectionReasons).toContain("vision_transport_unavailable");
  });
});
