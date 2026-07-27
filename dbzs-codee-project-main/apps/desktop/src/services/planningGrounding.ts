/*
 * DBZS – Division By Zeros
 * Datei: planningGrounding.ts
 * Bereich: Desktop Services / Grounded Planning
 *
 * Zweck:
 *   Verhindert unbelegte Dateipfade in Planungsantworten.
 */

export interface GroundingValidation {
  taskGoalMentioned: boolean;
  acceptanceCriteriaCovered: boolean;
  proposedStepsRelevant: boolean;
  citedFilesVerified: boolean;
  unrelatedTopicDetected: boolean;
  unverifiedPathCitations: string[];
}

const UNRELATED_TOPIC_PATTERNS = [
  /rig\s*grid/i,
  /audio\s*visualizer/i,
  /\btuner\b/i,
  /musiker[- ]?navigator/i,
  /practice\s*coach\s*agent/i,
  /muznavigator/i
];

const PATH_CITATION_PATTERN =
  /(?:^|[\s(`"'[])((?:src|apps|packages|backend|docs)\/[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)/gm;

export function extractCitedWorkspacePaths(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_CITATION_PATTERN)) {
    const path = match[1]?.replace(/\\/g, "/");
    if (path) found.add(path);
  }
  return [...found];
}

export function detectUnrelatedProjectTopics(text: string, confirmedGoal: string): boolean {
  const goal = confirmedGoal.toLowerCase();
  const mentionsPractice =
    goal.includes("practice") || goal.includes("übung") || goal.includes("smart practice");
  if (!mentionsPractice) {
    return false;
  }
  return UNRELATED_TOPIC_PATTERNS.some((pattern) => pattern.test(text));
}

export function validatePlanningGrounding(input: {
  answer: string;
  confirmedGoal: string;
  acceptanceCriteria: string[];
  verifiedPaths: string[];
  toolResultCount: number;
}): GroundingValidation {
  const cited = extractCitedWorkspacePaths(input.answer);
  const verified = new Set(input.verifiedPaths.map((path) => path.replace(/\\/g, "/").toLowerCase()));
  const unverifiedPathCitations =
    input.toolResultCount <= 0
      ? cited
      : cited.filter((path) => !verified.has(path.toLowerCase()));

  const goalTokens = input.confirmedGoal
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/i)
    .filter((token) => token.length > 3);
  const answerLower = input.answer.toLowerCase();
  const taskGoalMentioned =
    goalTokens.length === 0 || goalTokens.some((token) => answerLower.includes(token));

  const acceptanceCriteriaCovered =
    input.acceptanceCriteria.length === 0 ||
    input.acceptanceCriteria.some((item) =>
      item
        .toLowerCase()
        .split(/[^a-zäöüß0-9]+/i)
        .filter((token) => token.length > 3)
        .some((token) => answerLower.includes(token))
    );

  return {
    taskGoalMentioned,
    acceptanceCriteriaCovered,
    proposedStepsRelevant: taskGoalMentioned && !detectUnrelatedProjectTopics(input.answer, input.confirmedGoal),
    citedFilesVerified: unverifiedPathCitations.length === 0,
    unrelatedTopicDetected: detectUnrelatedProjectTopics(input.answer, input.confirmedGoal),
    unverifiedPathCitations
  };
}

export function buildUngroundedPathDisclaimer(): string {
  return [
    "Voraussichtlich betroffen:",
    "- Domain-Modell",
    "- Persistenzdienst",
    "- Practice-UI",
    "",
    "Die exakten Dateien müssen zuerst im Workspace geprüft werden."
  ].join("\n");
}

export function stripUnverifiedPathClaims(answer: string, unverifiedPaths: string[]): string {
  if (unverifiedPaths.length === 0) return answer;
  let next = answer;
  for (const path of unverifiedPaths) {
    next = next.split(path).join("`(Pfad noch nicht verifiziert)`");
  }
  if (!next.includes("exakten Dateien müssen zuerst")) {
    next = `${next.trim()}\n\n${buildUngroundedPathDisclaimer()}`;
  }
  return next;
}

export function buildRelevanceRetrySystemPrompt(contractBlock: string): string {
  return [
    "Du bleibst strikt beim bestätigten Active Task Contract.",
    "Keine anderen Projektideen, kein Backlog, kein Rig Grid, kein Tuner,",
    "kein AudioVisualizer, kein Musiker-Navigator, kein Practice Coach Agent.",
    "Nenne konkrete Dateien nur wenn sie im Contract oder als bestätigt markiert sind.",
    "",
    contractBlock
  ].join("\n");
}

export const ANSWER_RELEVANCE_FAILED_USER_MESSAGE =
  "Die Antwort blieb trotz Wiederholung außerhalb des bestätigten Auftrags. Bitte anderes Plan-Modell wählen oder Diagnose exportieren.";

