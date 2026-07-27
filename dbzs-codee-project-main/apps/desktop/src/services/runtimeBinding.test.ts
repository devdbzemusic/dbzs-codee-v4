import { describe, expect, it } from "vitest";
import {
  assertRuntimeBindingConsistency,
  createRuntimeBindingDecision
} from "@/services/runtimeBinding";

describe("runtimeBinding", () => {
  it("creates a canonical binding decision from workflow + broker state", () => {
    const decision = createRuntimeBindingDecision({
      workspaceId: "ws-1",
      workspaceRoot: "C:/repo",
      workflowId: "wf-1",
      workflowAssignment: {
        workflowKind: "planning",
        phase: "planning",
        effectiveAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      },
      brokerDecision: {
        decisionId: "decision-1",
        decidedAt: new Date("2026-07-24T10:00:00.000Z"),
        taskType: "planning",
        targetAgent: "planner",
        slotId: "quality_cpu",
        modelId: "Codestral-22B-v0.1-Q4-K-M",
        modelName: "Codestral 22B",
        configuredModelId: "Codestral-22B-v0.1-Q4-K-M",
        resolvedModelId: "Codestral-22B-v0.1-Q4-K-M",
        resolvedModelName: "Codestral 22B",
        providerId: "llama-cpp",
        selectionSource: "role_setting",
        capabilities: [],
        hasImageInput: false,
        requiresVision: false,
        reason: ["role_setting"],
        fallbackPolicy: "strict",
        decisionSettingsRevision: 7
      },
      protocolMode: "prompt",
      policyVersion: 3,
      activeContractId: "contract-1",
      activeContractInherited: true,
      activeContractReason: "continuation",
      orchestratorModelId: "functiongemma-270m-it-Q8-0",
      orchestratorSlotId: "orchestrator_cpu"
    });

    expect(decision).toMatchObject({
      decisionId: "decision-1",
      workflowKind: "planning",
      phase: "planning",
      targetAgent: "planner",
      modelRole: "planner",
      toolProfile: "ask",
      slotId: "quality_cpu",
      providerId: "llama-cpp",
      protocolMode: "prompt",
      autoRepairEligible: true
    });
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("accepts matching prepared request, slot state, and provider request", () => {
    const bindingDecision = createRuntimeBindingDecision({
      workspaceId: "ws-1",
      workspaceRoot: "C:/repo",
      workflowAssignment: {
        workflowKind: "code_change",
        phase: "implementation",
        effectiveAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent"
      },
      brokerDecision: {
        decisionId: "decision-2",
        decidedAt: new Date("2026-07-24T10:00:00.000Z"),
        taskType: "small_code_change",
        targetAgent: "coder",
        slotId: "quality_cpu",
        modelId: "Codestral-22B-v0.1-Q4-K-M",
        modelName: "Codestral 22B",
        configuredModelId: "Codestral-22B-v0.1-Q4-K-M",
        resolvedModelId: "Codestral-22B-v0.1-Q4-K-M",
        resolvedModelName: "Codestral 22B",
        providerId: "llama-cpp",
        selectionSource: "manual_selection",
        capabilities: [],
        hasImageInput: false,
        requiresVision: false,
        reason: ["manual_selection"],
        fallbackPolicy: "strict",
        decisionSettingsRevision: 9
      },
      protocolMode: "prompt",
      policyVersion: 3,
      activeContractInherited: false
    });

    const result = assertRuntimeBindingConsistency({
      bindingDecision,
      preparedRequest: {
        bindingDecisionId: "decision-2",
        workflowKind: "code_change",
        phase: "implementation",
        targetAgent: "coder",
        modelRole: "coder",
        toolProfile: "agent",
        modelId: "Codestral-22B-v0.1-Q4-K-M",
        slotId: "quality_cpu",
        providerId: "llama-cpp",
        protocolMode: "prompt"
      },
      slotExecutionState: {
        slotId: "quality_cpu",
        modelId: "Codestral-22B-v0.1-Q4-K-M"
      },
      providerRequest: {
        modelId: "Codestral-22B-v0.1-Q4-K-M",
        slotId: "quality_cpu",
        provider: "llama-cpp",
        protocolMode: "prompt"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.consistent).toBe(true);
  });

  it("reports mismatches instead of silently rerouting", () => {
    const bindingDecision = createRuntimeBindingDecision({
      workspaceId: "ws-1",
      workspaceRoot: "C:/repo",
      workflowAssignment: {
        workflowKind: "planning",
        phase: "planning",
        effectiveAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask"
      },
      brokerDecision: {
        decisionId: "decision-3",
        decidedAt: new Date("2026-07-24T10:00:00.000Z"),
        taskType: "planning",
        targetAgent: "planner",
        slotId: "quality_cpu",
        modelId: "Codestral-22B-v0.1-Q4-K-M",
        modelName: "Codestral 22B",
        configuredModelId: "Codestral-22B-v0.1-Q4-K-M",
        resolvedModelId: "Codestral-22B-v0.1-Q4-K-M",
        resolvedModelName: "Codestral 22B",
        providerId: "llama-cpp",
        selectionSource: "role_setting",
        capabilities: [],
        hasImageInput: false,
        requiresVision: false,
        reason: ["role_setting"],
        fallbackPolicy: "strict",
        decisionSettingsRevision: 9
      },
      protocolMode: "prompt",
      policyVersion: 3,
      activeContractInherited: true
    });

    const result = assertRuntimeBindingConsistency({
      bindingDecision,
      preparedRequest: {
        bindingDecisionId: "decision-3",
        workflowKind: "planning",
        phase: "planning",
        targetAgent: "planner",
        modelRole: "planner",
        toolProfile: "ask",
        modelId: "Codestral-22B-v0.1-Q4-K-M",
        slotId: "quality_cpu",
        providerId: "llama-cpp",
        protocolMode: "prompt"
      },
      slotExecutionState: {
        slotId: "quality_cpu",
        modelId: "Codestral-22B-v0.1-Q4-K-M"
      },
      providerRequest: {
        modelId: "functiongemma-270m-it-Q8-0",
        slotId: "orchestrator_cpu",
        provider: "ollama",
        protocolMode: "native"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.mismatches).toEqual(
      expect.arrayContaining([
        "provider.modelId",
        "provider.slotId",
        "provider.providerId",
        "provider.protocolMode"
      ])
    );
  });
});
