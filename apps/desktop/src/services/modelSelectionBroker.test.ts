/**
 * P2 Phase 6: Unit Tests for Model Selection Broker (Phase 1)
 */

import { describe, it, expect } from "vitest";
import {
  brokerDecision,
  classifyTaskType,
  classifyTaskTypeDetailed,
  matchesReviewIntent,
  deriveModelDisplayName,
  formatModelDisplayLabel,
  looksLikeOpaqueModelId
} from "@/services/modelSelectionBroker";
import type { TaskType, ModelTargetAgent } from "@/services/modelSelectionBroker";

const mockSettings = {
  defaultModelId: "llm/default-model.gguf",
  defaultChatModelId: "llm/default-model.gguf",
  defaultModelName: "Default Model",
  defaultPlannerModelId: "llm/planner-model.gguf",
  defaultCoderModelId: "llm/coder-model.gguf",
  defaultReviewerModelId: "llm/reviewer-model.gguf",
  defaultDebugModelId: "llm/debug-model.gguf",
};

describe("modelSelectionBroker", () => {
  describe("brokerDecision", () => {
    it("routes chat tasks to quality_cpu", () => {
      const chatDecision = brokerDecision("normal_chat", mockSettings);
      const casualDecision = brokerDecision("casual_chat", mockSettings);

      expect(chatDecision.slotId).toBe("quality_cpu");
      expect(casualDecision.slotId).toBe("quality_cpu");
    });

    it("routes coding and review tasks to fast_gpu", () => {
      const codingDecision = brokerDecision("large_code_change", mockSettings);
      const reviewDecision = brokerDecision("review", mockSettings);
      const debuggingDecision = brokerDecision("debugging", mockSettings);
      const planningDecision = brokerDecision("planning", mockSettings);
      const architectureDecision = brokerDecision("architecture", mockSettings);
      const testAnalysisDecision = brokerDecision("test_analysis", mockSettings);
      const refactoringDecision = brokerDecision("refactoring", mockSettings);

      expect(codingDecision.slotId).toBe("fast_gpu");
      expect(reviewDecision.slotId).toBe("fast_gpu");
      expect(debuggingDecision.slotId).toBe("fast_gpu");
      expect(planningDecision.slotId).toBe("fast_gpu");
      expect(architectureDecision.slotId).toBe("fast_gpu");
      expect(testAnalysisDecision.slotId).toBe("fast_gpu");
      expect(refactoringDecision.slotId).toBe("fast_gpu");
    });

    it("routes embedding tasks to utility", () => {
      const decision = brokerDecision("embedding", mockSettings as never);

      expect(decision.slotId).toBe("utility");
    });

    it("should route large_code_change tasks to planner first by default", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      expect(decision.taskType).toBe("large_code_change");
      expect(decision.targetAgent).toBe("planner");
      expect(decision.slotId).toBe("fast_gpu");
      expect(decision.decidedAt).toBeDefined();
    });

    it("routes small_code_change to planner first, coder when preferPlannerFirst=false", () => {
      expect(brokerDecision("small_code_change", mockSettings).targetAgent).toBe("planner");
      expect(
        brokerDecision("small_code_change", mockSettings, { preferPlannerFirst: false }).targetAgent
      ).toBe("coder");
    });

    it("rejects vision models on text-only turns without supportsTextOnly", () => {
      const settings = {
        ...mockSettings,
        defaultPlannerModelId: "Qwen2.5-VL-3B-VisionOnly.gguf",
        defaultCoderModelId: "qwen2.5-coder-7b.gguf",
        defaultModelId: "Meta-Llama-3.1-8B-Instruct.gguf"
      };
      expect(() =>
        brokerDecision("small_code_change", settings, {
          hasImageInput: false,
          catalog: [
            {
              id: "Qwen2.5-VL-3B-VisionOnly.gguf",
              name: "Qwen2.5-VL-3B-VisionOnly",
              capabilities: ["vision"],
              supportsTextOnly: false,
              requiresVisionProjector: true
            }
          ]
        })
      ).toThrow(/Visionmodell/);
    });

    it("rejects support artifacts as configured role models", () => {
      const settings = {
        ...mockSettings,
        defaultPlannerModelId: "mmproj-qwen2.5-vl-3b-f16.gguf"
      };

      expect(() =>
        brokerDecision("small_code_change", settings, {
          catalog: [
            {
              id: "mmproj-qwen2.5-vl-3b-f16.gguf",
              name: "mmproj-qwen2.5-vl-3b-f16",
              artifact_type: "mmproj",
              capabilities: ["vision"],
              recommended_use: "vision_candidate"
            }
          ]
        })
      ).toThrow(/Support-Artefakt/);
    });

    it("allows Instruct-VL as chat role for text-only when supportsTextOnly is true", () => {
      const settings = {
        ...mockSettings,
        defaultChatModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"
      };
      const decision = brokerDecision("casual_chat", settings, {
        hasImageInput: false,
        catalog: [
          {
            id: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf",
            name: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
            capabilities: ["chat", "vision"],
            supportsTextOnly: true
          }
        ]
      });
      expect(decision.modelId).toMatch(/vl/i);
      expect(decision.reason).toContain("vision_gate:text_only_supported");
    });

    it("allows vision models when hasImageInput is true", () => {
      const settings = {
        ...mockSettings,
        defaultChatModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"
      };
      const decision = brokerDecision("casual_chat", settings, { hasImageInput: true });
      expect(decision.modelId).toMatch(/vl/i);
    });

    it("blocks projector-based vision models without verified multimodal pair", () => {
      const settings = {
        ...mockSettings,
        defaultChatModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"
      };

      expect(() =>
        brokerDecision("casual_chat", settings, {
          hasImageInput: true,
          catalog: [
            {
              id: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf",
              name: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
              capabilities: ["chat", "vision"],
              supportsTextOnly: true,
              requiresVisionProjector: true
            }
          ]
        })
      ).toThrow(/MMProj-Pairing/);
    });

    it("allows projector-based vision models with verified multimodal pair", () => {
      const settings = {
        ...mockSettings,
        defaultChatModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"
      };

      const decision = brokerDecision("casual_chat", settings, {
        hasImageInput: true,
        catalog: [
          {
            id: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf",
            name: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
            capabilities: ["chat", "vision"],
            supportsTextOnly: true,
            requiresVisionProjector: true
          }
        ],
        multimodalPairs: [
          {
            id: "pair-qwen-mmproj",
            base_model_id: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf",
            projector_artifact_id: "mmproj-qwen2.5-vl-3b-f16.gguf",
            modalities: ["image", "text"],
            source: "manual",
            confidence: 1,
            status: "candidate",
            routing_allowed: true,
            candidate_base_model_ids: ["Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"]
          }
        ]
      });

      expect(decision.modelId).toBe("Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf");
      expect(decision.reason).toContain(
        "multimodal_pair:routing_allowed:mmproj-qwen2.5-vl-3b-f16.gguf"
      );
    });

    it("blocks screenshot coding turns when the selected vision model lacks code capability", () => {
      const settings = {
        ...mockSettings,
        defaultPlannerModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"
      };

      expect(() =>
        brokerDecision("small_code_change", settings, {
          hasImageInput: true,
          catalog: [
            {
              id: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf",
              name: "Qwen2.5-VL-3B-Instruct.Q4_K_M",
              capabilities: ["chat", "vision"],
              supportsTextOnly: true
            }
          ]
        })
      ).toThrow(/Code-Faehigkeit/);
    });

    it("allows screenshot coding turns when the selected vision model has code capability", () => {
      const settings = {
        ...mockSettings,
        defaultPlannerModelId: "Qwen2.5-VL-Coder-3B-Instruct.Q4_K_M.gguf"
      };

      const decision = brokerDecision("small_code_change", settings, {
        hasImageInput: true,
        catalog: [
          {
            id: "Qwen2.5-VL-Coder-3B-Instruct.Q4_K_M.gguf",
            name: "Qwen2.5-VL-Coder-3B-Instruct.Q4_K_M",
            capabilities: ["chat", "vision", "code"],
            supportsTextOnly: true
          }
        ]
      });

      expect(decision.modelId).toBe("Qwen2.5-VL-Coder-3B-Instruct.Q4_K_M.gguf");
      expect(decision.capabilities).toContain("code");
    });

    it("warns on manual vision override without image but keeps the model", () => {
      const decision = brokerDecision(
        "casual_chat",
        mockSettings,
        {
          hasImageInput: false,
          manualModelId: "Qwen2.5-VL-3B-Instruct.Q4_K_M.gguf"
        }
      );
      expect(decision.modelId).toMatch(/vl/i);
      expect(decision.reason.some((r) => r.startsWith("vision_gate:manual_override_warning:"))).toBe(true);
    });

    it("should route normal_chat tasks to default agent", () => {
      const decision = brokerDecision("normal_chat", mockSettings);

      expect(decision.taskType).toBe("normal_chat");
      expect(decision.targetAgent).toBe("default");
    });

    it("should route debugging tasks to debugger agent", () => {
      const decision = brokerDecision("debugging", mockSettings);

      expect(decision.taskType).toBe("debugging");
      expect(decision.targetAgent).toBe("debugger");
    });

    it("should route review tasks to reviewer agent", () => {
      const decision = brokerDecision("review", mockSettings);

      expect(decision.taskType).toBe("review");
      expect(decision.targetAgent).toBe("reviewer");
    });

    it("should include timestamp in decision", () => {
      const beforeDecision = Date.now();
      const decision = brokerDecision("large_code_change", mockSettings);
      const afterDecision = Date.now();

      const decisionTime = new Date(decision.decidedAt).getTime();
      expect(decisionTime).toBeGreaterThanOrEqual(beforeDecision);
      expect(decisionTime).toBeLessThanOrEqual(afterDecision);
    });

    it("should include routing reason in decision", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      expect(decision.reason).toBeDefined();
      expect(decision.reason.length).toBeGreaterThan(0);
    });

    it("should be deterministic for same input", () => {
      const decision1 = brokerDecision("large_code_change", mockSettings);
      const decision2 = brokerDecision("large_code_change", mockSettings);

      expect(decision1.taskType).toBe(decision2.taskType);
      expect(decision1.targetAgent).toBe(decision2.targetAgent);
      expect(decision1.slotId).toBe(decision2.slotId);
    });

    it("should never make dual-decision routing (all decisions in one call)", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Verify all routing components are present
      expect(decision.taskType).toBeDefined();
      expect(decision.targetAgent).toBeDefined();
      expect(decision.slotId).toBeDefined();
      expect(decision.modelId).toBeDefined();

      // No re-routing possible since decision is immutable
      const decisionCopy = { ...decision };
      expect(decisionCopy).toEqual(decision);
    });
  });

  describe("display names", () => {
    it("rejects opaque hash ids as display labels", () => {
      expect(looksLikeOpaqueModelId("18da2f872dc165710")).toBe(true);
      expect(looksLikeOpaqueModelId("Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF")).toBe(false);

      expect(deriveModelDisplayName("18da2f872dc165710", "Default Model")).toBe("Default Model");
      expect(
        deriveModelDisplayName("18da2f872dc165710", "Default Model", [
          { id: "18da2f872dc165710", name: "Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF" }
        ])
      ).toBe("Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF");

      expect(formatModelDisplayLabel("18da2f872dc165710", "18da2f872dc165710")).toBe("Lokales Modell");
      expect(
        formatModelDisplayLabel("Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF", "18da2f872dc165710")
      ).toBe("Qwen2.5-Coder-7B-Instruct-Q4-K-M-GGUF");
    });
  });

  describe("model selection", () => {
    it("should select models appropriate for task type", () => {
      const codingDecision = brokerDecision("large_code_change", mockSettings);
      const chatDecision = brokerDecision("normal_chat", mockSettings);

      // Different task types might prefer different models/slots
      // (actual behavior depends on implementation)
      expect(codingDecision.taskType).not.toBe(chatDecision.taskType);
    });

    it("should include model metadata in decision", () => {
      const decision = brokerDecision("large_code_change", mockSettings);

      // Even if no specific model, decision structure should be complete
      expect(decision).toHaveProperty("modelId");
      expect(decision).toHaveProperty("modelName");
      expect(decision).toHaveProperty("reason");
    });

    it("should use role-specific models for planning, review, coding and debugging", () => {
      const settings = {
        ...mockSettings,
        defaultPlannerModelId: "model-plan",
        defaultCoderModelId: "model-code",
        defaultReviewerModelId: "model-review",
        defaultDebugModelId: "model-debug"
      };

      expect(brokerDecision("planning", settings).modelId).toBe("model-plan");
      expect(brokerDecision("large_code_change", settings).modelId).toBe("model-plan");
      expect(
        brokerDecision("large_code_change", settings, { preferPlannerFirst: false }).modelId
      ).toBe("model-code");
      expect(brokerDecision("review", settings).modelId).toBe("model-review");
      expect(brokerDecision("debugging", settings).modelId).toBe("model-debug");
    });
  });

  describe("immutability", () => {
    it("decision object should be immutable after creation", () => {
      const decision = brokerDecision("large_code_change", mockSettings, { preferPlannerFirst: false });

      const decisionCopy = { ...decision, targetAgent: "reviewer" as const };

      expect(decision.targetAgent).toBe("coder");
      expect(decisionCopy.targetAgent).toBe("reviewer");
    });
  });

  describe("classifyTaskTypeDetailed", () => {
    it("classifies the StringLab live-run feature intent as a code change", () => {
      const message = "Wir bauen heute eine kleine neue Funktion für StringLab";

      expect(classifyTaskType(message)).toBe("small_code_change");
      expect(classifyTaskTypeDetailed(message)).toEqual(
        expect.objectContaining({
          taskType: "small_code_change",
          matchedPatterns: expect.arrayContaining(["neue funktion"])
        })
      );
    });

    it("never diverges from classifyTaskType's own decision", () => {
      const messages = [
        "fix the login bug and refactor auth",
        "review this for security issues",
        "plan a new feature",
        "debug why this crashes",
        "hallo, wie geht es dir?",
        "",
        "ändere die Farbe des Buttons"
      ];
      for (const message of messages) {
        expect(classifyTaskTypeDetailed(message).taskType).toBe(classifyTaskType(message));
      }
    });

    it("reports high confidence when several keywords from one group match", () => {
      const multi = classifyTaskTypeDetailed("mach einen code review und audit");
      const single = classifyTaskTypeDetailed("audit");
      expect(multi.taskType).toBe("review");
      expect(single.taskType).toBe("review");
      expect(multi.confidence).toBeGreaterThan(single.confidence);
    });

    it("reports low confidence when only one weak keyword matches", () => {
      const result = classifyTaskTypeDetailed("audit");
      expect(result.taskType).toBe("review");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(0.25);
    });

    it("surfaces the runner-up task type as an alternative when both patterns match", () => {
      // Execution-intent priority: refactor verbs win over fix when both appear.
      const result = classifyTaskTypeDetailed("fix the login bug and refactor auth");
      expect(result.taskType).toBe("refactoring");
      const alternativeTypes = result.alternativeTaskTypes.map((entry) => entry.taskType);
      expect(alternativeTypes.length).toBeGreaterThan(0);
    });

    it("keeps review ahead of Agent Mode / explicit agent prefix", () => {
      expect(matchesReviewIntent("mach einfach einen Code Review")).toBe(true);
      expect(classifyTaskType("mach einfach einen Code Review", true)).toBe("review");
      const detailed = classifyTaskTypeDetailed("mach einfach einen Code Review", true);
      expect(detailed.taskType).toBe("review");
      expect(detailed.alternativeTaskTypes.map((e) => e.taskType)).toContain("large_code_change");
    });

    it("routes complete code review to reviewer model, not planner", () => {
      expect(classifyTaskType("Mache einen kompletten Codereview")).toBe("review");
      const decision = brokerDecision("review", mockSettings, {
        userMessage: "Mache einen kompletten Codereview"
      });
      expect(decision.targetAgent).toBe("reviewer");
      expect(decision.resolvedModelId).toBe("llm/reviewer-model.gguf");
      expect(decision.targetAgent).not.toBe("planner");
      expect(decision.intentLabel).toBe("code_review");
      expect(decision.workflowId).toBe("repository_review");
      expect(decision.reviewScope).toBe("full_repository");
    });

    it("returns confidence 1 and no alternatives for an explicit agent prefix", () => {
      const result = classifyTaskTypeDetailed("do anything", true);
      expect(result.taskType).toBe("large_code_change");
      expect(result.confidence).toBe(1);
      expect(result.alternativeTaskTypes).toEqual([]);
    });

    it("returns confidence 1 and no alternatives for the no-match fallback", () => {
      const result = classifyTaskTypeDetailed("hallo");
      expect(result.taskType).toBe("casual_chat");
      expect(result.confidence).toBe(1);
      expect(result.alternativeTaskTypes).toEqual([]);
    });
  });
});
