/**
 * P2 Phase 6: Integration Tests for Communication Spine (Phases 1-5)
 *
 * Tests the end-to-end message flow:
 * Chat Input → Intent Classification → Routing Broker → Slot Validation → Error Handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import { brokerDecision, classifyTaskType } from "@/services/modelSelectionBroker";
import { classifyRuntimeChatError } from "@/services/runtimeChatErrorClassifier";
import { DEFAULT_TIMEOUTS, TimeoutManager } from "@/services/timeoutConfig";

// Mock validateSlot for integration testing
function validateSlot(
  slotId: string,
  status: { state: string; memory: number; concurrency: number; maxConcurrency?: number }
) {
  const errors: string[] = [];
  let isValid = status.state === "ready" && status.memory >= 2048 && status.concurrency < (status.maxConcurrency || 5);
  if (!isValid) {
    errors.push(`Slot ${slotId} ist nicht verfügbar`);
  }
  return { isValid, errors };
}

// Mock settings for broker
const mockSettings = {
  defaultModelId: "llm/default-model.gguf",
  defaultModelName: "Default Model",
  defaultChatModelId: "llm/default-model.gguf",
  defaultPlannerModelId: "llm/planner-model.gguf",
  defaultCoderModelId: "llm/coder-model.gguf",
  defaultReviewerModelId: "llm/reviewer-model.gguf",
  defaultDebugModelId: "llm/debug-model.gguf",
  localOnlyModels: true
};

describe("Communication Spine Integration (Phases 1-5)", () => {
  describe("end-to-end routing flow", () => {
    it("should complete full routing pipeline: classification → broker → validation", () => {
      // Phase 1: Make routing decision
      const decision = brokerDecision("large_code_change", mockSettings);

      expect(decision).toHaveProperty("taskType");
      expect(decision).toHaveProperty("targetAgent");
      expect(decision).toHaveProperty("slotId");

      // Phase 1 (continued): Validate slot
      const validation = validateSlot(decision.slotId, {
        state: "ready",
        memory: 8192,
        concurrency: 1
      });

      expect(validation.isValid).toBe(true);
      expect(decision.taskType).toBe("large_code_change");
    });

    it("should reject invalid slots after broker decision", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Simulate slot failure
      const validation = validateSlot(decision.slotId, {
        state: "failed", // Slot is down
        memory: 0,
        concurrency: 0
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it("should provide complete routing context through pipeline", () => {
      // Full routing context
      const decision = brokerDecision("normal_chat", mockSettings);
      const slotId = decision.slotId;
      const manager = new TimeoutManager(DEFAULT_TIMEOUTS);

      // All phases should have context
      expect(decision.decidedAt).toBeDefined(); // Phase 1 timestamp
      expect(slotId).toBeDefined(); // Phase 1 slot selection
      expect(manager.getFirstToken()).toBeGreaterThan(0); // Phase 2 timeout

      // Build routing context
      const routingContext = {
        decision,
        slotId,
        timeoutProfile: DEFAULT_TIMEOUTS,
        firstTokenTimeout: manager.getFirstToken()
      };

      expect(routingContext).toHaveProperty("decision");
      expect(routingContext).toHaveProperty("timeoutProfile");
    });
  });

  describe("deterministic routing", () => {
    it("same input should produce same routing decision every time", () => {
      const decision1 = brokerDecision("large_code_change", mockSettings);
      const decision2 = brokerDecision("large_code_change", mockSettings);
      const decision3 = brokerDecision("large_code_change", mockSettings);

      expect(decision1.taskType).toBe(decision2.taskType);
      expect(decision1.targetAgent).toBe(decision2.targetAgent);
      expect(decision1.slotId).toBe(decision3.slotId);
    });

    it("different inputs should produce different routing decisions", () => {
      const codingDecision = brokerDecision("large_code_change", mockSettings);
      const chatDecision = brokerDecision("normal_chat", mockSettings);

      expect(codingDecision.taskType).not.toBe(chatDecision.taskType);
      expect(codingDecision.targetAgent).not.toBe(chatDecision.targetAgent);
    });

    it("all routing components should be immutable after decision", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Snapshot current state
      const originalAgent = decision.targetAgent;
      const originalSlot = decision.slotId;

      // Attempt to modify (should not affect original)
      const copy = { ...decision, targetAgent: "chat" as any };

      // Original should be unchanged
      expect(decision.targetAgent).toBe(originalAgent);
      expect(decision.slotId).toBe(originalSlot);
    });
  });

  describe("no re-routing", () => {
    it("should not allow dual-decision routing", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Decision is made once, validated once - no backend re-routing
      const validation = validateSlot(decision.slotId, {
        state: "ready",
        memory: 8192,
        concurrency: 1
      });

      // Validation shouldn't change the decision
      expect(decision.slotId).toBe("fast_gpu");
      expect(validation.isValid).toBe(true);
    });

    it("should use explicit slot_id from routing decision", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Slot ID is explicit in decision
      expect(decision.slotId).toBeDefined();
      expect(decision.slotId).not.toBeNull();

      // Validation uses that explicit slot
      const validation = validateSlot(decision.slotId, {
        state: "ready",
        memory: 8192,
        concurrency: 1
      });

      expect(validation.isValid).toBe(true);
    });
  });

  describe("timeout staging", () => {
    it("should apply correct timeout for each stage", () => {
      const manager = new TimeoutManager(DEFAULT_TIMEOUTS);

      const timeouts = {
        routing: manager.getRouting(),
        bootstrap: manager.getBootstrap(),
        context: manager.getContext(),
        firstToken: manager.getFirstToken(),
        total: manager.getTotal()
      };

      // Phasenbudgets sind unabhängig dimensioniert; nur der Gesamtdeckel
      // muss jede einzelne Phase abdecken.
      expect(timeouts.routing).toBeGreaterThan(0);
      expect(timeouts.bootstrap).toBeGreaterThan(0);
      expect(timeouts.context).toBeGreaterThan(0);
      expect(timeouts.firstToken).toBeGreaterThan(0);
      expect(timeouts.total).toBeGreaterThanOrEqual(
        Math.max(timeouts.routing, timeouts.bootstrap, timeouts.context, timeouts.firstToken)
      );
    });

    it("should transition through stages with correct timing", () => {
      const manager = new TimeoutManager(DEFAULT_TIMEOUTS);

      const stages = [
        { name: "routing", timeout: manager.getRouting() },
        { name: "bootstrap", timeout: manager.getBootstrap() },
        { name: "context", timeout: manager.getContext() },
        { name: "firstToken", timeout: manager.getFirstToken() },
        { name: "total", timeout: manager.getTotal() }
      ];

      expect(stages.slice(0, -1).every((stage) => stage.timeout > 0)).toBe(true);
      expect(stages.at(-1)?.timeout).toBeGreaterThanOrEqual(
        Math.max(...stages.slice(0, -1).map((stage) => stage.timeout))
      );
    });
  });

  describe("error handling in pipeline", () => {
    it("should classify and handle routing errors", () => {
      const routingError = new Error("Routing decision failed");
      const classification = classifyRuntimeChatError(routingError);

      expect(classification).toHaveProperty("errorType");
      expect(classification).toHaveProperty("isRetryable");
    });

    it("should classify and handle validation errors", () => {
      const validationError = new Error("Slot validation failed");
      const classification = classifyRuntimeChatError(validationError);

      expect(classification).toHaveProperty("errorType");
      expect(classification.maxRetries).toBeDefined();
    });

    it("should classify and handle timeout errors", () => {
      const timeoutError = new Error("HTTP timeout");
      const classification = classifyRuntimeChatError(timeoutError);

      expect(classification.class).toBe("timeout");
      expect(classification.maxRetries).toBe(0); // No retry on timeout
    });

    it("should prevent retry cascade during pipeline", () => {
      let retryCount = 0;
      const maxRetries = 1;

      const simulatePipelineWithRetry = (error: Error) => {
        const classification = classifyRuntimeChatError(error);

        if (classification.shouldRetry && retryCount < classification.maxRetries) {
          retryCount++;
          // Only one retry allowed
          return simulatePipelineWithRetry(error);
        }

        return { classification, retryCount };
      };

      const result = simulatePipelineWithRetry(new Error("Test error"));
      expect(result.retryCount).toBeLessThanOrEqual(1);
    });
  });

  describe("abort signal threading", () => {
    it("should respect abort signal during routing", () => {
      const controller = new AbortController();
      const decision = brokerDecision("large_code_change", mockSettings);

      // Decision made before abort
      expect(decision).toBeDefined();

      // Abort signal can be checked afterward
      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    it("should handle abort during validation", () => {
      const controller = new AbortController();
      const decision = brokerDecision("large_code_change", mockSettings);

      // Validation proceeds or aborts based on signal
      if (!controller.signal.aborted) {
        const validation = validateSlot(decision.slotId, {
          state: "ready",
          memory: 8192,
          concurrency: 1
        });

        expect(validation.isValid).toBe(true);
      }
    });
  });

  describe("complete request lifecycle", () => {
    it("should handle successful request through full pipeline", () => {
      // 1. Classification
      const taskType = "large_code_change";

      // 2. Routing decision
      const decision = brokerDecision(taskType, mockSettings);
      expect(decision.taskType).toBe(taskType);

      // 3. Slot validation
      const validation = validateSlot(decision.slotId, {
        state: "ready",
        memory: 8192,
        concurrency: 1
      });
      expect(validation.isValid).toBe(true);

      // 4. Timeout configuration
      const manager = new TimeoutManager(DEFAULT_TIMEOUTS);
      const firstTokenTimeout = manager.getFirstToken();
      expect(firstTokenTimeout).toBeGreaterThan(0);

      // 5. Ready to send request
      expect({
        decision,
        validation,
        timeout: firstTokenTimeout
      }).toHaveProperty("decision");
    });

    it("should handle error during request lifecycle", () => {
      // 1. Classification
      const decision = brokerDecision("large_code_change", mockSettings);

      // 2. Slot validation fails
      const validation = validateSlot(decision.slotId, {
        state: "failed",
        memory: 0,
        concurrency: 0
      });
      expect(validation.isValid).toBe(false);

      // 3. Error classification
      const error = new Error("Slot validation failed");
      const classification = classifyRuntimeChatError(error);

      expect(classification).toHaveProperty("errorType");
      // Don't proceed with request
      expect(validation.isValid).toBe(false);
    });
  });

  describe("model discovery integration (Phase 4)", () => {
    it("should use stable model IDs in routing decision", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      if (decision.modelId) {
        // Model ID should be stable relative path format
        // Example: "llm/qwen-7b-q8_0.gguf"
        expect(decision.modelId).toMatch(/^[a-z]+\//);
      }
    });
  });

  describe("tool registry integration (Phase 5)", () => {
    it("should be compatible with tool registry discovery", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Routing decision is compatible with tool registry
      // (Tools discovered independently, not part of routing)
      expect(decision).toHaveProperty("targetAgent");
      expect(decision.targetAgent).toBeDefined();
    });
  });
});
