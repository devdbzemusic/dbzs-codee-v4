/**
 * DBZS – Division By Zeros
 * Datei: implementationPlanValidator.ts
 * Bereich: Desktop Services / Implementation Plan Validator
 *
 * Zweck:
 *   Validiert ImplementationPlanV1 auf semantische Korrektheit und Vollständigkeit.
 *
 * Warum:
 *   Der Parser prüft nur die Syntax. Der Validator stellt sicher, dass der Plan
 *   auch ausführbar ist (keine zyklischen Abhängigkeiten, alle Referenzen existieren).
 *
 * Wozu:
 *   Verhindert, dass ungültige Pläne in den Job-Spooler gelangen und dort Fehler verursachen.
 */

import type {
  ImplementationPlanV1,
  ImplementationTaskV1,
  ImplementationPlanValidationResult
} from "@dbzs/shared";

/**
 * Validiert einen ImplementationPlanV1 umfassend.
 *
 * @param plan - Der zu validierende Plan
 * @returns Validierungsergebnis mit Fehlern und Warnungen
 */
export function validateImplementationPlanFull(
  plan: ImplementationPlanV1
): ImplementationPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basis-Validierung (wird auch vom Parser gemacht, aber sicherheitshalber)
  if (!plan.id || plan.id.trim() === "") {
    errors.push("Plan-ID fehlt oder ist leer");
  }

  if (!plan.goal || plan.goal.trim() === "") {
    errors.push("Plan-Ziel fehlt oder ist leer");
  }

  if (!plan.branchName || plan.branchName.trim() === "") {
    errors.push("Branch-Name fehlt oder ist leer");
  }

  // Branch-Name Validierung
  if (plan.branchName.includes(" ")) {
    errors.push(`Branch-Name "${plan.branchName}" enthält Leerzeichen`);
  }

  if (plan.branchName.startsWith("/") || plan.branchName.endsWith("/")) {
    errors.push(`Branch-Name "${plan.branchName}" darf nicht mit / beginnen oder enden`);
  }

  if (plan.tasks.length === 0) {
    errors.push("Plan enthält keine Tasks");
    return { valid: false, errors, warnings };
  }

  // Task-Validierung
  const taskIds = new Set<string>();
  const taskMap = new Map<string, ImplementationTaskV1>();

  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    const taskPrefix = `Task[${i}] "${task.id}"`;

    // Duplikate prüfen
    if (taskIds.has(task.id)) {
      errors.push(`${taskPrefix}: Duplizierte Task-ID`);
    } else {
      taskIds.add(task.id);
      taskMap.set(task.id, task);
    }

    // Titel
    if (!task.title || task.title.trim().length === 0) {
      errors.push(`${taskPrefix}: Titel fehlt oder ist leer`);
    } else if (task.title.length > 200) {
      warnings.push(`${taskPrefix}: Titel ist sehr lang (${task.title.length} Zeichen)`);
    }

    // Beschreibung
    if (!task.description || task.description.trim().length === 0) {
      warnings.push(`${taskPrefix}: Beschreibung fehlt`);
    }

    // Priorität
    if (task.priority < 0 || task.priority > 100) {
      warnings.push(`${taskPrefix}: Priorität ${task.priority} liegt außerhalb des empfohlenen Bereichs (0-100)`);
    }

    // Expected Files
    if (task.expectedFiles.length === 0) {
      warnings.push(`${taskPrefix}: Keine expectedFiles angegeben`);
    }

    // Acceptance Criteria
    if (task.acceptanceCriteria.length === 0) {
      errors.push(`${taskPrefix}: Keine acceptanceCriteria angegeben`);
    }

    // Test Commands
    if (task.testCommands.length === 0) {
      warnings.push(`${taskPrefix}: Keine testCommands angegeben`);
    }

    // Max Attempts
    if (task.maxAttempts < 1) {
      errors.push(`${taskPrefix}: maxAttempts muss >= 1 sein`);
    } else if (task.maxAttempts > 5) {
      warnings.push(`${taskPrefix}: maxAttempts=${task.maxAttempts} ist ungewöhnlich hoch`);
    }
  }

  // Abhängigkeiten validieren
  for (const task of plan.tasks) {
    const taskPrefix = `Task "${task.id}"`;

    for (const depId of task.dependsOn) {
      if (!taskMap.has(depId)) {
        errors.push(`${taskPrefix}: Abhängigkeit "${depId}" existiert nicht`);
      }

      // Selbstreferenz prüfen
      if (depId === task.id) {
        errors.push(`${taskPrefix}: Task hängt von sich selbst ab`);
      }
    }
  }

  // Zyklische Abhängigkeiten erkennen (DFS)
  const cycleErrors = detectCycles(plan.tasks);
  if (cycleErrors.length > 0) {
    errors.push(...cycleErrors);
  }

  // Warnung: Sehr viele Tasks
  if (plan.tasks.length > 20) {
    warnings.push(`Plan enthält ${plan.tasks.length} Tasks – erwäge Aufteilung in kleinere Pläne`);
  }

  // Warnung: Sehr viele Abhängigkeiten
  const totalDeps = plan.tasks.reduce((sum, t) => sum + t.dependsOn.length, 0);
  if (totalDeps > 50) {
    warnings.push(`Plan hat ${totalDeps} Abhängigkeiten – könnte zu komplex sein`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Erkennt zyklische Abhängigkeiten in einem Task-Graphen.
 *
 * @param tasks - Liste der Tasks
 * @returns Liste der Zyklus-Fehlermeldungen
 */
function detectCycles(tasks: ImplementationTaskV1[]): string[] {
  const errors: string[] = [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Farben für DFS: 0 = weiß (unbesucht), 1 = grau (in Bearbeitung), 2 = schwarz (fertig)
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const task of tasks) {
    color.set(task.id, 0);
    parent.set(task.id, null);
  }

  function dfs(taskId: string, path: string[]): boolean {
    color.set(taskId, 1); // grau
    path.push(taskId);

    const task = taskMap.get(taskId);
    if (!task) return false;

    for (const depId of task.dependsOn) {
      const depColor = color.get(depId) ?? 0;

      if (depColor === 1) {
        // Zyklus gefunden!
        const cycleStart = path.indexOf(depId);
        const cycle = path.slice(cycleStart);
        cycle.push(depId); // Zyklus schließen

        errors.push(
          `Zyklische Abhängigkeit erkannt: ${cycle.join(" → ")}`
        );
        return true;
      }

      if (depColor === 0 && taskMap.has(depId)) {
        parent.set(depId, taskId);
        if (dfs(depId, path)) {
          return true;
        }
      }
    }

    color.set(taskId, 2); // schwarz
    path.pop();
    return false;
  }

  for (const task of tasks) {
    if (color.get(task.id) === 0) {
      dfs(task.id, []);
    }
  }

  return errors;
}

/**
 * Prüft, ob ein Task bereit zur Ausführung ist.
 *
 * @param task - Der zu prüfende Task
 * @param allTasks - Alle Tasks im Plan (für Abhängigkeitsprüfung)
 * @returns true wenn alle Abhängigkeiten erfüllt sind
 */
export function isTaskReady(
  task: ImplementationTaskV1,
  allTasks: ImplementationTaskV1[]
): boolean {
  if (task.dependsOn.length === 0) {
    return true;
  }

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  for (const depId of task.dependsOn) {
    const depTask = taskMap.get(depId);
    if (!depTask) {
      // Abhängigkeit existiert nicht – Task kann nicht ausgeführt werden
      return false;
    }
    if (depTask.state !== "done") {
      // Abhängigkeit noch nicht abgeschlossen
      return false;
    }
  }

  return true;
}

/**
 * Bestimmt die ausführbaren Tasks in einem Plan.
 *
 * @param plan - Der Plan
 * @returns Liste der Tasks, die bereit zur Ausführung sind
 */
export function getReadyTasks(plan: ImplementationPlanV1): ImplementationTaskV1[] {
  return plan.tasks.filter((task) =>
    task.state === "approved" || task.state === "queued" || task.state === "ready"
      ? isTaskReady(task, plan.tasks)
      : false
  );
}

/**
 * Bestimmt die blockierten Tasks in einem Plan.
 *
 * @param plan - Der Plan
 * @returns Liste der Tasks, die auf Abhängigkeiten warten
 */
export function getBlockedTasks(plan: ImplementationPlanV1): ImplementationTaskV1[] {
  return plan.tasks.filter((task) =>
    (task.state === "blocked" || task.state === "approved" || task.state === "queued" || task.state === "ready")
      ? !isTaskReady(task, plan.tasks)
      : false
  );
}
