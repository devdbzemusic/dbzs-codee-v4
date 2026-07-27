import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  MAX_QUESTIONS_PER_RUN,
  MAX_QUESTIONS_PER_TURN,
  TOP2_MARGIN_THRESHOLD,
  decideClarification
} from "@/services/clarificationPolicy";
import type { IntentClassification } from "@/services/modelSelectionBroker";
import type { RequiredFieldCheck } from "@/services/missingInformationPolicy";

function intent(overrides: Partial<IntentClassification> = {}): IntentClassification {
  return {
    taskType: "small_code_change",
    confidence: 0.9,
    matchedPatterns: ["fix"],
    alternativeTaskTypes: [],
    ...overrides
  };
}

function question(): import("@dbzs/shared").AssistantQuestion {
  return {
    id: "q1",
    questionType: "free_text",
    prompt: "Welche Datei?",
    toolCallId: "test"
  };
}

function missingField(present: boolean): RequiredFieldCheck {
  return { field: "target", present, askIfMissing: question() };
}

describe("decideClarification", () => {
  it("asks when a required field is missing", () => {
    const result = decideClarification({
      intent: intent(),
      missingFields: [missingField(false)],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(true);
    expect(result.reason).toBe("missing_required_field");
    expect(result.question).toBeDefined();
  });

  it("does not ask when all required fields are present and confidence is high", () => {
    const result = decideClarification({
      intent: intent({ confidence: 0.9 }),
      missingFields: [missingField(true)],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(false);
    expect(result.reason).toBe("none");
  });

  it("asks on low confidence even with no missing fields", () => {
    const result = decideClarification({
      intent: intent({ confidence: CONFIDENCE_THRESHOLD - 0.01 }),
      missingFields: [],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(true);
    expect(result.reason).toBe("low_confidence");
  });

  it("does not ask exactly at the confidence threshold", () => {
    const result = decideClarification({
      intent: intent({ confidence: CONFIDENCE_THRESHOLD }),
      missingFields: [],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(false);
  });

  it("asks when top two candidates are within the ambiguity margin", () => {
    const result = decideClarification({
      intent: intent({
        confidence: 0.8,
        alternativeTaskTypes: [{ taskType: "large_code_change", confidence: 0.8 - TOP2_MARGIN_THRESHOLD + 0.01 }]
      }),
      missingFields: [],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(true);
    expect(result.reason).toBe("ambiguous_top2");
  });

  it("does not ask when the runner-up is far below the margin", () => {
    const result = decideClarification({
      intent: intent({
        confidence: 0.9,
        alternativeTaskTypes: [{ taskType: "large_code_change", confidence: 0.9 - TOP2_MARGIN_THRESHOLD - 0.1 }]
      }),
      missingFields: [],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(false);
  });

  it("always asks once for high risk actions even with a missing field", () => {
    const result = decideClarification({
      intent: intent(),
      missingFields: [missingField(false)],
      riskLevel: "high",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(true);
    expect(result.reason).toBe("high_risk_confirm");
  });

  it("stops asking once the per-turn budget is exhausted", () => {
    const result = decideClarification({
      intent: intent(),
      missingFields: [missingField(false)],
      riskLevel: "low",
      questionsAskedThisTurn: MAX_QUESTIONS_PER_TURN,
      questionsAskedThisRun: 0
    });
    expect(result.shouldAsk).toBe(false);
    expect(result.reason).toBe("budget_exceeded");
  });

  it("stops asking once the per-run budget is exhausted", () => {
    const result = decideClarification({
      intent: intent(),
      missingFields: [missingField(false)],
      riskLevel: "low",
      questionsAskedThisTurn: 0,
      questionsAskedThisRun: MAX_QUESTIONS_PER_RUN
    });
    expect(result.shouldAsk).toBe(false);
    expect(result.reason).toBe("budget_exceeded");
  });
});
