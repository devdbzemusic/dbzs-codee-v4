export type AssistantQuestionType =
  | "single_choice"
  | "multi_choice"
  | "boolean"
  | "free_text"
  | "file_picker"
  | "folder_picker"
  | "confirm_risky_action";

export type ClarificationWorkflow = "coding" | "review" | "planning";

export interface AssistantQuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  value?: string;
}

export interface AssistantQuestion {
  id: string;
  questionType: AssistantQuestionType;
  prompt: string;
  context?: string;
  options?: AssistantQuestionOption[];
  allowFreeText?: boolean;
  freeTextPlaceholder?: string;
  defaultOptionId?: string;
  riskLevel?: "low" | "medium" | "high";
  toolCallId: string;
  /** Stable missing-information field this question answers (e.g. success_criteria). */
  requiredField?: string;
  workflow?: ClarificationWorkflow;
}

export interface AssistantAnswer {
  questionId: string;
  answeredAt: string;
  optionIds?: string[];
  freeText?: string;
  filePath?: string;
  skipped?: boolean;
}

export interface DecisionMemoryEntry {
  id: string;
  workflow: ClarificationWorkflow;
  /** The missing-field or ambiguity question this answer resolves, used for future keyword-overlap matching. */
  questionPrompt: string;
  answer: AssistantAnswer;
  scope: "run" | "project";
  decidedAt: string;
  expiresAt?: string;
}
