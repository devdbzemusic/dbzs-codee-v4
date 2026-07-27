import { describe, expect, it } from "vitest";
import type { ProjectMemory, ProposedChange, WorkspaceProjectFile } from "@dbzs/shared";
import { ContextEngineService } from "./contextEngineService";
import { ContextRetrievalService } from "./contextRetrievalService";

function createMemory(): ProjectMemory {
  return {
    projectId: "project-1",
    projectName: "dbzs-codee",
    workspaceRoot: "D:/Dev/repo/dbzs-codee",
    frameworks: ["react", "typescript", "electron"],
    languages: ["typescript", "python"],
    architectureNotes: ["Monorepo"],
    codingPatterns: ["Safe editing"],
    importantFiles: [
      { path: "apps/desktop/src/App.tsx", reason: "App composition" },
      { path: "packages/shared/src/index.ts", reason: "Shared contracts" }
    ],
    recentTasks: [
      {
        id: "task-1",
        title: "Review Agent",
        summary: "Review integration",
        affectedFiles: ["apps/desktop/src/components/ReviewAgentPanel.tsx"],
        createdAt: "2026-05-11T12:00:00Z"
      }
    ],
    knownIssues: [
      {
        id: "issue-1",
        title: "Queue race",
        description: "Potential queue state overlap",
        severity: "high"
      }
    ],
    updatedAt: "2026-05-11T12:00:00Z"
  };
}

const workspaceFiles: WorkspaceProjectFile[] = [
  {
    path: "D:/Dev/repo/dbzs-codee/apps/desktop/src/App.tsx",
    relativePath: "apps/desktop/src/App.tsx",
    name: "App.tsx",
    language: "typescript"
  },
  {
    path: "D:/Dev/repo/dbzs-codee/apps/desktop/src/components/TaskOrchestratorPanel.tsx",
    relativePath: "apps/desktop/src/components/TaskOrchestratorPanel.tsx",
    name: "TaskOrchestratorPanel.tsx",
    language: "typescript"
  },
  {
    path: "D:/Dev/repo/dbzs-codee/packages/shared/src/index.ts",
    relativePath: "packages/shared/src/index.ts",
    name: "index.ts",
    language: "typescript"
  },
  {
    path: "D:/Dev/repo/dbzs-codee/node_modules/lib/index.js",
    relativePath: "node_modules/lib/index.js",
    name: "index.js",
    language: "javascript"
  }
];

describe("ContextEngineService", () => {
  it("waehlt relevante Dateien kontextbezogen", () => {
    const service = new ContextEngineService(createMemory(), workspaceFiles);
    const files = service.getRelevantFiles("orchestrator queue review");

    expect(files[0]).toContain("apps/desktop/src");
    expect(files.some((entry) => entry.includes("node_modules"))).toBe(false);
  });

  it("liefert Agent-Kontext", () => {
    const service = new ContextEngineService(createMemory(), workspaceFiles);
    const payload = service.buildAgentContext("reviewer");

    expect(payload.projectSummary).toContain("dbzs-codee");
    expect(payload.knownIssues).toHaveLength(1);
    expect(payload.relevantFiles.length).toBeGreaterThan(0);
  });

  it("liefert Recent Changes aus vorgeschlagenen Aenderungen", () => {
    const changes: ProposedChange[] = [
      {
        id: "change-1",
        agentId: "coder",
        filePath: "apps/desktop/src/App.tsx",
        proposedContent: "export const x = 1;",
        reason: "Refactor",
        createdAt: "2026-05-11T13:00:00Z",
        status: "pending"
      }
    ];

    const service = new ContextEngineService(createMemory(), workspaceFiles, changes);
    const recent = service.getRecentChanges();

    expect(recent[0]?.id).toBe("change-1");
    expect(recent[0]?.filePath).toContain("App.tsx");
  });
});

describe("ContextRetrievalService", () => {
  it("rankt wichtige Dateien ueber Project Memory hoeher", () => {
    const fakeIndex = {
      searchCode: () => [
        { filePath: "apps/desktop/src/App.tsx", reason: "path", matchedSymbols: ["App"], score: 10 },
        { filePath: "apps/desktop/src/components/Other.tsx", reason: "path", matchedSymbols: ["Other"], score: 10 }
      ],
      findSymbol: () => [],
      findRelatedFiles: () => [],
      getIndexedFiles: () => []
    } as never;

    const service = new ContextRetrievalService(fakeIndex, createMemory());
    const ranked = service.getRelevantFiles("app component");

    expect(ranked[0]?.filePath).toContain("App.tsx");
  });

  it("liefert leere Treffer bei leerem Suchraum", () => {
    const fakeIndex = {
      searchCode: () => [],
      findSymbol: () => [],
      findRelatedFiles: () => [],
      getIndexedFiles: () => []
    } as never;

    const service = new ContextRetrievalService(fakeIndex, createMemory());
    expect(service.getRelevantFiles("anything")).toEqual([]);
    expect(service.getRelevantSymbols("anything")).toEqual([]);
  });
});
