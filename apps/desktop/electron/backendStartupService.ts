import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { BackendProcessOwnership, BackendStartupState, BackendStartupStatus, BootLogLevel } from "@dbzs/shared";

export type { BackendProcessOwnership, BackendStartupState, BackendStartupStatus };

export interface BackendIdentityProbeResult {
  pid: number | null;
  instanceId: string | null;
  bootNonce: string | null;
  appName: string | null;
}

export interface BackendStartupConfig {
  port: number;
  isPackaged: boolean;
  resourcesPath: string;
  devBackendCwd: string;
  healthCheck?: (backendUrl: string) => Promise<boolean>;
  /** Reads GET /health/live's body (pid/instanceId/bootNonce) to determine process ownership. */
  identityProbe?: (backendUrl: string) => Promise<BackendIdentityProbeResult | null>;
  spawnFn?: typeof spawn;
  waitIntervalMs?: number;
  log?: (line: string) => void;
}

export interface DevBackendLaunchSpec {
  executable: string;
  args: string[];
  shell: boolean;
}

export interface BackendStartupDiagnosticEvent {
  level: BootLogLevel;
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
}

function pathExists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function collectPathEntries(env: NodeJS.ProcessEnv): string[] {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const raw = env[pathKey] ?? env.PATH ?? "";
  return raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

function findUvExecutable(env: NodeJS.ProcessEnv): string | null {
  const override = env.DBZS_UV_PATH?.trim();
  if (override && pathExists(override)) {
    return override;
  }

  const names = process.platform === "win32" ? ["uv.exe", "uv.cmd", "uv"] : ["uv"];
  for (const dir of collectPathEntries(env)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (pathExists(candidate)) {
        return candidate;
      }
    }
  }

  if (process.platform !== "win32") {
    const home = env.HOME ?? "";
    const wellKnown = [path.join(home, ".local", "bin", "uv"), path.join(home, ".cargo", "bin", "uv")];
    for (const candidate of wellKnown) {
      if (pathExists(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  const localAppData = env.LOCALAPPDATA ?? "";
  if (localAppData) {
    const pythonRoot = path.join(localAppData, "Programs", "Python");
    if (pathExists(pythonRoot)) {
      try {
        for (const entry of readdirSync(pythonRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) {
            continue;
          }
          for (const name of names) {
            const candidate = path.join(pythonRoot, entry.name, "Scripts", name);
            if (pathExists(candidate)) {
              return candidate;
            }
          }
        }
      } catch {
        // ignore unreadable Python install roots
      }
    }
  }

  const home = env.USERPROFILE ?? env.HOME ?? "";
  const wellKnown = [
    path.join(home, ".local", "bin", "uv.exe"),
    path.join(home, ".cargo", "bin", "uv.exe")
  ];
  for (const candidate of wellKnown) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveDevBackendLaunch(
  devBackendCwd: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): DevBackendLaunchSpec {
  const uvicornArgs = ["app.main:app", "--host", "127.0.0.1", "--port", String(port)];
  const venvBin = path.join(devBackendCwd, ".venv", platform === "win32" ? "Scripts" : "bin");
  const venvPython = path.join(venvBin, platform === "win32" ? "python.exe" : "python");
  if (platform === "win32" && pathExists(venvPython)) {
    return {
      executable: venvPython,
      args: ["-m", "uvicorn", ...uvicornArgs],
      shell: false
    };
  }

  const venvUvicorn = path.join(venvBin, platform === "win32" ? "uvicorn.exe" : "uvicorn");
  if (pathExists(venvUvicorn)) {
    return { executable: venvUvicorn, args: uvicornArgs, shell: false };
  }

  if (pathExists(venvPython)) {
    return {
      executable: venvPython,
      args: ["-m", "uvicorn", ...uvicornArgs],
      shell: false
    };
  }

  const uv = findUvExecutable(env);
  if (uv) {
    return {
      executable: uv,
      args: ["run", "uvicorn", ...uvicornArgs],
      shell: false
    };
  }

  return {
    executable: "uv",
    args: ["run", "uvicorn", ...uvicornArgs],
    shell: platform === "win32"
  };
}

/**
 * Best-effort pre-flight check reused by the filesystem-check boot phase:
 * does SOME concrete way to launch the backend actually exist on disk?
 * Mirrors spawnBackendProcess()'s own resolution exactly, so this can never
 * disagree with what will actually be attempted at spawn time.
 */
export function isBackendLaunchAvailable(
  config: Pick<BackendStartupConfig, "isPackaged" | "resourcesPath" | "devBackendCwd">
): boolean {
  if (config.isPackaged) {
    const bundleDir = path.join(config.resourcesPath, "backend", "dbzs-backend");
    const exe = process.platform === "win32" ? path.join(bundleDir, "dbzs-backend.exe") : path.join(bundleDir, "dbzs-backend");
    return pathExists(exe);
  }
  const launch = resolveDevBackendLaunch(config.devBackendCwd, 0);
  return pathExists(launch.executable);
}

export function formatBackendStartupError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
    if (code === "ENOENT") {
      return "Backend-Start fehlgeschlagen: uv/python nicht gefunden. Bitte uv installieren oder PATH pruefen.";
    }
    return error.message;
  }

  return String(error);
}

export async function defaultBackendHealthCheck(backendUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/health/live`);
    return response.ok;
  } catch {
    return false;
  }
}

/** The DBZS backend's own /health identity string (backend/app/core/config.py's APP_NAME). */
export const EXPECTED_BACKEND_APP_NAME = "DBZS Code Assistant";

/**
 * Reads GET /health/live's body to determine whether a listening process is
 * ours, plus a best-effort GET /health app-name check -- an already-running
 * process on the configured port must be verified by more than "HTTP 200
 * happened to come back", or a coincidentally-listening unrelated service
 * could be mistaken for a pre-existing DBZS backend.
 */
export async function defaultBackendIdentityProbe(backendUrl: string): Promise<BackendIdentityProbeResult | null> {
  try {
    const response = await fetch(`${backendUrl}/health/live`);
    if (!response.ok) return null;
    const body = (await response.json()) as { pid?: number; instanceId?: string; bootNonce?: string };

    let appName: string | null = null;
    try {
      const healthResponse = await fetch(`${backendUrl}/health`);
      if (healthResponse.ok) {
        const healthBody = (await healthResponse.json()) as { app?: string };
        appName = typeof healthBody.app === "string" ? healthBody.app : null;
      }
    } catch {
      // App-identity confirmation is best-effort; liveness alone still counts.
    }

    return {
      pid: typeof body.pid === "number" ? body.pid : null,
      instanceId: typeof body.instanceId === "string" ? body.instanceId : null,
      bootNonce: typeof body.bootNonce === "string" ? body.bootNonce : null,
      appName
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BackendStartupService {
  private process: ChildProcessWithoutNullStreams | null = null;
  private status: BackendStartupStatus;
  private spawnError: Error | null = null;
  private earlyExitMessage: string | null = null;
  private ownership: BackendProcessOwnership = "unknown";
  /** Generated once per desktop session; only a process we spawn ourselves gets this in its env. */
  private readonly bootNonce = randomUUID();
  private safeMode = false;
  private readonly listeners = new Set<(status: BackendStartupStatus) => void>();
  private readonly diagnosticListeners = new Set<(event: BackendStartupDiagnosticEvent) => void>();
  private readonly healthCheck: (backendUrl: string) => Promise<boolean>;
  private readonly identityProbe: (backendUrl: string) => Promise<BackendIdentityProbeResult | null>;
  private readonly spawnFn: typeof spawn;
  private readonly log: (line: string) => void;

  constructor(private readonly config: BackendStartupConfig) {
    this.status = { state: "idle", message: null, port: config.port, ownership: "unknown", instanceId: null };
    this.healthCheck = config.healthCheck ?? defaultBackendHealthCheck;
    this.identityProbe = config.identityProbe ?? defaultBackendIdentityProbe;
    this.spawnFn = config.spawnFn ?? spawn;
    this.log = config.log ?? ((line) => console.error(line));
  }

  get backendUrl(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }

  getStatus(): BackendStartupStatus {
    return { ...this.status };
  }

  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  /** Takes effect on the *next* spawn only -- an already-running process can't retroactively pick up an env var. */
  setSafeMode(enabled: boolean): void {
    this.safeMode = enabled;
  }

  onStatusChange(listener: (status: BackendStartupStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onDiagnostic(listener: (event: BackendStartupDiagnosticEvent) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }

  private emitDiagnostic(event: BackendStartupDiagnosticEvent): void {
    for (const listener of this.diagnosticListeners) {
      listener(event);
    }
  }

  private publishStatus(state: BackendStartupState, message: string | null = this.status.message): void {
    this.status = { state, message, port: this.config.port, ownership: this.ownership, instanceId: this.status.instanceId };
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  async ensureStarted(options?: { waitUntilReady?: boolean; timeoutMs?: number }): Promise<BackendStartupStatus> {
    const waitUntilReady = options?.waitUntilReady ?? false;
    const timeoutMs = options?.timeoutMs ?? 30_000;

    this.emitDiagnostic({
      level: "info",
      event: "backend-port-check",
      message: `Pruefe Backend-Port ${this.config.port}.`,
      metadata: { backendUrl: this.backendUrl, waitUntilReady, timeoutMs }
    });

    if (await this.healthCheck(this.backendUrl)) {
      // Something already answers on this port. Determine (or reconfirm)
      // ownership via the richer identity probe before declaring "ready" --
      // a bare HTTP 200 alone must never be enough to trust a process we
      // didn't spawn ourselves.
      const identity = await this.identityProbe(this.backendUrl);
      if (identity) {
        this.emitDiagnostic({
          level: "info",
          event: "backend-identity-detected",
          message: identity.pid != null
            ? `Backend antwortet bereits (PID ${identity.pid}).`
            : "Backend antwortet bereits.",
          metadata: {
            pid: identity.pid,
            instanceId: identity.instanceId,
            appName: identity.appName,
            ownership: this.ownership
          }
        });
        if (this.ownership === "spawned-by-desktop" && identity.bootNonce !== null && identity.bootNonce !== this.bootNonce) {
          // Something else is now listening on our port instead of the
          // process we spawned -- never assume it's safe to treat as ready.
          this.publishStatus(
            "failed",
            "Backend-Instanz stimmt nicht überein (unerwarteter Prozess auf diesem Port)."
          );
          return this.getStatus();
        }
        if (this.ownership !== "spawned-by-desktop") {
          if (identity.appName !== null && identity.appName !== EXPECTED_BACKEND_APP_NAME) {
            this.publishStatus(
              "failed",
              `Auf Port ${this.config.port} läuft ein anderer Dienst (${identity.appName}), nicht das DBZS-Backend.`
            );
            return this.getStatus();
          }
          this.ownership = "preexisting-local";
        }
        this.status.instanceId = identity.instanceId;
      }
      this.emitDiagnostic({
        level: "info",
        event: "backend-ready-existing",
        message: "Backend ist bereits erreichbar.",
        metadata: { ownership: this.ownership, instanceId: this.status.instanceId }
      });
      this.publishStatus("ready", null);
      return this.getStatus();
    }

    if (this.status.state === "starting") {
      this.emitDiagnostic({
        level: "debug",
        event: "backend-start-already-running",
        message: "Backend-Start laeuft bereits; warte auf bestehende Startsequenz.",
        metadata: { waitUntilReady, timeoutMs }
      });
      return waitUntilReady ? this.waitUntilReady(timeoutMs) : this.getStatus();
    }

    this.spawnError = null;
    this.earlyExitMessage = null;
    this.ownership = "spawned-by-desktop";
    this.publishStatus("starting", "Backend-Prozess wird gestartet.");

    try {
      this.process = this.spawnBackendProcess();
      this.emitDiagnostic({
        level: "info",
        event: "backend-process-spawned",
        message: this.process.pid != null
          ? `Backend-Prozess gespawnt (PID ${this.process.pid}).`
          : "Backend-Prozess gespawnt; PID noch nicht verfuegbar.",
        metadata: { pid: this.process.pid ?? null, ownership: this.ownership }
      });
      this.attachProcessHandlers(this.process);
    } catch (error) {
      const message = formatBackendStartupError(error);
      this.publishStatus("failed", message);
      return this.getStatus();
    }

    if (waitUntilReady) {
      return this.waitUntilReady(timeoutMs);
    }

    void this.waitUntilReady(timeoutMs);
    return this.getStatus();
  }

  /** An already-running external backend (ownership "preexisting-local") must never be terminated by us. */
  stop(): void {
    if (this.ownership !== "spawned-by-desktop") {
      this.process = null;
      this.publishStatus("stopped", null);
      return;
    }
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.publishStatus("stopped", null);
  }

  private async waitUntilReady(timeoutMs: number): Promise<BackendStartupStatus> {
    const startedAt = Date.now();
    const intervalMs = this.config.waitIntervalMs ?? 350;
    let lastWaitLogAt = 0;

    this.emitDiagnostic({
      level: "info",
      event: "backend-health-wait-start",
      message: "Warte auf Backend-Health-Check.",
      metadata: { backendUrl: this.backendUrl, timeoutMs, intervalMs }
    });

    while (Date.now() - startedAt < timeoutMs) {
      if (this.spawnError) {
        this.publishStatus("failed", formatBackendStartupError(this.spawnError));
        return this.getStatus();
      }

      if (this.earlyExitMessage) {
        this.publishStatus("failed", this.earlyExitMessage);
        return this.getStatus();
      }

      if (await this.healthCheck(this.backendUrl)) {
        if (this.ownership === "spawned-by-desktop") {
          const identity = await this.identityProbe(this.backendUrl);
          if (identity && identity.bootNonce !== null && identity.bootNonce !== this.bootNonce) {
            this.publishStatus(
              "failed",
              "Backend-Instanz stimmt nicht überein (unerwarteter Prozess auf diesem Port)."
            );
            return this.getStatus();
          }
          if (identity) this.status.instanceId = identity.instanceId;
        }
        this.emitDiagnostic({
          level: "info",
          event: "backend-health-ready",
          message: "Backend-Health-Check erfolgreich.",
          metadata: {
            durationMs: Date.now() - startedAt,
            ownership: this.ownership,
            instanceId: this.status.instanceId
          }
        });
        this.publishStatus("ready", null);
        return this.getStatus();
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs - lastWaitLogAt >= 2_000) {
        lastWaitLogAt = elapsedMs;
        this.emitDiagnostic({
          level: "debug",
          event: "backend-health-wait",
          message: `Backend noch nicht erreichbar (${Math.round(elapsedMs / 1000)}s).`,
          metadata: { elapsedMs, timeoutMs }
        });
      }

      await sleep(intervalMs);
    }

    const message = this.spawnError
      ? formatBackendStartupError(this.spawnError)
      : "FastAPI backend did not become ready in time.";
    this.publishStatus("failed", message);
    this.emitDiagnostic({
      level: "error",
      event: "backend-health-timeout",
      message,
      metadata: { timeoutMs }
    });
    return this.getStatus();
  }

  private spawnBackendProcess(): ChildProcessWithoutNullStreams {
    if (this.config.isPackaged) {
      const bundleDir = path.join(this.config.resourcesPath, "backend", "dbzs-backend");
      const exe =
        process.platform === "win32"
          ? path.join(bundleDir, "dbzs-backend.exe")
          : path.join(bundleDir, "dbzs-backend");
      this.emitDiagnostic({
        level: "info",
        event: "backend-launch-resolved",
        message: "Backend-Launch auf Paket-Binary aufgeloest.",
        metadata: { executable: exe, cwd: bundleDir, packaged: true }
      });
      return this.spawnFn(exe, [], {
        cwd: bundleDir,
        env: {
          ...process.env,
          DBZS_BACKEND_PORT: String(this.config.port),
          DBZS_BOOT_NONCE: this.bootNonce,
          ...(this.safeMode ? { DBZS_SAFE_MODE: "1" } : {}),
          PYTHONUNBUFFERED: "1"
        },
        windowsHide: true
      }) as ChildProcessWithoutNullStreams;
    }

    const launch = resolveDevBackendLaunch(this.config.devBackendCwd, this.config.port);

    this.emitDiagnostic({
      level: "info",
      event: "backend-launch-resolved",
      message: "Backend-Launch fuer Entwicklungsmodus aufgeloest.",
      metadata: {
        executable: launch.executable,
        args: launch.args,
        cwd: this.config.devBackendCwd,
        shell: launch.shell,
        packaged: false
      }
    });

    return this.spawnFn(launch.executable, launch.args, {
      cwd: this.config.devBackendCwd,
      env: {
        ...process.env,
        DBZS_BOOT_NONCE: this.bootNonce,
        ...(this.safeMode ? { DBZS_SAFE_MODE: "1" } : {}),
        PYTHONUNBUFFERED: "1"
      },
      windowsHide: true,
      shell: launch.shell
    }) as ChildProcessWithoutNullStreams;
  }

  private attachProcessHandlers(process: ChildProcessWithoutNullStreams): void {
    process.stderr?.on("data", (chunk: Buffer) => {
      const message = chunk.toString().trim();
      this.log(`[backend] ${message}`);
      this.emitDiagnostic({
        level: "debug",
        event: "backend-stderr",
        message
      });
    });

    process.on("error", (error: NodeJS.ErrnoException) => {
      this.spawnError = error;
      const message = formatBackendStartupError(error);
      this.log(`[backend] spawn error: ${message}`);
      this.emitDiagnostic({
        level: "error",
        event: "backend-spawn-error",
        message
      });
      this.publishStatus("failed", message);
      this.process = null;
    });

    process.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        this.log(`[backend] exited with code ${code}`);
      }

      this.emitDiagnostic({
        level: code === 0 || code === null ? "info" : "error",
        event: "backend-process-exit",
        message: code === null ? "Backend-Prozess beendet." : `Backend-Prozess beendet (Code ${code}).`,
        metadata: { exitCode: code }
      });

      const wasReady = this.status.state === "ready";
      this.process = null;

      if (wasReady) {
        this.publishStatus("stopped", "Backend-Prozess beendet.");
        return;
      }

      if (this.status.state === "starting") {
        this.earlyExitMessage = `Backend-Prozess beendet vor Health-Check${code !== null ? ` (Code ${code})` : ""}.`;
      }
    });
  }
}
