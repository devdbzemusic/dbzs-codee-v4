import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandExecutionService } from "./commandExecutionService.js";

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();

  stderr = new EventEmitter();

  killCalled = false;

  kill(): boolean {
    this.killCalled = true;
    this.emit("exit", 1);
    return true;
  }
}

describe("CommandExecutionService", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function createTempWorkspace(): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dbzs-command-run-"));
    tempDirectories.push(tempRoot);
    return tempRoot;
  }

  it("runs an allowlisted command", async () => {
    const workspaceRoot = createTempWorkspace();
    const process = new FakeProcess();
    const service = new CommandExecutionService({
      spawnImpl: (() => process) as never
    });

    service.setWorkspaceRoot(workspaceRoot);
    const started = await service.executeCommand(workspaceRoot, "git_status", 5000);
    process.stdout.emit("data", Buffer.from("ok\n"));
    process.emit("exit", 0);

    const finished = service.getCommandRunStatus(started.runId);
    expect(finished.status).toBe("completed");
    expect(finished.exitCode).toBe(0);
  });

  it("blocks non-allowlisted command ids", async () => {
    const workspaceRoot = createTempWorkspace();
    const service = new CommandExecutionService();
    service.setWorkspaceRoot(workspaceRoot);

    await expect(service.executeCommand(workspaceRoot, "custom_command", 1000)).rejects.toThrow(
      "[COMMAND_BLOCKED]"
    );
  });

  it("blocks execution outside active workspace", async () => {
    const workspaceRoot = createTempWorkspace();
    const otherRoot = createTempWorkspace();
    const service = new CommandExecutionService({
      spawnImpl: (() => new FakeProcess()) as never
    });
    service.setWorkspaceRoot(workspaceRoot);

    await expect(service.executeCommand(otherRoot, "git_status", 1000)).rejects.toThrow(
      "Path is outside of current workspace."
    );
  });

  it("marks run as failed when timeout is reached", async () => {
    vi.useFakeTimers();
    const workspaceRoot = createTempWorkspace();
    const process = new FakeProcess();
    const service = new CommandExecutionService({
      spawnImpl: (() => process) as never
    });
    service.setWorkspaceRoot(workspaceRoot);

    const started = await service.executeCommand(workspaceRoot, "git_diff", 5);
    await vi.advanceTimersByTimeAsync(25);

    const status = service.getCommandRunStatus(started.runId);
    expect(status.status).toBe("failed");
    expect(status.timedOut).toBe(true);
  });

  it("marks run as cancelled when cancelled", async () => {
    const workspaceRoot = createTempWorkspace();
    const process = new FakeProcess();
    const service = new CommandExecutionService({
      spawnImpl: (() => process) as never
    });
    service.setWorkspaceRoot(workspaceRoot);

    const started = await service.executeCommand(workspaceRoot, "git_status", 5000);
    const cancelled = service.cancelCommand(started.runId);
    expect(cancelled.cancelled).toBe(true);

    const status = service.getCommandRunStatus(started.runId);
    expect(status.status).toBe("cancelled");
    expect(status.cancelled).toBe(true);
  });

  it("stores stdout and stderr separately", async () => {
    const workspaceRoot = createTempWorkspace();
    const child = new FakeProcess();
    const service = new CommandExecutionService({
      spawnImpl: (() => child) as never
    });
    service.setWorkspaceRoot(workspaceRoot);

    const started = await service.executeCommand(workspaceRoot, "git_diff", 5000);
    child.stdout.emit("data", Buffer.from("stdout message\n"));
    child.stderr.emit("data", Buffer.from("stderr message\n"));
    child.emit("exit", 0);

    const logs = service.streamCommandLogs(started.runId);
    expect(logs.stdout).toContain("stdout message");
    expect(logs.stderr).toContain("stderr message");
  });

  it("spawns Windows package managers via cmd.exe launcher, not npm.cmd shell:false", async () => {
    const workspaceRoot = createTempWorkspace();
    const child = new FakeProcess();
    const spawnImpl = vi.fn((_file: string, _args: readonly string[], _options: unknown) => child);
    const service = new CommandExecutionService({
      spawnImpl: spawnImpl as never
    });
    service.setWorkspaceRoot(workspaceRoot);

    const previousPlatform = globalThis.process.platform;
    Object.defineProperty(globalThis.process, "platform", { configurable: true, value: "win32" });
    try {
      const startedPromise = service.executeStructuredCommand(workspaceRoot, {
        command: "npm",
        args: ["test"],
        cwd: workspaceRoot,
        timeoutMs: 5000
      });
      queueMicrotask(() => child.emit("exit", 0));
      await startedPromise;

      expect(spawnImpl).toHaveBeenCalled();
      const [file, args, options] = spawnImpl.mock.calls[0]!;
      expect(String(file).toLowerCase()).toContain("cmd.exe");
      expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(String(args[3])).toContain("npm");
      expect(options).toMatchObject({ shell: false });
      expect(String(file).toLowerCase()).not.toBe("npm.cmd");
    } finally {
      Object.defineProperty(globalThis.process, "platform", {
        configurable: true,
        value: previousPlatform
      });
    }
  });
});
