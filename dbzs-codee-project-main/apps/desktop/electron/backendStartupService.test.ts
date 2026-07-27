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
});
