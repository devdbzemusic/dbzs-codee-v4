/**
 * DBZS – Division By Zeros
 * Datei: implementationQueueIntegration.test.ts
 * Bereich: Desktop Services / Integration Tests
 *
 * Zweck:
 *   End-to-End-Integrationstest für das Implementation Queue System.
 *
 * Warum:
 *   Alle Komponenten müssen zusammen korrekt funktionieren.
 *
 * Wozu:
 *   Stellt sicher dass der komplette Flow von Plan-Erstellung bis Commit funktioniert.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createImplementationPlan,
  createImplementationTask,
  validateImplementationPlan,
  topologicalSortTasks,
  calculatePlanStatus,
  areDependenciesSatisfied,
  type ImplementationPlanV1
} from "@dbzs/shared";
import {
  parseImplementationPlan,
  looksLikeImplementationPlan
} from "@/services/implementationPlanParser";
import {
  validateImplementationPlanFull,
  isTaskReady,
  getReadyTasks,
  getBlockedTasks
} from "@/services/implementationPlanValidator";
import {
  taskToJobRequest,
  ImplementationQueueManager,
  getNextExecutableTask,
  calculatePlanStatusFromQueue
} from "@/services/implementationQueueService";
import {
  workspaceLockService,
  type WorkspaceLock
} from "@/services/workspaceLockService";
import {
  claimNextJobWithLock,
  releaseJobLock,
  renewJobLock
} from "@/services/jobWorkspaceLock";
import {
  jobReviewGateService,
  type ReviewCriteria
} from "@/services/jobReviewGateService";
import {
  jobCommitService
} from "@/services/jobCommitService";

/**
 * Mock-Daten für Tests.
 */
const WORKSPACE_ROOT = "C:\\test\\workspace";
const WORKER_ID = "test-worker-1";

describe("Implementation Queue Integration", () => {
  beforeEach(() => {
    // Locks zurücksetzen
    vi.clearAllMocks();
    workspaceLockService.clearAllLocksForTests();
  });

  describe("Phase 1: Plan-Erstellung", () => {
    it("sollte einen gültigen Plan erstellen", () => {
      const plan = createImplementationPlan(
        "Test-Ziel",
        "codee/test-plan"
      );

      expect(plan.id).toBeDefined();
      expect(plan.goal).toBe("Test-Ziel");
      expect(plan.branchName).toBe("codee/test-plan");
      expect(plan.status).toBe("draft");
      expect(plan.tasks).toHaveLength(0);
    });

    it("sollte einen Task mit Abhängigkeiten erstellen", () => {
      const task1 = createImplementationTask(
        "Task 1",
        "Beschreibung 1",
        { priority: 100 }
      );

      const task2 = createImplementationTask(
        "Task 2",
        "Beschreibung 2",
        {
          priority: 90,
          dependsOn: [task1.id]
        }
      );

      expect(task1.id).toBeDefined();
      expect(task2.dependsOn).toContain(task1.id);
      expect(task1.priority).toBe(100);
      expect(task2.priority).toBe(90);
    });
  });

  describe("Phase 2: Validierung", () => {
    it("sollte einen gültigen Plan validieren", () => {
      const task1 = createImplementationTask("Task 1", "Beschreibung", {
        acceptanceCriteria: ["Kriterium 1"],
        testCommands: ["echo test"],
        expectedFiles: ["test.ts"]
      });

      const plan = createImplementationPlan("Test");
      plan.tasks = [task1];

      const result = validateImplementationPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("sollte zyklische Abhängigkeiten erkennen", () => {
      const task1 = createImplementationTask("Task 1", "Beschreibung", {
        dependsOn: ["task-2"],
        acceptanceCriteria: ["Kriterium"],
        testCommands: ["test"],
        expectedFiles: ["test.ts"]
      });

      const task2 = createImplementationTask("Task 2", "Beschreibung", {
        dependsOn: ["task-1"],
        acceptanceCriteria: ["Kriterium"],
        testCommands: ["test"],
        expectedFiles: ["test.ts"]
      });

      // IDs manuell setzen für Zyklus
      task1.id = "task-1";
      task2.id = "task-2";

      const plan = createImplementationPlan("Test");
      plan.tasks = [task1, task2];

      const result = validateImplementationPlanFull(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Zyklische"))).toBe(true);
    });
  });

  describe("Phase 3: Parser", () => {
    it("sollte JSON-Plan parsen", () => {
      const json = JSON.stringify({
        id: "test-plan",
        goal: "Test-Ziel",
        branchName: "codee/test",
        createdAt: new Date().toISOString(),
        tasks: [{
          id: "T1",
          title: "Task 1",
          description: "Beschreibung",
          priority: 100,
          dependsOn: [],
          expectedFiles: ["test.ts"],
          acceptanceCriteria: ["Kriterium"],
          testCommands: ["test"],
          maxAttempts: 2,
          requiresApproval: false
        }]
      });

      const plan = parseImplementationPlan(json);
      expect(plan.id).toBe("test-plan");
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].title).toBe("Task 1");
    });

    it("sollte Markdown-Codeblock parsen", () => {
      const markdown = `
\`\`\`json
{
  "id": "markdown-plan",
  "goal": "Markdown Test",
  "branchName": "codee/markdown",
  "createdAt": "2026-06-27T00:00:00Z",
  "tasks": []
}
\`\`\`
      `.trim();

      const plan = parseImplementationPlan(markdown);
      expect(plan.id).toBe("markdown-plan");
      expect(plan.goal).toBe("Markdown Test");
    });

    it("sollte erkennen ob Text wie Plan aussieht", () => {
      expect(looksLikeImplementationPlan('{"id": "x", "goal": "y", "tasks": []}')).toBe(true);
      expect(looksLikeImplementationPlan("```json\n{...}")).toBe(true);
      expect(looksLikeImplementationPlan("Hallo Welt")).toBe(false);
    });
  });

  describe("Phase 4: Abhängigkeiten", () => {
    it("sollte Abhängigkeiten prüfen", () => {
      const task1 = createImplementationTask("Task 1", "Beschreibung", {
        state: "done"
      });

      const task2 = createImplementationTask("Task 2", "Beschreibung", {
        dependsOn: [task1.id],
        state: "approved"
      });

      expect(areDependenciesSatisfied(task2, [task1, task2])).toBe(true);

      task1.state = "running";
      expect(areDependenciesSatisfied(task2, [task1, task2])).toBe(false);
    });

    it("sollte topologisch sortieren", () => {
      const task1 = createImplementationTask("Task 1", "Beschreibung", {
        priority: 50
      });

      const task2 = createImplementationTask("Task 2", "Beschreibung", {
        priority: 100,
        dependsOn: [task1.id]
      });

      const sorted = topologicalSortTasks([task2, task1]);

      // Task 1 muss vor Task 2 kommen (Abhängigkeit)
      expect(sorted[0].id).toBe(task1.id);
      expect(sorted[1].id).toBe(task2.id);
    });

    it("sollte bereite Tasks finden", () => {
      const task1 = createImplementationTask("Task 1", "Beschreibung", {
        state: "done"
      });

      const task2 = createImplementationTask("Task 2", "Beschreibung", {
        dependsOn: [task1.id],
        state: "approved"
      });

      const task3 = createImplementationTask("Task 3", "Beschreibung", {
        dependsOn: ["non-existent"],
        state: "approved"
      });

      const plan = createImplementationPlan("Test");
      plan.tasks = [task1, task2, task3];

      const ready = getReadyTasks(plan);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(task2.id);
    });
  });

  describe("Phase 5: Queue-Management", () => {
    it("sollte Queue-Manager erstellen", () => {
      const task = createImplementationTask("Task 1", "Beschreibung");
      const plan = createImplementationPlan("Test");
      plan.tasks = [task];

      const manager = new ImplementationQueueManager(plan);
      expect(manager.getPlan()).toBe(plan);
      expect(manager.getTasks()).toHaveLength(1);
    });

    it("sollte nächsten ausführbaren Task finden", () => {
      const task1 = createImplementationTask("Task 1", "Beschreibung", {
        priority: 100,
        state: "approved"
      });

      const task2 = createImplementationTask("Task 2", "Beschreibung", {
        priority: 90,
        state: "approved",
        dependsOn: [task1.id]
      });

      const plan = createImplementationPlan("Test");
      plan.tasks = [task1, task2];

      const manager = new ImplementationQueueManager(plan);
      const next = getNextExecutableTask(manager);

      expect(next?.id).toBe(task1.id);
    });

    it("sollte Job-Request aus Task erstellen", () => {
      const task = createImplementationTask("Task 1", "Beschreibung", {
        priority: 80,
        maxAttempts: 3
      });

      const request = taskToJobRequest(task, "plan-123");

      expect(request.title).toBe("Task 1");
      expect(request.priority).toBe(80);
      expect(request.max_attempts).toBe(3);
      expect(request.input_payload).toBeDefined();
    });
  });

  describe("Phase 6: Workspace-Lock", () => {
    it("sollte Lock erwerben", () => {
      const result = workspaceLockService.acquireLock(
        WORKSPACE_ROOT,
        { id: "job-1", title: "Test-Job" },
        WORKER_ID
      );

      expect(result.acquired).toBe(true);
      expect(result.lock).toBeDefined();
      expect(result.lock?.jobId).toBe("job-1");
    });

    it("sollte Lock nicht doppelt vergeben", () => {
      workspaceLockService.acquireLock(
        WORKSPACE_ROOT,
        { id: "job-1", title: "Test-Job" },
        WORKER_ID
      );

      const result2 = workspaceLockService.acquireLock(
        WORKSPACE_ROOT,
        { id: "job-2", title: "Anderer Job" },
        "other-worker"
      );

      expect(result2.acquired).toBe(false);
      expect(result2.reason).toBe("already_locked");
      expect(result2.existingLock?.jobId).toBe("job-1");
    });

    it("sollte Lock freigeben", () => {
      workspaceLockService.acquireLock(
        WORKSPACE_ROOT,
        { id: "job-1", title: "Test-Job" },
        WORKER_ID
      );

      const released = workspaceLockService.releaseLock(
        WORKSPACE_ROOT,
        "job-1",
        WORKER_ID
      );

      expect(released).toBe(true);

      // Jetzt sollte neuer Lock möglich sein
      const result2 = workspaceLockService.acquireLock(
        WORKSPACE_ROOT,
        { id: "job-2", title: "Neuer Job" },
        WORKER_ID
      );

      expect(result2.acquired).toBe(true);
    });
  });

  describe("Phase 7: Review-Gate", () => {
    it("sollte Review-Gate erstellen", async () => {
      const gate = await jobReviewGateService.createReviewGate(
        "job-1",
        1,
        [{
          filePath: "test.ts",
          proposedContent: "content",
          diff: "+content",
          riskLevel: "low"
        }]
      );

      expect(gate.id).toBeDefined();
      expect(gate.jobId).toBe("job-1");
      expect(gate.status).toBe("pending");
    });

    it("sollte Gate genehmigen", async () => {
      const gate = await jobReviewGateService.createReviewGate(
        "job-2",
        1,
        []
      );

      const approved = await jobReviewGateService.approveGate(gate.id, {
        reviewedBy: "test-user",
        reviewComment: "Sieht gut aus"
      });

      expect(approved.status).toBe("approved");
      expect(approved.reviewedBy).toBe("test-user");
    });

    it("sollte Gate ablehnen", async () => {
      const gate = await jobReviewGateService.createReviewGate(
        "job-3",
        1,
        []
      );

      const rejected = await jobReviewGateService.rejectGate(gate.id, {
        reviewedBy: "test-user",
        rejectionReason: "Fehler im Code"
      });

      expect(rejected.status).toBe("rejected");
      expect(rejected.reviewComment).toBe("Fehler im Code");
    });
  });

  describe("Phase 8: Commit-Service", () => {
    it("sollte Commit-Service initialisieren", () => {
      const status = jobCommitService.getStatus();
      expect(status.state).toBe("idle");
    });

    // Hinweis: Echte Commit-Tests erfordern Git-Repository
    // Hier nur Platzhalter für zukünftige Integration
  });

  describe("End-to-End Flow", () => {
    it("sollte kompletten Flow durchlaufen", async () => {
      // 1. Plan erstellen
      const task1 = createImplementationTask(
        "TypeScript-Fehler beheben",
        "Doppelten TimeoutManager entfernen",
        {
          priority: 100,
          acceptanceCriteria: ["Kein Zugriff auf sendOptions.taskType"],
          testCommands: ["pnpm typecheck"],
          expectedFiles: ["apps/desktop/src/stores/runtimeChatStore.ts"]
        }
      );

      const task2 = createImplementationTask(
        "Backend-Import reparieren",
        "Einrückung korrigieren",
        {
          priority: 90,
          dependsOn: [task1.id],
          acceptanceCriteria: ["service.py ist kompilierbar"],
          testCommands: ["python -m py_compile backend/app/runtime/service.py"],
          expectedFiles: ["backend/app/runtime/service.py"]
        }
      );

      const plan = createImplementationPlan(
        "Communication Spine Repair",
        "codee/communication-spine-repair"
      );
      plan.tasks = [task1, task2];

      // 2. Validieren
      const validation = validateImplementationPlan(plan);
      expect(validation.valid).toBe(true);

      // 3. Queue-Manager erstellen
      const manager = new ImplementationQueueManager(plan);

      // 4. Ersten Task finden
      const nextTask = getNextExecutableTask(manager);
      expect(nextTask?.id).toBe(task1.id);

      // 5. Lock erwerben
      const lockResult = workspaceLockService.acquireLock(
        WORKSPACE_ROOT,
        { id: "job-1", title: task1.title },
        WORKER_ID
      );
      expect(lockResult.acquired).toBe(true);

      // 6. Review-Gate erstellen (simuliert)
      const gate = await jobReviewGateService.createReviewGate(
        "job-1",
        1,
        [{
          filePath: task1.expectedFiles[0],
          proposedContent: "fixed content",
          diff: "+fixed",
          riskLevel: "low"
        }]
      );

      // 7. Gate genehmigen
      const approved = await jobReviewGateService.approveGate(gate.id, {
        reviewedBy: "system",
        reviewComment: "Tests bestanden"
      });
      expect(approved.status).toBe("approved");

      // 8. Lock freigeben
      const released = workspaceLockService.releaseLock(
        WORKSPACE_ROOT,
        "job-1",
        WORKER_ID
      );
      expect(released).toBe(true);

      // 9. Plan-Status prüfen
      task1.state = "done";
      const planStatus = calculatePlanStatus(plan.tasks);
      expect(planStatus).toBe("in_progress"); // Task 2 ist noch nicht done
    });
  });
});
