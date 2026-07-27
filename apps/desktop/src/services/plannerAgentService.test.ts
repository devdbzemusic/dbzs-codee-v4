import { describe, expect, it } from "vitest";
import type { GitDiffSummary, GitRepositoryStatus, ProjectMemory } from "@dbzs/shared";
import { PlannerAgentError, PlannerAgentService } from "./plannerAgentService";

const service = new PlannerAgentService();

const workspaceContext = {
  rootPath: "D:/Dev/repo/dbzs-codee",
  name: "dbzs-codee",
  fileTree: [
    "packages/shared/src/index.ts",
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/components/WorkspaceExplorer.tsx",
    "apps/desktop/src/stores/editorStore.ts",
    "apps/desktop/src/services/agentOutputParser.ts",
    "apps/desktop/src/components/DebugAgentPanel.tsx",
    "apps/desktop/src/components/PlannerAgentPanel.tsx",
    "apps/desktop/src/stores/debugAgentStore.ts",
    "apps/desktop/src/services/plannerAgentService.ts"
  ],
  sampledFiles: [
    {
      path: "D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx",
      relativePath: "apps/desktop/src/App.tsx",
      language: "tsx",
      content: "export function App() { return null; }"
    }
  ],
  availableAgents: [
    { id: "debug-agent", name: "Debug Agent", role: "debugger", status: "running" },
    { id: "test-agent", name: "Test Agent", role: "tester", status: "running" }
  ]
};

describe("PlannerAgentService", () => {
  it("erzeugt einen strukturierten Plan aus einem Ziel", () => {
    const plan = service.createPlan("Fuege einen sicheren Planner Agent in die Desktop-App ein", workspaceContext);

    expect(plan.goal).toContain("Planner Agent");
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.summary).toContain("Plan fuer");
    expect(plan.affectedAreas.length).toBeGreaterThan(0);
  });

  it("zerlegt groessere Aufgaben in mehrere Schritte", () => {
    const plan = service.createPlan(
      "Analysiere die bestehende Architektur, erweitere die Agent-UI, fuege Shared Types hinzu und bereite die spaetere Orchestrierung vor",
      workspaceContext
    );

    expect(plan.tasks.length).toBeGreaterThanOrEqual(4);
    expect(plan.tasks[0]?.dependencies).toEqual([]);
    expect(plan.tasks.at(-1)?.affectedFiles.length).toBeGreaterThan(0);
  });

  it("erkennt Risiken und betroffene Bereiche", () => {
    const plan = service.createPlan("Verbessere Agenten-Integration und Shared Types fuer das neue UI", workspaceContext);

    expect(plan.risks.some((risk) => risk.includes("Shared-Type"))).toBe(true);
    expect(plan.affectedAreas).toEqual(expect.arrayContaining(["Agent Registry / Orchestration", "Renderer UI", "Shared Types / Contracts"]));
  });

  it("lehnt leere Goals ab", () => {
    expect(() => service.createPlan("   ", workspaceContext)).toThrowError(PlannerAgentError);
    try {
      service.createPlan("   ", workspaceContext);
    } catch (error) {
      expect(error).toBeInstanceOf(PlannerAgentError);
      expect((error as PlannerAgentError).code).toBe("EMPTY_GOAL");
    }
  });

  it("validiert fehlerhafte Tasks", () => {
    const validation = service.validatePlan({
      id: "plan-1",
      goal: "Goal",
      summary: "Summary",
      tasks: [
        {
          id: "task-1",
          title: "",
          description: "",
          affectedFiles: [],
          priority: "high",
          estimatedComplexity: "small",
          dependencies: ["unknown-task"]
        }
      ],
      risks: [],
      assumptions: [],
      affectedAreas: [],
      createdAt: new Date().toISOString()
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it("fuegt Branch-Annahme hinzu wenn repository aktiv ist", () => {
    const gitRepositoryStatus: GitRepositoryStatus = {
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      isRepository: true,
      currentBranch: "feature/phase-1-foundation",
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      hasUncommittedChanges: true,
      entries: [{ filePath: "apps/desktop/src/App.tsx", status: "modified" }],
      updatedAt: new Date().toISOString()
    };

    const plan = service.createPlan("Erweitere Planner und Review Kontext", workspaceContext, null, gitRepositoryStatus, []);

    expect(plan.assumptions.some((entry) => entry.includes("Aktueller Branch lautet feature/phase-1-foundation"))).toBe(true);
  });

  it("fuegt kein Branch-Statement hinzu wenn kein repository", () => {
    const gitRepositoryStatus: GitRepositoryStatus = {
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      isRepository: false,
      hasUncommittedChanges: false,
      entries: [],
      updatedAt: new Date().toISOString()
    };

    const plan = service.createPlan("Erweitere Planner und Review Kontext", workspaceContext, null, gitRepositoryStatus, []);

    expect(plan.assumptions.some((entry) => entry.includes("Aktueller Branch lautet"))).toBe(false);
  });

  it("fuegt git-basierte Risiken fuer viele changes, konflikte und grossen diff hinzu", () => {
    const gitRepositoryStatus: GitRepositoryStatus = {
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      isRepository: true,
      currentBranch: "feature/risky",
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 2,
      hasUncommittedChanges: true,
      entries: [
        ...Array.from({ length: 12 }, (_, index) => ({ filePath: `apps/desktop/src/components/C${index}.tsx`, status: "modified" as const })),
        { filePath: "apps/desktop/src/components/ConflictPanel.tsx", status: "conflicted" }
      ],
      updatedAt: new Date().toISOString()
    };
    const gitDiffSummary: GitDiffSummary[] = [
      {
        filePath: "apps/desktop/src/components/ConflictPanel.tsx",
        additions: 260,
        deletions: 40,
        summary: "300 +++++-----"
      }
    ];
    const projectMemory: ProjectMemory = {
      projectId: "p-1",
      projectName: "dbzs-codee",
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      frameworks: ["react", "typescript"],
      languages: ["typescript"],
      architectureNotes: [],
      codingPatterns: [],
      importantFiles: [],
      recentTasks: [],
      knownIssues: [
        {
          id: "k-1",
          title: "Queue race",
          description: "task queue overlap",
          severity: "high"
        }
      ],
      updatedAt: new Date().toISOString()
    };

    const plan = service.createPlan(
      "Erweitere Agenten und pruefe Risiken",
      workspaceContext,
      projectMemory,
      gitRepositoryStatus,
      gitDiffSummary
    );

    expect(plan.risks.some((entry) => entry.includes("Viele uncommitted Aenderungen"))).toBe(true);
    expect(plan.risks.some((entry) => entry.includes("Git-Konflikte vorhanden"))).toBe(true);
    expect(plan.risks.some((entry) => entry.includes("sehr grosser Diff"))).toBe(true);
    expect(plan.risks.some((entry) => entry.includes("Bekannte Issues beachten"))).toBe(true);
  });
});
