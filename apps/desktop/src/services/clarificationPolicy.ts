import type { AssistantQuestion } from "@dbzs/shared";
import type { IntentClassification } from "@/services/modelSelectionBroker";
import type { RequiredFieldCheck } from "@/services/missingInformationPolicy";

export const CONFIDENCE_THRESHOLD = 0.5;
export const TOP2_MARGIN_THRESHOLD = 0.15;
export const MAX_QUESTIONS_PER_TURN = 1;
export const MAX_QUESTIONS_PER_RUN = 3;

export type ClarificationReason =
  | "low_confidence"
  | "ambiguous_top2"
  | "missing_required_field"
  | "high_risk_confirm"
  | "high_risk_ambiguity"
  | "budget_exceeded"
  | "none";

export interface ClarificationPolicyInput {
  intent: IntentClassification;
  missingFields: RequiredFieldCheck[];
  riskLevel: "low" | "medium" | "high";
  questionsAskedThisTurn: number;
  questionsAskedThisRun: number;
}

export interface ClarificationPolicyResult {
  shouldAsk: boolean;
  reason: ClarificationReason;
  question?: AssistantQuestion;
}

function budgetExceeded(input: ClarificationPolicyInput): boolean {
  return (
    input.questionsAskedThisTurn >= MAX_QUESTIONS_PER_TURN ||
    input.questionsAskedThisRun >= MAX_QUESTIONS_PER_RUN
  );
}

/**
 * Decides whether Codee should pause and ask a clarifying question. Missing
 * required fields take priority over ambiguity/confidence, since a missing
 * fact blocks correct execution outright while ambiguity is merely a risk.
 * The budget cap always wins last: once exhausted, the caller is expected to
 * proceed with its best-guess assumption and state it explicitly rather than
 * ask indefinitely.
 */
export function decideClarification(input: ClarificationPolicyInput): ClarificationPolicyResult {
  const missing = input.missingFields.find((entry) => !entry.present);
  const { intent } = input;
  const topAlternative = intent.alternativeTaskTypes[0];
  const isAmbiguous =
    topAlternative !== undefined &&
    intent.confidence - topAlternative.confidence < TOP2_MARGIN_THRESHOLD;
  const isLowConfidence = intent.confidence < CONFIDENCE_THRESHOLD;

  if (input.riskLevel === "high") {
    if (budgetExceeded(input)) {
      return { shouldAsk: false, reason: "budget_exceeded" };
    }
    if (missing) {
      return { shouldAsk: true, reason: "high_risk_confirm", question: missing.askIfMissing };
    }
    if (isAmbiguous || isLowConfidence) {
      return { shouldAsk: true, reason: "high_risk_ambiguity" };
    }
  }

  if (missing) {
    if (budgetExceeded(input)) {
      return { shouldAsk: false, reason: "budget_exceeded" };
    }
    return { shouldAsk: true, reason: "missing_required_field", question: missing.askIfMissing };
  }

  // Codex-like default: ambiguity alone is not enough to interrupt the flow.
  // Once required fields are satisfied, proceed with the best available
  // assumption unless the caller explicitly marks the turn as high-risk.

  return { shouldAsk: false, reason: "none" };
}
