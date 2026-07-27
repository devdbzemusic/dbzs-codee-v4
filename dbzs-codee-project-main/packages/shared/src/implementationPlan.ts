/**
 * DBZS – Division By Zeros
 * Datei: implementationPlan.ts
 * Bereich: Shared Types / Implementation Plan
 *
 * Zweck:
 *   Strukturierte Typen für Implementierungspläne, die vom Planner-Agenten
 *   erzeugt und vom Job-Spooler abgearbeitet werden.
 *
 * Warum:
 *   Der Chat-Assistent darf nicht gleichzeitig Planer, Warteschlange und
 *   Executor sein. Diese Typen erzwingen eine Trennung der Verantwortlichkeiten.
 *
 * Wozu:
 *   Ermöglicht kontrollierte, nachvollziehbare Implementierungsketten mit
 *   expliziten Abhängigkeiten, Akzeptanzkriterien und Testkommandos.
 */

/**
 * Mögliche Zustände eines ImplementationTask im Lebenszyklus.
 *
 * - proposed: Vom Planner erzeugt, wartet auf Freigabe
 * - approved: Benutzer hat den Plan freigegeben
 * - queued: In Job-Spooler übertragen, wartet auf Ausführung
 * - blocked: Abhängigkeiten sind noch nicht erfüllt
 * - ready: Alle Abhängigkeiten erfüllt, bereit zur Ausführung
 * - running: Wird gerade vom Executor bearbeitet
 * - validating: Implementierung abgeschlossen, Tests/Review laufen
 * - done: Erfolgreich abgeschlossen (Implementierung + Tests + Review)
 * - failed: Fehlgeschlagen (maxAttempts erreicht oder Review abgelehnt)
 * - cancelled: Manuell abgebrochen oder durch übergeordneten Fehler blockiert
 */
export type ImplementationTaskState =
  | "proposed"
  | "approved"
  | "queued"
  | "blocked"
  | "ready"
  | "running"
  | "validating"
  | "done"
  | "failed"
  | "cancelled";

/**
 * Einzelne Aufgabe innerhalb eines Implementierungsplans.
 *
 * Jede Aufgabe muss in einem einzelnen Commit abschließbar sein.
 */
export interface ImplementationTaskV1 {
  /** Eindeutige ID innerhalb des Plans, z.B. "T1", "T2", ... */
  id: string;

  /** Kurzer Titel der Aufgabe, max. 80 Zeichen */
  title: string;

  /** Detaillierte Beschreibung der Aufgabe */
  description: string;

  /** Priorität für die Reihenfolge (höhere Werte = wichtiger) */
  priority: number;

  /** IDs von Tasks, die vor diesem Task abgeschlossen sein müssen */
  dependsOn: string[];

  /** Dateien, die von diesem Task voraussichtlich verändert werden */
  expectedFiles: string[];

  /** Überprüfbare Kriterien, die für "done" erfüllt sein müssen */
  acceptanceCriteria: string[];

  /** Shell-Kommandos zur Validierung (z.B. "pnpm typecheck", "pytest -q") */
  testCommands: string[];

  /** Maximale Anzahl von Versuchen, bevor Task als "failed" gilt */
  maxAttempts: number;

  /** Ob dieser Task eine explizite Benutzerfreigabe benötigt */
  requiresApproval: boolean;

  /** Aktueller Zustand des Tasks */
  state?: ImplementationTaskState;

  /** Anzahl der bereits durchgeführten Versuche */
  attemptCount?: number;

  /** Job-ID im Spooler, falls bereits gequeued */
  jobId?: string | null;

  /** Fehlermeldung, falls fehlgeschlagen */
  errorMessage?: string | null;

  /** Commit-SHA nach erfolgreichem Abschluss */
  commitSha?: string | null;
}

/**
 * Ein vollständiger Implementierungsplan für eine übergeordnete Anforderung.
 *
 * Beispiel: "Runtime Chat Communication Spine stabilisieren"
 */
export interface ImplementationPlanV1 {
  /** Eindeutige ID des Plans, z.B. "communication-spine-repair-20" */
  id: string;

  /** Übergeordnetes Ziel des Plans */
  goal: string;

  /** Name des Git-Branches, der für diesen Plan erstellt wird */
  branchName: string;

  /** ISO-8601 Timestamp der Erstellung */
  createdAt: string;

  /** Liste der Tasks in diesem Plan */
  tasks: ImplementationTaskV1[];

  /** Optionale Notizen oder Risiken */
  notes?: string[];

  /** Gesamter Status des Plans (abgeleitet aus Task-States) */
  status?: ImplementationPlanStatus;
}

/**
 * Status des gesamten Implementierungsplans.
 *
 * Wird automatisch aus den Task-States abgeleitet.
 */
export type ImplementationPlanStatus =
  | "draft"       // Noch nicht freigegeben
  | "approved"    // Freigegeben, Tasks werden gequeued
  | "in_progress" // Mindestens ein Task läuft
  | "blocked"     // Mindestens ein Task ist blockiert
  | "completed"   // Alle Tasks done
  | "failed"      // Mindestens ein Task failed
  | "cancelled";  // Plan abgebrochen

/**
 * Anfrage zum Anlegen eines neuen Implementierungsplans.
 *
 * Wird vom Planner-Agenten als strukturierte Ausgabe erzeugt.
 */
export interface ImplementationPlanCreateRequest {
  goal: string;
  branchName: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    priority: number;
    dependsOn: string[];
    expectedFiles: string[];
    acceptanceCriteria: string[];
    testCommands: string[];
    maxAttempts: number;
    requiresApproval: boolean;
  }>;
  notes?: string[];
}

/**
 * Antwort nach erfolgreicher Plan-Erstellung.
 */
export interface ImplementationPlanCreateResponse {
  plan: ImplementationPlanV1;
  status: "created";
}

/**
 * Anfrage zur Freigabe eines Plans zur Ausführung.
 */
export interface ImplementationPlanApproveRequest {
  planId: string;
  approvedBy: string;
}

/**
 * Antwort nach Plan-Freigabe.
 */
export interface ImplementationPlanApproveResponse {
  plan: ImplementationPlanV1;
  status: "approved";
  queuedTaskCount: number;
}

/**
 * Validierungsergebnis für einen ImplementationPlanV1.
 */
export interface ImplementationPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Hilfsfunktion zur Generierung eindeutiger IDs.
 */
function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Erzeugt eine neue ImplementationPlanV1-ID.
 */
export function createPlanId(): string {
  return createId("plan");
}

/**
 * Erzeugt eine neue ImplementationTaskV1-ID.
 */
export function createTaskId(): string {
  return createId("task");
}

/**
 * Initialisiert einen neuen ImplementationPlanV1 mit Default-Werten.
 */
export function createImplementationPlan(
  goal: string,
  branchName?: string
): ImplementationPlanV1 {
  const now = new Date().toISOString();
  const planId = createPlanId();
  return {
    id: planId,
    goal,
    branchName: branchName ?? `codee/${planId}`,
    createdAt: now,
    tasks: [],
    status: "draft"
  };
}

/**
 * Initialisiert einen neuen ImplementationTaskV1 mit Default-Werten.
 */
export function createImplementationTask(
  title: string,
  description: string,
  options?: Partial<ImplementationTaskV1>
): ImplementationTaskV1 {
  return {
    id: createTaskId(),
    title,
    description,
    priority: 50,
    dependsOn: [],
    expectedFiles: [],
    acceptanceCriteria: [],
    testCommands: [],
    maxAttempts: 2,
    requiresApproval: false,
    state: "proposed",
    attemptCount: 0,
    jobId: null,
    errorMessage: null,
    commitSha: null,
    ...options
  };
}

/**
 * Berechnet den Status eines Plans basierend auf den Task-States.
 */
export function calculatePlanStatus(
  tasks: ImplementationTaskV1[]
): ImplementationPlanStatus {
  if (tasks.length === 0) {
    return "draft";
  }

  const states = tasks.map((t) => t.state ?? "proposed");

  if (states.some((s) => s === "failed")) {
    return "failed";
  }

  if (states.some((s) => s === "cancelled")) {
    return "cancelled";
  }

  if (states.every((s) => s === "done")) {
    return "completed";
  }

  if (states.some((s) => s === "running" || s === "validating")) {
    return "in_progress";
  }

  if (states.some((s) => s === "blocked")) {
    return "blocked";
  }

  if (states.every((s) => s === "proposed" || s === "approved")) {
    return "draft";
  }

  return "in_progress";
}

/**
 * Prüft, ob alle Abhängigkeiten eines Tasks erfüllt sind.
 */
export function areDependenciesSatisfied(
  task: ImplementationTaskV1,
  allTasks: ImplementationTaskV1[]
): boolean {
  if (task.dependsOn.length === 0) {
    return true;
  }

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  for (const depId of task.dependsOn) {
    const depTask = taskMap.get(depId);
    if (!depTask || depTask.state !== "done") {
      return false;
    }
  }

  return true;
}

/**
 * Topologische Sortierung von Tasks basierend auf Abhängigkeiten.
 *
 * Gibt Tasks in Ausführungsreihenfolge zurück (abhängige Tasks kommen später).
 */
export function topologicalSortTasks(
  tasks: ImplementationTaskV1[]
): ImplementationTaskV1[] {
  const sorted: ImplementationTaskV1[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(task: ImplementationTaskV1): boolean {
    if (visited.has(task.id)) {
      return true;
    }

    if (visiting.has(task.id)) {
      // Zyklische Abhängigkeit erkannt
      return false;
    }

    visiting.add(task.id);

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    for (const depId of task.dependsOn) {
      const depTask = taskMap.get(depId);
      if (depTask && !visit(depTask)) {
        return false;
      }
    }

    visiting.delete(task.id);
    visited.add(task.id);
    sorted.push(task);

    return true;
  }

  // Sortiere zuerst nach Priorität (höher zuerst), dann topologisch
  const prioritySorted = [...tasks].sort((a, b) => b.priority - a.priority);

  for (const task of prioritySorted) {
    if (!visited.has(task.id)) {
      if (!visit(task)) {
        // Bei zyklischen Abhängigkeiten: Füge verbleibende Tasks am Ende hinzu
        const remaining = tasks.filter((t) => !visited.has(t.id));
        sorted.push(...remaining);
        break;
      }
    }
  }

  return sorted;
}

/**
 * Validiert einen ImplementationPlanV1 auf Vollständigkeit und Konsistenz.
 */
export function validateImplementationPlan(
  plan: ImplementationPlanV1
): ImplementationPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan.id || plan.id.trim() === "") {
    errors.push("Plan-ID fehlt oder ist leer");
  }

  if (!plan.goal || plan.goal.trim() === "") {
    errors.push("Plan-Ziel fehlt oder ist leer");
  }

  if (!plan.branchName || plan.branchName.trim() === "") {
    errors.push("Branch-Name fehlt oder ist leer");
  }

  if (plan.tasks.length === 0) {
    errors.push("Plan enthält keine Tasks");
  }

  const taskIds = new Set<string>();
  for (const task of plan.tasks) {
    if (!task.id || task.id.trim() === "") {
      errors.push(`Task ohne ID: "${task.title}"`);
      continue;
    }

    if (taskIds.has(task.id)) {
      errors.push(`Duplizierte Task-ID: "${task.id}"`);
    }
    taskIds.add(task.id);

    if (!task.title || task.title.trim() === "") {
      errors.push(`Task "${task.id}" hat keinen Titel`);
    }

    if (!task.description || task.description.trim() === "") {
      warnings.push(`Task "${task.id}" hat keine Beschreibung`);
    }

    if (task.testCommands.length === 0) {
      warnings.push(`Task "${task.id}" hat keine Testkommandos`);
    }

    if (task.acceptanceCriteria.length === 0) {
      warnings.push(`Task "${task.id}" hat keine Akzeptanzkriterien`);
    }

    // Prüfe Abhängigkeiten auf existierende Task-IDs
    for (const depId of task.dependsOn) {
      if (!taskIds.has(depId)) {
        errors.push(`Task "${task.id}" hängt von nicht existierendem Task "${depId}" ab`);
      }
    }
  }

  // Prüfe auf zyklische Abhängigkeiten
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  for (const task of plan.tasks) {
    const visited = new Set<string>();
    let current = task;
    while (current.dependsOn.length > 0) {
      if (visited.has(current.id)) {
        errors.push(`Zyklische Abhängigkeit erkannt bei Task "${task.id}"`);
        break;
      }
      visited.add(current.id);
      const depId = current.dependsOn[0];
      const depTask = taskMap.get(depId);
      if (!depTask) break;
      current = depTask;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
