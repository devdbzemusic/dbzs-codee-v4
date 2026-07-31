import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BackendStartupService,
  formatBackendStartupError,
  resolveDevBackendLaunch
} from "./backendStartupService.js";

class FakeChildProcess extends EventEmitter {
  pid = 1234;
  stderr = new EventEmitter();
  killed = false;

  kill(): void {
    this.killed = true;
  }
}

describe("formatBackendStartupError", () => {
  it("maps ENOENT to a uv-not-found message", () => {
    const error = Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" });
    expect(formatBackendStartupError(error)).toContain("uv/python nicht gefunden");
  });
});

describe("resolveDevBackendLaunch", () => {
  it("prefers backend venv uvicorn on Windows", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-backend-"));
    const scripts = path.join(root, ".venv", "Scripts");
    mkdirSync(scripts, { recursive: true });
    const uvicorn = path.join(scripts, "uvicorn.exe");
    writeFileSync(uvicorn, "");

    const launch = resolveDevBackendLaunch(root, 8876, {}, "win32");

    expect(launch.executable).toBe(uvicorn);
    expect(launch.args).toEqual(["app.main:app", "--host", "127.0.0.1", "--port", "8876"]);
    expect(launch.shell).toBe(false);
  });
});

describe("BackendStartupService", () => {
  it("marks ready when health check already succeeds", async () => {
    const healthCheck = vi.fn().mockResolvedValue(true);
    const spawnFn = vi.fn();
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: "/backend",
      healthCheck,
      spawnFn
    });

    const result = await service.ensureStarted({ waitUntilReady: true });

    expect(result.state).toBe("ready");
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("fails fast when spawn emits ENOENT", async () => {
    const healthCheck = vi.fn().mockResolvedValue(false);
    const fakeProcess = new FakeChildProcess();
    const spawnFn = vi.fn(() => fakeProcess as never);
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: "/backend",
      healthCheck,
      spawnFn,
      waitIntervalMs: 10
    });

    const pending = service.ensureStarted({ waitUntilReady: true });
    await Promise.resolve();
    fakeProcess.emit("error", Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" }));
    const result = await pending;

    expect(result.state).toBe("failed");
    expect(result.message).toContain("uv/python nicht gefunden");
  });

  it("fails when backend never becomes ready", async () => {
    const healthCheck = vi.fn().mockResolvedValue(false);
    const fakeProcess = new FakeChildProcess();
    const spawnFn = vi.fn(() => fakeProcess as never);
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: "/backend",
      healthCheck,
      spawnFn,
      waitIntervalMs: 10
    });

    const result = await service.ensureStarted({ waitUntilReady: true, timeoutMs: 40 });

    expect(result.state).toBe("failed");
    expect(result.message).toContain("did not become ready");
  });

  it("passes DBZS_SAFE_MODE=1 to the spawned process only after setSafeMode(true), and not before", async () => {
    const healthCheck = vi.fn().mockResolvedValue(false);
    const fakeProcess = new FakeChildProcess();
    const spawnFn = vi.fn((_exe: string, _args: string[], options: { env?: Record<string, string | undefined> }) => {
      void options;
      return fakeProcess as never;
    });
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: "/backend",
      healthCheck,
      spawnFn: spawnFn as unknown as typeof spawn,
      waitIntervalMs: 10
    });

    await service.ensureStarted({ waitUntilReady: false });
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(spawnFn.mock.calls[0][2].env?.DBZS_SAFE_MODE).toBeUndefined();

    service.stop();
    service.setSafeMode(true);
    await service.ensureStarted({ waitUntilReady: false });

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(spawnFn.mock.calls[1][2].env?.DBZS_SAFE_MODE).toBe("1");
  });

  it("returns starting immediately when not waiting for readiness", async () => {
    const healthCheck = vi.fn().mockResolvedValue(false);
    const fakeProcess = new FakeChildProcess();
    const spawnFn = vi.fn(() => fakeProcess as never);
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: "/backend",
      healthCheck,
      spawnFn,
      waitIntervalMs: 10
    });

    const result = await service.ensureStarted({ waitUntilReady: false });

    expect(result.state).toBe("starting");
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it("notifies status listeners", async () => {
    const healthCheck = vi.fn().mockResolvedValue(true);
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: "/backend",
      healthCheck
    });
    const listener = vi.fn();
    service.onStatusChange(listener);

    await service.ensureStarted({ waitUntilReady: true });

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0]?.state).toBe("ready");
  });

  it("emits diagnostics for the early backend startup path", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dbzs-backend-"));
    const scripts = path.join(root, ".venv", "Scripts");
    mkdirSync(scripts, { recursive: true });
    writeFileSync(path.join(scripts, "uvicorn.exe"), "");
    const healthCheck = vi.fn().mockResolvedValue(false);
    const fakeProcess = new FakeChildProcess();
    const spawnFn = vi.fn(() => fakeProcess as never);
    const service = new BackendStartupService({
      port: 8876,
      isPackaged: false,
      resourcesPath: "/resources",
      devBackendCwd: root,
      healthCheck,
      spawnFn,
      waitIntervalMs: 10
    });
    const diagnostics: string[] = [];
    service.onDiagnostic((event) => diagnostics.push(event.event));

    await service.ensureStarted({ waitUntilReady: false });

    expect(diagnostics).toContain("backend-port-check");
    expect(diagnostics).toContain("backend-launch-resolved");
    expect(diagnostics).toContain("backend-process-spawned");
  });

  describe("process ownership + boot nonce", () => {
    it("spawns and marks ownership spawned-by-desktop when nothing is already listening", async () => {
      const healthCheck = vi.fn().mockResolvedValue(false);
      const identityProbe = vi.fn().mockResolvedValue(null);
      const fakeProcess = new FakeChildProcess();
      const spawnFn = vi.fn(() => fakeProcess as never);
      const service = new BackendStartupService({
        port: 8876,
        isPackaged: false,
        resourcesPath: "/resources",
        devBackendCwd: "/backend",
        healthCheck,
        identityProbe,
        spawnFn,
        waitIntervalMs: 10
      });

      const result = await service.ensureStarted({ waitUntilReady: false });

      expect(result.state).toBe("starting");
      expect(result.ownership).toBe("spawned-by-desktop");
      expect(spawnFn).toHaveBeenCalledOnce();
    });

    it("detects a pre-existing external backend, does not spawn, and marks ownership preexisting-local", async () => {
      const healthCheck = vi.fn().mockResolvedValue(true);
      const identityProbe = vi.fn().mockResolvedValue({
        pid: 999,
        instanceId: "external-instance",
        bootNonce: null,
        appName: "DBZS Code Assistant"
      });
      const spawnFn = vi.fn();
      const service = new BackendStartupService({
        port: 8876,
        isPackaged: false,
        resourcesPath: "/resources",
        devBackendCwd: "/backend",
        healthCheck,
        identityProbe,
        spawnFn
      });

      const result = await service.ensureStarted({ waitUntilReady: true });

      expect(result.state).toBe("ready");
      expect(result.ownership).toBe("preexisting-local");
      expect(result.instanceId).toBe("external-instance");
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("never kills a pre-existing external backend on stop()", async () => {
      const healthCheck = vi.fn().mockResolvedValue(true);
      const identityProbe = vi.fn().mockResolvedValue({
        pid: 999,
        instanceId: "external-instance",
        bootNonce: null,
        appName: "DBZS Code Assistant"
      });
      const service = new BackendStartupService({
        port: 8876,
        isPackaged: false,
        resourcesPath: "/resources",
        devBackendCwd: "/backend",
        healthCheck,
        identityProbe
      });
      await service.ensureStarted({ waitUntilReady: true });

      // A real BackendStartupService never tracks a ChildProcess handle for
      // a pre-existing external backend in the first place (spawnFn is
      // never called for it) -- stop() must be a no-op regardless.
      service.stop();

      expect(service.getStatus().state).toBe("stopped");
    });

    it("fails when a different, unrelated service answers on the configured port", async () => {
      const healthCheck = vi.fn().mockResolvedValue(true);
      const identityProbe = vi.fn().mockResolvedValue({
        pid: 123,
        instanceId: null,
        bootNonce: null,
        appName: "Some Other App"
      });
      const service = new BackendStartupService({
        port: 8876,
        isPackaged: false,
        resourcesPath: "/resources",
        devBackendCwd: "/backend",
        healthCheck,
        identityProbe
      });

      const result = await service.ensureStarted({ waitUntilReady: true });

      expect(result.state).toBe("failed");
      expect(result.message).toContain("Some Other App");
    });

    it("fails when the backend answering after our own spawn reports a different boot nonce", async () => {
      // Simulates our spawned process dying and a *different* backend
      // instance somehow taking over the same port before the next poll.
      // Sequenced across two fully-awaited ensureStarted() calls (no
      // fire-and-forget background poll involved) so the mock call order
      // stays deterministic.
      const healthCheck = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
      const identityProbe = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({
        pid: 555,
        instanceId: "not-ours",
        bootNonce: "some-other-nonce",
        appName: "DBZS Code Assistant"
      });
      const fakeProcess = new FakeChildProcess();
      const spawnFn = vi.fn(() => fakeProcess as never);
      const service = new BackendStartupService({
        port: 8876,
        isPackaged: false,
        resourcesPath: "/resources",
        devBackendCwd: "/backend",
        healthCheck,
        identityProbe,
        spawnFn,
        waitIntervalMs: 10
      });

      // First call: nothing listening yet, so we spawn (ownership becomes
      // spawned-by-desktop), then the wait loop sees it come up.
      const first = await service.ensureStarted({ waitUntilReady: true });
      expect(spawnFn).toHaveBeenCalledOnce();
      expect(first.state).toBe("ready");
      expect(first.ownership).toBe("spawned-by-desktop");

      // Second call: now something answers, but with a nonce that isn't ours.
      const result = await service.ensureStarted({ waitUntilReady: false });

      expect(result.state).toBe("failed");
      expect(result.message).toContain("stimmt nicht überein");
    });
  });
});
