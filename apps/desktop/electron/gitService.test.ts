import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { GitService } from "./gitService.js";

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

function createSpawnMock(cases: Record<string, CommandCase>) {
  return ((command: string, args: string[]) => {
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

describe("GitService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createTempWorkspace(): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dbzs-git-service-"));
    tempDirectories.push(tempRoot);
    return tempRoot;
  }

  it("detects repository", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git rev-parse --is-inside-work-tree": { stdout: "true\n" }
      })
    });

    await expect(service.validateGitRepository(workspace, 1000)).resolves.toBe(true);
  });

  it("detects non repository", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git rev-parse --is-inside-work-tree": { stdout: "", stderr: "fatal: not a git repository", code: 128 }
      })
    });

    await expect(service.validateGitRepository(workspace, 1000)).resolves.toBe(false);
  });

  it("reads current branch", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git branch --show-current": { stdout: "feature/git-intelligence\n" }
      })
    });

    await expect(service.getCurrentBranch(workspace, 1000)).resolves.toBe("feature/git-intelligence");
  });

  it("parses porcelain status and maps file states", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git status --porcelain=v1": {
          stdout: [
            " M apps/desktop/src/App.tsx",
            "A  packages/shared/src/index.ts",
            "D  docs/old.md",
            "R  src/old.ts -> src/new.ts",
            "?? scratch.txt"
          ].join("\n")
        }
      })
    });

    const changed = await service.getChangedFiles(workspace, 1000);
    expect(changed).toEqual([
      { filePath: "apps/desktop/src/App.tsx", status: "modified" },
      { filePath: "packages/shared/src/index.ts", status: "added" },
      { filePath: "docs/old.md", status: "deleted" },
      { filePath: "src/new.ts", status: "renamed" },
      { filePath: "scratch.txt", status: "untracked" }
    ]);
  });

  it("builds diff summary from git diff --stat", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git rev-parse --is-inside-work-tree": { stdout: "true\n" },
        "git diff --stat": {
          stdout: [
            " apps/desktop/src/App.tsx         | 10 ++++++----",
            " packages/shared/src/index.ts      |  2 ++",
            " 2 files changed, 8 insertions(+), 4 deletions(-)"
          ].join("\n")
        }
      })
    });

    const summary = await service.getDiffSummary(workspace, 1000);
    expect(summary).toEqual([
      {
        filePath: "apps/desktop/src/App.tsx",
        additions: 6,
        deletions: 4,
        summary: "10 ++++++----"
      },
      {
        filePath: "packages/shared/src/index.ts",
        additions: 2,
        deletions: 0,
        summary: "2 ++"
      }
    ]);
  });

  it("blocks diff path outside workspace", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git diff --": { stdout: "" }
      })
    });

    const outsidePath = path.resolve(workspace, "..", "other.txt");
    await expect(service.getDiff(workspace, 1000, outsidePath)).rejects.toThrow(
      "Path is outside of current workspace."
    );
  });

  it("returns clean repository status when not a repo", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git rev-parse --is-inside-work-tree": { stdout: "", code: 128, stderr: "fatal" }
      })
    });

    const status = await service.getRepositoryStatus(workspace, 1000);
    expect(status.isRepository).toBe(false);
    expect(status.entries).toEqual([]);
    expect(status.hasUncommittedChanges).toBe(false);
  });

  it("reads ahead/behind divergence with upstream", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git rev-parse --is-inside-work-tree": { stdout: "true\n" },
        "git branch --show-current": { stdout: "feature/git-intelligence\n" },
        "git status --porcelain=v1": { stdout: "" },
        "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}": { stdout: "origin/feature/git-intelligence\n" },
        "git rev-list --left-right --count @{upstream}...HEAD": { stdout: "2 5\n" }
      })
    });

    const status = await service.getRepositoryStatus(workspace, 1000);
    expect(status.hasUpstream).toBe(true);
    expect(status.behindCount).toBe(2);
    expect(status.aheadCount).toBe(5);
  });

  it("returns zero divergence when no upstream is configured", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git rev-parse --is-inside-work-tree": { stdout: "true\n" },
        "git branch --show-current": { stdout: "feature/no-upstream\n" },
        "git status --porcelain=v1": { stdout: " M src/App.tsx" },
        "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}": {
          stdout: "",
          stderr: "fatal: no upstream configured",
          code: 128
        }
      })
    });

    const status = await service.getRepositoryStatus(workspace, 1000);
    expect(status.hasUpstream).toBe(false);
    expect(status.behindCount).toBe(0);
    expect(status.aheadCount).toBe(0);
  });

  it("handles git command errors clearly", async () => {
    const workspace = createTempWorkspace();
    const service = new GitService({
      spawnImpl: createSpawnMock({
        "git branch --show-current": { stdout: "", stderr: "fatal: not a git repository", code: 128 }
      })
    });

    await expect(service.getCurrentBranch(workspace, 1000)).rejects.toThrow("[GIT_ERROR]");
  });
});
