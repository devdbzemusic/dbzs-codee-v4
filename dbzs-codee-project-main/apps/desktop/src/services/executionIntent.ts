/**
 * User execution intent — distinguishes explain/plan from tool-required work.
 */

export type UserExecutionIntent =
  | "explain_only"
  | "plan_only"
  | "inspect"
  | "implement"
  | "fix_review_findings"
  | "fix"
  | "refactor"
  | "review"
  | "test"
  | "build";

const EXPLAIN_PATTERNS = [
  /wie\s+(würde|wuerde|kann|könnte|koennte|baut|macht)\s+man/i,
  /how\s+(would|do|can)\s+(one|you|i)\b/i,
  /\berklär/i,
  /\berklaer/i,
  /\bexplain\b/i,
  /\bwas\s+ist\b/i,
  /\bwhy\b/i,
  /\bwarum\b/i
];

const PLAN_ONLY_PATTERNS = [
  /erstelle\s+einen\s+plan/i,
  /mach(e)?\s+einen\s+plan/i,
  /create\s+a\s+plan/i,
  /make\s+a\s+plan/i,
  /\bplane\b.*\b(nur|only)\b/i,
  /\bplanning\s+only\b/i
];

const INSPECT_PATTERNS = [
  /\buntersuch/i,
  /\binspect\b/i,
  /\banalyzier/i,
  /\banalyse\b/i,
  /\banalyze\b/i,
  /\bschau\s+dir\b/i,
  /\bzeig\s+mir\b/i,
  /\blies\b/i,
  /\bread\b.*\b(file|datei|code)\b/i
];

const IMPLEMENT_PATTERNS = [
  /\bbaue\b/i,
  /\beinbauen\b/i,
  /\bintegrier/i,
  /\bimplementier/i,
  /\beinrichte\b/i,
  /\brichte\s+.+\s+ein\b/i,
  /\bsetze\s+.+\s+um\b/i,
  /\bumsetzen\b/i,
  /\badd\b/i,
  /\binstallier/i,
  /\bsetup\b/i,
  /\bwire\s+up\b/i,
  /\bbuild\s+.+\s+into\b/i,
  /\bintegrate\b/i,
  /\bimplement\b/i,
  /\bcreate\b/i,
  /\berstelle\b/i,
  /\bfüge\s+.+\s+hinzu\b/i,
  /\bfuege\s+.+\s+hinzu\b/i
];

const FIX_PATTERNS = [
  /\bbeheb/i,
  /\breparier/i,
  /\bfixe?\b/i,
  /\bfix\b/i,
  /\bkorrigier/i,
  /\bdebug(?:ge|gen|ging)?\b/i,
  /\bfehler\b/i,
  /\bbug\b/i
];

const FIX_REVIEW_FINDINGS_PATTERNS = [
  /\bfix\s+(the\s+)?findings\b/i,
  /\bfindings\s+beheben\b/i,
  /\breview[-\s]?findings\s+beheben\b/i,
  /\bbeheb(?:e|en)?\s+(die\s+)?review[-\s]?(ergebnisse|findings)\b/i,
  /\balle\s+p[0-3](?:\/p[0-3])?\s+fixen\b/i
];

const REFACTOR_PATTERNS = [
  /\brefactor/i,
  /\bumstrukturier/i,
  /\breorganisiere/i,
  /\bneudesign\b/i
];

const REVIEW_PATTERNS = [
  /\bcodereview\b/i,
  /\bcode\s*review\b/i,
  /\breview\b/i,
  /\baudit\b/i,
  /\büberprüf/i,
  /\bueberpruef/i
];

const TEST_PATTERNS = [
  /\bschreibe\s+tests?\b/i,
  /\bteste\b/i,
  /\brun\s+tests?\b/i,
  /\bausführen\s+der\s+tests?\b/i,
  /\bwrite\s+tests?\b/i
];

const BUILD_PATTERNS = [
  /\bbauen\b/i,
  /\bbuild\b/i,
  /\bproduktion\b/i,
  /\bproduction\s+build\b/i,
  /\bnpm\s+run\s+build\b/i
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Classify how the user wants Codee to act.
 * Priority: explain/hypothetical → plan → implement/fix/refactor/test/build → review → inspect.
 * Explicit implement verbs must never lose to a bare "review" substring in another sentence.
 */
export function classifyUserExecutionIntent(userMessage: string): UserExecutionIntent {
  const text = userMessage.trim();
  if (!text) return "explain_only";

  if (matchesAny(text, EXPLAIN_PATTERNS) && !matchesAny(text, [/baue\s+.+\s+ein/i, /\bimplementiere\b/i, /\bimplementier/i])) {
    return "explain_only";
  }
  if (matchesAny(text, PLAN_ONLY_PATTERNS)) return "plan_only";
  if (matchesAny(text, REFACTOR_PATTERNS)) return "refactor";
  if (matchesAny(text, FIX_REVIEW_FINDINGS_PATTERNS)) return "fix_review_findings";
  if (matchesAny(text, FIX_PATTERNS)) return "fix";
  if (matchesAny(text, TEST_PATTERNS)) return "test";
  if (matchesAny(text, BUILD_PATTERNS) && !matchesAny(text, IMPLEMENT_PATTERNS)) return "build";
  if (matchesAny(text, IMPLEMENT_PATTERNS)) return "implement";
  // Review only after execution verbs — bare "review" must not steal "Implementiere …".
  if (matchesAny(text, REVIEW_PATTERNS)) return "review";
  if (matchesAny(text, INSPECT_PATTERNS)) return "inspect";
  if (matchesAny(text, EXPLAIN_PATTERNS)) return "explain_only";
  return "explain_only";
}

export function isToolRequiredExecutionIntent(intent: UserExecutionIntent): boolean {
  switch (intent) {
    case "implement":
    case "fix_review_findings":
    case "fix":
    case "refactor":
    case "test":
    case "build":
      return true;
    case "explain_only":
    case "plan_only":
    case "inspect":
    case "review":
      return false;
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

/** True when the user asked for explanation/hypothetical guidance, not execution. */
export function isExplicitExplainOnly(userMessage: string): boolean {
  return classifyUserExecutionIntent(userMessage) === "explain_only" && matchesAny(userMessage, EXPLAIN_PATTERNS);
}

/** Map execution intent onto existing RuntimeTaskType strings. */
export function taskTypeForExecutionIntent(
  intent: UserExecutionIntent
):
  | "casual_chat"
  | "normal_chat"
  | "planning"
  | "small_code_change"
  | "large_code_change"
  | "debugging"
  | "refactoring"
  | "review"
  | "test_analysis" {
  switch (intent) {
    case "explain_only":
      return "casual_chat";
    case "plan_only":
      return "planning";
    case "inspect":
      return "normal_chat";
    case "implement":
      return "large_code_change";
    case "fix_review_findings":
      return "planning";
    case "fix":
      return "debugging";
    case "refactor":
      return "refactoring";
    case "review":
      return "review";
    case "test":
      return "test_analysis";
    case "build":
      return "small_code_change";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}
