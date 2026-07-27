/**
 * DBZS – Division By Zeros
 * Datei: implementationPlanParser.ts
 * Bereich: Desktop Services / Implementation Plan Parser
 *
 * Zweck:
 *   Extrahiert und parst strukturierte Implementierungspläne aus Agent-Antworten.
 *
 * Warum:
 *   Der Chat-Assistent gibt Pläne als strukturierte JSON-Antworten oder
 *   Markdown-Codeblöcke aus. Dieser Parser wandelt sie in ImplementationPlanV1 um.
 *
 * Wozu:
 *   Ermöglicht die nahtlose Integration von Planner-Agenten in den Job-Spooler.
 */

import type {
  ImplementationPlanV1,
  ImplementationTaskV1,
  ImplementationPlanCreateRequest
} from "@dbzs/shared";

/**
 * Parse-Fehler beim Extrahieren eines Plans.
 */
export class PlanParseError extends Error {
  constructor(
    message: string,
    public readonly rawInput: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "PlanParseError";
  }
}

/**
 * Versucht, einen ImplementationPlanV1 aus einer Agent-Antwort zu extrahieren.
 *
 * Unterstützte Formate:
 * 1. Direktes JSON-Objekt
 * 2. JSON in einem Markdown-Codeblock (```json ... ```)
 * 3. TypeScript-Objekt in einem Codeblock (```typescript ... ``` oder ```ts ... ```)
 *
 * @param agentOutput - Die Roh-Antwort des Agents
 * @returns Geparster ImplementationPlanV1
 * @throws PlanParseError wenn kein gültiger Plan extrahiert werden konnte
 */
export function parseImplementationPlan(agentOutput: string): ImplementationPlanV1 {
  const trimmed = agentOutput.trim();

  // Versuch 1: Direktes JSON
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return validateAndNormalizePlan(parsed);
    } catch (e) {
      // Weiter zu Versuch 2
    }
  }

  // Versuch 2: Markdown-Codeblock extrahieren
  const codeBlockMatch = trimmed.match(
    /```(?:json|typescript|ts)?\s*([\s\S]*?)```/
  );

  if (codeBlockMatch) {
    const codeContent = codeBlockMatch[1].trim();

    // TypeScript zu JSON konvertieren (einfache Fälle)
    const jsonCandidate = codeContent
      // Entferne trailing commas
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      // Entferne unquoted keys (einfacher Fall)
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    try {
      const parsed = JSON.parse(jsonCandidate);
      return validateAndNormalizePlan(parsed);
    } catch (e) {
      throw new PlanParseError(
        `Konnte Plan nicht parsen: ${e instanceof Error ? e.message : String(e)}`,
        agentOutput,
        e
      );
    }
  }

  throw new PlanParseError(
    "Kein gültiger ImplementationPlanV1 gefunden. Erwartet wurde JSON oder ein Markdown-Codeblock mit Plan-Struktur.",
    agentOutput
  );
}

/**
 * Validiert und normalisiert einen rohen Plan zu ImplementationPlanV1.
 */
function validateAndNormalizePlan(raw: unknown): ImplementationPlanV1 {
  const obj = raw as Record<string, unknown>;

  if (!obj.id || typeof obj.id !== "string") {
    throw new PlanParseError(
      "Plan muss eine 'id' (string) haben",
      JSON.stringify(raw, null, 2)
    );
  }

  if (!obj.goal || typeof obj.goal !== "string") {
    throw new PlanParseError(
      "Plan muss ein 'goal' (string) haben",
      JSON.stringify(raw, null, 2)
    );
  }

  if (!obj.branchName || typeof obj.branchName !== "string") {
    throw new PlanParseError(
      "Plan muss einen 'branchName' (string) haben",
      JSON.stringify(raw, null, 2)
    );
  }

  if (!obj.createdAt || typeof obj.createdAt !== "string") {
    throw new PlanParseError(
      "Plan muss ein 'createdAt' (string, ISO-8601) haben",
      JSON.stringify(raw, null, 2)
    );
  }

  if (!Array.isArray(obj.tasks)) {
    throw new PlanParseError(
      "Plan muss ein 'tasks' Array haben",
      JSON.stringify(raw, null, 2)
    );
  }

  const tasks: ImplementationTaskV1[] = obj.tasks.map((t, index) =>
    validateAndNormalizeTask(t, index)
  );

  return {
    id: obj.id,
    goal: obj.goal,
    branchName: obj.branchName,
    createdAt: obj.createdAt,
    tasks,
    notes: Array.isArray(obj.notes) ? obj.notes : undefined,
    status: obj.status as ImplementationPlanV1["status"]
  };
}

/**
 * Validiert und normalisiert einen rohen Task zu ImplementationTaskV1.
 */
function validateAndNormalizeTask(
  raw: unknown,
  index: number
): ImplementationTaskV1 {
  const obj = raw as Record<string, unknown>;

  if (!obj.id || typeof obj.id !== "string") {
    throw new PlanParseError(
      `Task[${index}] muss eine 'id' (string) haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (!obj.title || typeof obj.title !== "string") {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss einen 'title' (string) haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (!obj.description || typeof obj.description !== "string") {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss eine 'description' (string) haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (typeof obj.priority !== "number") {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss eine 'priority' (number) haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (!Array.isArray(obj.dependsOn)) {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss ein 'dependsOn' Array haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (!Array.isArray(obj.expectedFiles)) {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss ein 'expectedFiles' Array haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (!Array.isArray(obj.acceptanceCriteria)) {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss ein 'acceptanceCriteria' Array haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (!Array.isArray(obj.testCommands)) {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss ein 'testCommands' Array haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (typeof obj.maxAttempts !== "number") {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss ein 'maxAttempts' (number) haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  if (typeof obj.requiresApproval !== "boolean") {
    throw new PlanParseError(
      `Task[${index}] '${obj.id}' muss ein 'requiresApproval' (boolean) haben`,
      JSON.stringify(raw, null, 2)
    );
  }

  return {
    id: obj.id,
    title: obj.title,
    description: obj.description,
    priority: obj.priority,
    dependsOn: obj.dependsOn,
    expectedFiles: obj.expectedFiles,
    acceptanceCriteria: obj.acceptanceCriteria,
    testCommands: obj.testCommands,
    maxAttempts: obj.maxAttempts,
    requiresApproval: obj.requiresApproval,
    state: (obj.state as ImplementationTaskV1["state"]) ?? "proposed",
    attemptCount: typeof obj.attemptCount === "number" ? obj.attemptCount : 0,
    jobId: (obj.jobId as string | null) ?? null,
    errorMessage: typeof obj.errorMessage === "string" ? obj.errorMessage : null,
    commitSha: typeof obj.commitSha === "string" ? obj.commitSha : null
  };
}

/**
 * Wandelt einen ImplementationPlanV1 in eine Create-Request-Struktur um.
 */
export function planToCreateRequest(
  plan: ImplementationPlanV1
): ImplementationPlanCreateRequest {
  return {
    goal: plan.goal,
    branchName: plan.branchName,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      dependsOn: t.dependsOn,
      expectedFiles: t.expectedFiles,
      acceptanceCriteria: t.acceptanceCriteria,
      testCommands: t.testCommands,
      maxAttempts: t.maxAttempts,
      requiresApproval: t.requiresApproval
    })),
    notes: plan.notes
  };
}

/**
 * Prüft, ob ein String wie ein ImplementationPlan aussieht.
 *
 * Wird verwendet, bevor der eigentliche Parse-Versuch unternommen wird.
 */
export function looksLikeImplementationPlan(content: string): boolean {
  const trimmed = content.trim();

  // JSON-Check
  if (trimmed.startsWith("{")) {
    return (
      trimmed.includes('"id"') &&
      trimmed.includes('"goal"') &&
      trimmed.includes('"tasks"')
    );
  }

  // Markdown-Codeblock-Check
  if (trimmed.startsWith("```")) {
    return (
      trimmed.includes("{") ||
      trimmed.includes('"id"') ||
      trimmed.includes("id:") ||
      trimmed.includes("goal:") ||
      trimmed.includes("tasks:")
    );
  }

  return false;
}
