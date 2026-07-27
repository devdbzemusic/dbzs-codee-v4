import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommitAssistantContext, GitRepositoryStatus } from "@dbzs/shared";
import { CommitAssistantService } from "./commitAssistantService.js";
import type { GitService } from "./gitService.js";

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();

  stderr = new EventEmitter();

  kill(): boolean {
    this.emit("exit", 1);
    return true;
  }
}

type CommandCase = {
  stdout: string;
  stderr?: string;
  code?: number;
};

function createSpawnMock(cases: Record<string, CommandCase>, observed: Array<{ command: string; args: string[] }>) {
  return ((command: string, args: string[]) => {
    observed.push({ command, args: [...args] });
    const process = new FakeProcess();
    const key = `${command} ${args.join(" ")}`;
    const found = cases[key];

    queueMicrotask(() => {
      if (!found) {
        process.stderr.emit("data", Buffer.from(`unknown command: ${key}`));
        process.emit("exit", 1);
        return;
      }

      if (found.stdout) {
        process.stdout.emit("data", Buffer.from(found.stdout));
      }
      if (found.stderr) {
        process.stderr.emit("data", Buffer.from(found.stderr));
      }
      process.emit("exit", found.code ?? 0);
    });

    return process;
  }) as never;
}

function stubGitService(status: GitRepositoryStatus, diffSummary: Array<{ filePath: string; additions: number; deletions: number; summary: string }>): GitService {
  return {
    getRepositoryStatus: async () => status,
    getDiffSummary: async () => diffSummary
  } as unknown as GitService;
}

describe("CommitAssistantService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createWorkspace(): string {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "dbzs-commit-assistant-"));
    tempDirectories.push(workspace);
    return workspace;
  }

  it("generates commit message from diff summary", async () => {
    const workspace = createWorkspace();
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "feature/commit-assistant",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/components/GitPanel.tsx", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/components/GitPanel.tsx", additions: 18, deletions: 4, summary: "22 ++++++++++++++++----" }]
      )
    });

    const suggestions = await service.suggestCommitMessages(workspace);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.title).toContain("(");
    expect(suggestions[0]?.body).toContain("Changed files");
  });

  it("detects conventional type docs from documentation files", async () => {
    const workspace = createWorkspace();
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "docs/update",
          hasUncommittedChanges: true,
          entries: [{ filePath: "docs/ARCHITECTURE.md", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "docs/ARCHITECTURE.md", additions: 12, deletions: 2, summary: "14 ++++++++++--" }]
      )
    });

    const suggestions = await service.suggestCommitMessages(workspace);
    expect(suggestions[0]?.type).toBe("docs");
    expect(suggestions[0]?.title.startsWith("docs(")).toBe(true);
  });

  it("detects conventional type fix when tests fail", async () => {
    const workspace = createWorkspace();
    const context: CommitAssistantContext = {
      testResults: [
        {
          runId: "run-1",
          commandId: "pnpm_test",
          label: "pnpm test",
          status: "failed",
          exitCode: 1,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          timedOut: false,
          cancelled: false
        }
      ]
    };

    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "fix/tests",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/stores/gitStore.ts", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/stores/gitStore.ts", additions: 20, deletions: 5, summary: "25 ++++++++++++++++++++-----" }]
      )
    });

    const suggestions = await service.suggestCommitMessages(workspace, context);
    expect(suggestions[0]?.type).toBe("fix");
    expect(suggestions[0]?.title.startsWith("fix(")).toBe(true);
  });

  it("blocks includeFiles outside workspace", async () => {
    const workspace = createWorkspace();
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "main",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/App.tsx", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/App.tsx", additions: 1, deletions: 0, summary: "1 +" }]
      )
    });

    await expect(
      service.validateCommitRequest(workspace, {
        message: {
          id: "m1",
          title: "feat(ui): update app shell",
          type: "feat",
          affectedFiles: ["apps/desktop/src/App.tsx"],
          riskLevel: "low",
          createdAt: new Date().toISOString()
        },
        includeFiles: [path.resolve(workspace, "..", "outside.txt")]
      })
    ).rejects.toThrow("outside of current workspace");
  });

  it("blocks when workspace is not a repository", async () => {
    const workspace = createWorkspace();
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: false,
          hasUncommittedChanges: false,
          entries: [],
          updatedAt: new Date().toISOString()
        },
        []
      )
    });

    await expect(
      service.validateCommitRequest(workspace, {
        message: {
          id: "m2",
          title: "chore(workspace): no-op",
          type: "chore",
          affectedFiles: [],
          riskLevel: "low",
          createdAt: new Date().toISOString()
        },
        includeFiles: ["apps/desktop/src/App.tsx"]
      })
    ).rejects.toThrow("kein Git-Repository");
  });

  it("blocks commit when no local changes exist", async () => {
    const workspace = createWorkspace();
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          hasUncommittedChanges: false,
          entries: [],
          updatedAt: new Date().toISOString()
        },
        []
      )
    });

    await expect(
      service.validateCommitRequest(workspace, {
        message: {
          id: "m3",
          title: "chore(workspace): no-op",
          type: "chore",
          affectedFiles: [],
          riskLevel: "low",
          createdAt: new Date().toISOString()
        },
        includeFiles: ["apps/desktop/src/App.tsx"]
      })
    ).rejects.toThrow("Keine lokalen Aenderungen");
  });

  it("uses safe git add arguments", async () => {
    const workspace = createWorkspace();
    const observed: Array<{ command: string; args: string[] }> = [];
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "main",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/App.tsx", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/App.tsx", additions: 3, deletions: 1, summary: "4 +++-" }]
      ),
      spawnImpl: createSpawnMock(
        {
          "git add -- apps/desktop/src/App.tsx": { stdout: "" },
          "git commit -m feat(ui): update app shell": { stdout: "[main abc123] feat(ui): update app shell\n" },
          "git rev-parse HEAD": { stdout: "abc123\n" }
        },
        observed
      )
    });

    const result = await service.createCommit(workspace, {
      message: {
        id: "m4",
        title: "feat(ui): update app shell",
        type: "feat",
        scope: "ui",
        affectedFiles: ["apps/desktop/src/App.tsx"],
        riskLevel: "low",
        createdAt: new Date().toISOString()
      },
      includeFiles: ["apps/desktop/src/App.tsx"]
    });

    expect(result.success).toBe(true);
    const addCall = observed.find((entry) => entry.args[0] === "add");
    expect(addCall).toBeDefined();
    expect(addCall?.args[1]).toBe("--");
    expect(addCall?.args.slice(2)).toEqual(["apps/desktop/src/App.tsx"]);
  });

  it("uses safe git commit arguments", async () => {
    const workspace = createWorkspace();
    const observed: Array<{ command: string; args: string[] }> = [];
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "main",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/App.tsx", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/App.tsx", additions: 3, deletions: 1, summary: "4 +++-" }]
      ),
      spawnImpl: createSpawnMock(
        {
          "git add -- apps/desktop/src/App.tsx": { stdout: "" },
          "git commit -m feat(ui): update app shell -m Changed files: 1": { stdout: "[main def456] feat(ui): update app shell\n" },
          "git rev-parse HEAD": { stdout: "def456\n" }
        },
        observed
      )
    });

    const result = await service.createCommit(workspace, {
      message: {
        id: "m5",
        title: "feat(ui): update app shell",
        body: "Changed files: 1",
        type: "feat",
        scope: "ui",
        affectedFiles: ["apps/desktop/src/App.tsx"],
        riskLevel: "low",
        createdAt: new Date().toISOString()
      },
      includeFiles: ["apps/desktop/src/App.tsx"]
    });

    expect(result.success).toBe(true);
    const commitCall = observed.find((entry) => entry.args[0] === "commit");
    expect(commitCall).toBeDefined();
    expect(commitCall?.args).toEqual(["commit", "-m", "feat(ui): update app shell", "-m", "Changed files: 1"]);
  });

  it("returns commit result with hash", async () => {
    const workspace = createWorkspace();
    const observed: Array<{ command: string; args: string[] }> = [];
    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "main",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/App.tsx", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/App.tsx", additions: 3, deletions: 1, summary: "4 +++-" }]
      ),
      spawnImpl: createSpawnMock(
        {
          "git add -- apps/desktop/src/App.tsx": { stdout: "" },
          "git commit -m feat(ui): update app shell": { stdout: "[main abc123] feat(ui): update app shell\n" },
          "git rev-parse HEAD": { stdout: "abc123456789\n" }
        },
        observed
      )
    });

    const result = await service.createCommit(workspace, {
      message: {
        id: "m6",
        title: "feat(ui): update app shell",
        type: "feat",
        scope: "ui",
        affectedFiles: ["apps/desktop/src/App.tsx"],
        riskLevel: "low",
        createdAt: new Date().toISOString()
      },
      includeFiles: ["apps/desktop/src/App.tsx"]
    });

    expect(result).toEqual({ success: true, commitHash: "abc123456789" });
  });

  it("creates restore point before commit", async () => {
    const workspace = createWorkspace();
    const restoreSpy = vi.fn(async () => ({ id: "rp-commit" }));
    const observed: Array<{ command: string; args: string[] }> = [];

    const service = new CommitAssistantService({
      gitService: stubGitService(
        {
          workspaceRoot: workspace,
          isRepository: true,
          currentBranch: "main",
          hasUncommittedChanges: true,
          entries: [{ filePath: "apps/desktop/src/App.tsx", status: "modified" }],
          updatedAt: new Date().toISOString()
        },
        [{ filePath: "apps/desktop/src/App.tsx", additions: 3, deletions: 1, summary: "4 +++-" }]
      ),
      restorePointService: { createRestorePoint: restoreSpy } as never,
      spawnImpl: createSpawnMock(
        {
          "git add -- apps/desktop/src/App.tsx": { stdout: "" },
          "git commit -m feat(ui): update app shell": { stdout: "[main abc123] feat(ui): update app shell\n" },
          "git rev-parse HEAD": { stdout: "abc123\n" }
        },
        observed
      )
    });

    const result = await service.createCommit(workspace, {
      message: {
        id: "m7",
        title: "feat(ui): update app shell",
        type: "feat",
        scope: "ui",
        affectedFiles: ["apps/desktop/src/App.tsx"],
        riskLevel: "low",
        createdAt: new Date().toISOString()
      },
      includeFiles: ["apps/desktop/src/App.tsx"]
    });

    expect(result.success).toBe(true);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
  });
});
