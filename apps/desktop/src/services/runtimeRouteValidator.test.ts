import { describe, it, expect } from "vitest";
import { validateResolvedRuntimeRoute, type ResolvedRuntimeRoute } from "./runtimeRouteValidator";
import type { ModelSelectionDecision } from "./modelSelectionBroker";

describe("validateResolvedRuntimeRoute", () => {
  const baseRoute: ResolvedRuntimeRoute = {
    modelId: "test-model",
    modelName: "Test Model",
    slotId: "fast_gpu",
    profile: "default",
    provider: "llama.cpp",
    reasons: ["test"],
    source: "automatic"
  };

  it("sollte 'ok' zurückgeben, wenn kein Broker-Entscheid vorhanden ist", () => {
    const result = validateResolvedRuntimeRoute(baseRoute, null);
    expect(result.ok).toBe(true);
  });

  it("sollte 'ok' zurückgeben, wenn der Slot des Brokers mit dem der Route übereinstimmt", () => {
    const brokerDecision: ModelSelectionDecision = {
      decisionId: "1",
      targetAgent: "coder",
      slotId: "fast_gpu",
      resolvedModelId: "test-model",
      resolvedModelName: "Test Model",
      reason: ["test"],
      selectionSource: "automatic"
    };
    const result = validateResolvedRuntimeRoute(baseRoute, brokerDecision);
    expect(result.ok).toBe(true);
  });

  it("sollte 'ok' zurückgeben, wenn der Broker keinen Slot vorgibt", () => {
    const brokerDecision: ModelSelectionDecision = {
      decisionId: "1",
      targetAgent: "coder",
      slotId: null, // Broker gibt keinen Slot vor
      resolvedModelId: "test-model",
      resolvedModelName: "Test Model",
      reason: ["test"],
      selectionSource: "automatic"
    };
    const result = validateResolvedRuntimeRoute(baseRoute, brokerDecision);
    expect(result.ok).toBe(true);
  });

  it("sollte einen Konflikt melden, wenn der Slot des Brokers von dem der Route abweicht", () => {
    const route: ResolvedRuntimeRoute = {
      ...baseRoute,
      slotId: "quality_cpu" // Abweichender Slot
    };
    const brokerDecision: ModelSelectionDecision = {
      decisionId: "1",
      targetAgent: "coder",
      slotId: "fast_gpu", // Broker wollte diesen Slot
      resolvedModelId: "test-model",
      resolvedModelName: "Test Model",
      reason: ["test"],
      selectionSource: "automatic"
    };
    const result = validateResolvedRuntimeRoute(route, brokerDecision);
    expect(result.ok).toBe(false);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts?.[0]).toContain("Broker wollte Slot 'fast_gpu', aber 'quality_cpu' wurde gewählt");
  });
});
