import type { AssistantQuestion, ClarificationWorkflow } from "@dbzs/shared";
import type { TaskType } from "@/services/modelSelectionBroker";
import {
  matchesCompleteRepositoryReviewIntent,
  resolveRepositoryReviewScope
} from "@/services/repositoryReview/reviewIntent";

export type { ClarificationWorkflow };

export function workflowForTaskType(taskType: TaskType): ClarificationWorkflow | null {
  if (taskType === "small_code_change" || taskType === "large_code_change" || taskType === "refactoring") {
    return "coding";
  }
  if (taskType === "review" || taskType === "test_analysis") {
    return "review";
  }
  if (taskType === "planning" || taskType === "architecture") {
    return "planning";
  }
  return null;
}

export interface RequiredFieldCheck {
  field: string;
  present: boolean;
  askIfMissing: AssistantQuestion;
}

export interface MissingInformationState {
  answeredFields: ReadonlySet<string>;
  confirmedGoal?: string;
  acceptanceCriteria?: string[];
}

interface MissingInfoContext {
  hasFileContext: boolean;
  state: MissingInformationState;
}

const ACCEPTANCE_HINT_PATTERN = /(sodass|so dass|damit|so that|and it should|und es soll|erfolgreich wenn|until|bis)/i;
const SCOPE_HINT_PATTERN = /(nur in|only in|across|im ganzen|projektweit|gesamte[sn]?|überall|everywhere|module?)/i;
const REVIEW_FOCUS_PATTERN = /(security|sicherheit|performance|architektur|architecture|style|korrektheit|correctness|bugs?)/i;
const SUCCESS_CRITERIA_PATTERN = /(erfolg(reich)?|success|fertig ist|definition of done|acceptance|abnahmekriterium)/i;
const CONSTRAINTS_PATTERN = /(einschränkung|constraint|darf nicht|must not|ohne|without|stack|technologie|technology)/i;
const NO_CONSTRAINTS_PATTERN =
  /(keine\s+(weiteren\s+)?(vorgaben|einschränkungen)|keine\s+zusätzlichen|no\s+(additional\s+)?constraints|bestehenden?\s+projektkonventionen)/i;
const TARGET_PATH_PATTERN = /[\w./-]+\.(ts|tsx|js|jsx|py|md|json|yaml|yml)\b|apps\/|packages\/|backend\//i;
const OPEN_FEATURE_PATTERN = /(neue?\s+funktion|neues?\s+feature|new\s+(function|feature)|\bfeature\s+bauen\b)/i;
const SMALL_CHANGE_HINT_PATTERN =
  /(fix|bug|fehler|patch|klein|small|anpassen|rename|umbenennen|update|korrigier|refine|adjust)/i;
const QUICK_ACCEPTANCE_HINT_PATTERN =
  /(soll|should|wenn|when|danach|after|render|anzeigen|sichtbar|test|grün|green)/i;
const PRESERVE_BEHAVIOR_PATTERN =
  /(verhalte[ns]?.*nicht|ohne\s+verhaltens[aä]nderung|behavior\s+should\s+not\s+change|behaviour\s+should\s+not\s+change|do\s+not\s+change\s+behavio[u]?r|ohne\s+das\s+verhalten\s+zu\s+ändern)/i;
const PLAN_DELIVERABLE_PATTERN =
  /(implementierungsplan|umsetzungsplan|konkrete[nr]?\s+schritte|n[aä]chste[nr]?\s+schritte|reihenfolge|risiken|tests?|plan\s+mit|roadmap)/i;
const FILE_LOCAL_SCOPE_PATTERN =
  /(nur\s+in\s+(dieser|der)\s+datei|only\s+this\s+file|nur\s+diese\s+datei|single[_ -]?file)/i;

function questionId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyState(): MissingInformationState {
  return { answeredFields: new Set() };
}

function fieldAnswered(state: MissingInformationState, field: string): boolean {
  return state.answeredFields.has(field);
}

function targetIdentifiable(message: string, ctx: MissingInfoContext): boolean {
  return ctx.hasFileContext || TARGET_PATH_PATTERN.test(message) || fieldAnswered(ctx.state, "target");
}

function withFieldMeta(
  workflow: ClarificationWorkflow,
  field: string,
  question: Omit<AssistantQuestion, "requiredField" | "workflow">
): AssistantQuestion {
  return {
    ...question,
    requiredField: field,
    workflow
  };
}

function checkCoding(
  taskType: TaskType,
  message: string,
  ctx: MissingInfoContext
): RequiredFieldCheck[] {
  const checks: RequiredFieldCheck[] = [];
  const hasTarget = targetIdentifiable(message, ctx);
  const isOpenFeatureIntent = OPEN_FEATURE_PATTERN.test(message);
  const isSmallChange =
    taskType === "small_code_change" || (!isOpenFeatureIntent && SMALL_CHANGE_HINT_PATTERN.test(message));
  const shouldAskTarget = !hasTarget && !ctx.hasFileContext;

  checks.push({
    field: "target",
    present: hasTarget || !shouldAskTarget,
    askIfMissing: withFieldMeta("coding", "target", {
      id: questionId("q-target"),
      questionType: "free_text",
      prompt: isOpenFeatureIntent
        ? "Welche konkrete Funktion soll StringLab bekommen?"
        : "Welche Datei bzw. welches Modul soll geändert werden?",
      context: isOpenFeatureIntent
        ? "Ich frage zuerst nach dem gewünschten Verhalten und lade erst danach den passenden Projektkontext."
        : "Ohne Zieldatei kann ich die Änderung nicht sicher eingrenzen.",
      freeTextPlaceholder: isOpenFeatureIntent
        ? "z.B. Audio normalisieren und als neue Datei exportieren"
        : "z.B. apps/desktop/src/services/...",
      riskLevel: "medium",
      toolCallId: "missing-information-policy"
    })
  });

  const hasAcceptance =
    fieldAnswered(ctx.state, "acceptance_criteria") ||
    ACCEPTANCE_HINT_PATTERN.test(message) ||
    PRESERVE_BEHAVIOR_PATTERN.test(message) ||
    QUICK_ACCEPTANCE_HINT_PATTERN.test(message) ||
    Boolean(ctx.state.acceptanceCriteria?.length);
  const shouldAskAcceptance =
    taskType === "large_code_change" ||
    taskType === "refactoring" ||
    isOpenFeatureIntent ||
    (!hasAcceptance && !hasTarget && !ctx.hasFileContext);
  checks.push({
    field: "acceptance_criteria",
    present: hasAcceptance || !shouldAskAcceptance,
    askIfMissing: withFieldMeta("coding", "acceptance_criteria", {
      id: questionId("q-acceptance"),
      questionType: "free_text",
      prompt: "Woran erkennst du, dass die Änderung korrekt ist?",
      context: "Ein klares Abnahmekriterium verhindert, dass ich das falsche Verhalten baue.",
      freeTextPlaceholder: "z.B. Test X sollte danach grün sein / Button Y soll sichtbar sein",
      riskLevel: "low",
      toolCallId: "missing-information-policy"
    })
  });

  if (taskType === "refactoring" || taskType === "large_code_change") {
    const hasScope =
      fieldAnswered(ctx.state, "scope_boundary") ||
      SCOPE_HINT_PATTERN.test(message) ||
      FILE_LOCAL_SCOPE_PATTERN.test(message) ||
      (taskType === "refactoring" && hasTarget && PRESERVE_BEHAVIOR_PATTERN.test(message));
    checks.push({
      field: "scope_boundary",
      present: hasScope,
      askIfMissing: withFieldMeta("coding", "scope_boundary", {
        id: questionId("q-scope"),
        questionType: "single_choice",
        prompt: "Soll sich die Änderung nur auf diese Datei beschränken oder auch verwandte Module umfassen?",
        context: "Große Änderungen ohne klare Grenze riskieren einen deutlich größeren Diff als beabsichtigt.",
        options: [
          { id: "single_file", label: "Nur diese Datei", recommended: true },
          { id: "related_modules", label: "Auch direkt abhängige Module" },
          { id: "whole_project", label: "Projektweit" }
        ],
        defaultOptionId: "single_file",
        riskLevel: "medium",
        toolCallId: "missing-information-policy"
      })
    });
  }

  return checks;
}

function checkReview(message: string, ctx: MissingInfoContext): RequiredFieldCheck[] {
  const checks: RequiredFieldCheck[] = [];

  // Complete / full-repository review: scope is already explicit — do not ask.
  if (matchesCompleteRepositoryReviewIntent(message)) {
    return checks;
  }

  const resolvedScope = resolveRepositoryReviewScope(message);
  const answeredTarget = [...ctx.state.answeredFields].find((f) => f === "review_target")
    ? "answered"
    : null;

  const hasTarget =
    fieldAnswered(ctx.state, "review_target") ||
    targetIdentifiable(message, ctx) ||
    resolvedScope != null;
  checks.push({
    field: "review_target",
    present: hasTarget,
    askIfMissing: withFieldMeta("review", "review_target", {
      id: questionId("q-review-target"),
      questionType: "single_choice",
      prompt: "Was soll geprüft werden?",
      context: "Ohne Scope würde ich den Review-Umfang nur raten — wähle eine Option.",
      options: [
        { id: "active_file", label: "A – Aktive Datei", recommended: true },
        { id: "uncommitted", label: "B – Nicht commitete Änderungen" },
        { id: "last_commit", label: "C – Letzter Commit" },
        { id: "full_repository", label: "D – Gesamtes Projekt" }
      ],
      defaultOptionId: "active_file",
      allowFreeText: true,
      freeTextPlaceholder: "oder Pfad / Diff-Ziel frei eingeben",
      riskLevel: "low",
      toolCallId: "missing-information-policy"
    })
  });

  // Focus ask only when scope is not already a full-repo review.
  if (resolvedScope === "full_repository" || answeredTarget) {
    // Still ask focus unless message already has focus keywords — but skip for full repo complete path.
    if (resolvedScope === "full_repository") {
      return checks;
    }
  }

  const hasFocus = fieldAnswered(ctx.state, "review_focus") || REVIEW_FOCUS_PATTERN.test(message);
  checks.push({
    field: "review_focus",
    present: hasFocus,
    askIfMissing: withFieldMeta("review", "review_focus", {
      id: questionId("q-review-focus"),
      questionType: "single_choice",
      prompt: "Worauf soll sich das Review konzentrieren?",
      context: "Der Fokus bestimmt, wonach ich gezielt suche.",
      options: [
        { id: "correctness", label: "Korrektheit / Bugs", recommended: true },
        { id: "security", label: "Sicherheit" },
        { id: "architecture", label: "Architektur" },
        { id: "performance", label: "Performance" }
      ],
      defaultOptionId: "correctness",
      riskLevel: "low",
      toolCallId: "missing-information-policy"
    })
  });

  return checks;
}

function checkPlanning(message: string, ctx: MissingInfoContext): RequiredFieldCheck[] {
  const checks: RequiredFieldCheck[] = [];
  const hasStructuredPlanningGoal = PLAN_DELIVERABLE_PATTERN.test(message);

  const hasSuccessCriteria =
    fieldAnswered(ctx.state, "success_criteria") ||
    fieldAnswered(ctx.state, "acceptance_criteria") ||
    SUCCESS_CRITERIA_PATTERN.test(message) ||
    hasStructuredPlanningGoal ||
    QUICK_ACCEPTANCE_HINT_PATTERN.test(message) ||
    Boolean(ctx.state.acceptanceCriteria?.length);

  checks.push({
    field: "success_criteria",
    present: hasSuccessCriteria,
    askIfMissing: withFieldMeta("planning", "success_criteria", {
      id: questionId("q-success"),
      questionType: "free_text",
      prompt: "Woran würdest du erkennen, dass die Planung erfolgreich war?",
      context: "Ein Erfolgskriterium hilft mir, den Plan auf das Wesentliche zu fokussieren.",
      freeTextPlaceholder: "z.B. ein lauffähiger Prototyp mit Tests",
      riskLevel: "low",
      toolCallId: "missing-information-policy"
    })
  });

  const hasConstraints =
    fieldAnswered(ctx.state, "constraints") ||
    CONSTRAINTS_PATTERN.test(message) ||
    NO_CONSTRAINTS_PATTERN.test(message) ||
    ctx.hasFileContext ||
    hasStructuredPlanningGoal;

  checks.push({
    field: "constraints",
    present: hasConstraints,
    askIfMissing: withFieldMeta("planning", "constraints", {
      id: questionId("q-constraints"),
      questionType: "free_text",
      prompt: "Gibt es technische Einschränkungen oder Vorgaben (Stack, Zeit, Umfang)?",
      context: "Wenn du nichts Spezielles vorgibst, plane ich mit den bestehenden Projektkonventionen weiter.",
      freeTextPlaceholder: "z.B. muss mit dem bestehenden Electron-Stack kompatibel sein",
      allowFreeText: true,
      riskLevel: "low",
      toolCallId: "missing-information-policy"
    })
  });

  return checks;
}

export function checkMissingInformation(
  workflow: ClarificationWorkflow,
  taskType: TaskType,
  userMessage: string,
  hasFileContext: boolean,
  state: MissingInformationState = emptyState()
): RequiredFieldCheck[] {
  const ctx: MissingInfoContext = { hasFileContext, state };
  switch (workflow) {
    case "coding":
      return checkCoding(taskType, userMessage, ctx);
    case "review":
      return checkReview(userMessage, ctx);
    case "planning":
      return checkPlanning(userMessage, ctx);
    default: {
      const _exhaustive: never = workflow;
      return _exhaustive;
    }
  }
}
