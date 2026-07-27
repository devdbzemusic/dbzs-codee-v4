import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { BackendStartupState, BackendStartupStatus } from "@dbzs/shared";

export type { BackendStartupState, BackendStartupStatus };

export interface BackendStartupConfig {
  port: number;
  isPackaged: boolean;
  resourcesPath: string;
  devBackendCwd: string;
  healthCheck?: (backendUrl: string) => Promise<boolean>;
  spawnFn?: typeof spawn;
  waitIntervalMs?: number;
  log?: (line: string) => void;
}

export interface DevBackendLaunchSpec {
  executable: string;
  args: string[];
  shell: boolean;
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
  const venvUvicorn = path.join(venvBin, platform === "win32" ? "uvicorn.exe" : "uvicorn");
  if (pathExists(venvUvicorn)) {
    return { executable: venvUvicorn, args: uvicornArgs, shell: false };
  }

  const venvPython = path.join(venvBin, platform === "win32" ? "python.exe" : "python");
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
    const response = await fetch(`${backendUrl}/health`);
    return response.ok;
  } catch {
    return false;
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
  private readonly listeners = new Set<(status: BackendStartupStatus) => void>();
  private readonly healthCheck: (backendUrl: string) => Promise<boolean>;
  private readonly spawnFn: typeof spawn;
  private readonly log: (line: string) => void;

  constructor(private readonly config: BackendStartupConfig) {
    this.status = { state: "idle", message: null, port: config.port };
    this.healthCheck = config.healthCheck ?? defaultBackendHealthCheck;
    this.spawnFn = config.spawnFn ?? spawn;
    this.log = config.log ?? ((line) => console.error(line));
  }

  get backendUrl(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }

  getStatus(): BackendStartupStatus {
    return { ...this.status };
  }

  onStatusChange(listener: (status: BackendStartupStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publishStatus(state: BackendStartupState, message: string | null = this.status.message): void {
    this.status = { state, message, port: this.config.port };
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  async ensureStarted(options?: { waitUntilReady?: boolean; timeoutMs?: number }): Promise<BackendStartupStatus> {
    const waitUntilReady = options?.waitUntilReady ?? false;
    const timeoutMs = options?.timeoutMs ?? 30_000;

    if (await this.healthCheck(this.backendUrl)) {
      this.publishStatus("ready", null);
      return this.getStatus();
    }

    if (this.status.state === "starting") {
      return waitUntilReady ? this.waitUntilReady(timeoutMs) : this.getStatus();
    }

    this.spawnError = null;
    this.earlyExitMessage = null;
    this.publishStatus("starting", null);

    try {
      this.process = this.spawnBackendProcess();
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

  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.publishStatus("stopped", null);
  }

  private async waitUntilReady(timeoutMs: number): Promise<BackendStartupStatus> {
    const startedAt = Date.now();
    const intervalMs = this.config.waitIntervalMs ?? 350;

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
        this.publishStatus("ready", null);
        return this.getStatus();
      }

      await sleep(intervalMs);
    }

    const message = this.spawnError
      ? formatBackendStartupError(this.spawnError)
      : "FastAPI backend did not become ready in time.";
    this.publishStatus("failed", message);
    return this.getStatus();
  }

  private spawnBackendProcess(): ChildProcessWithoutNullStreams {
    if (this.config.isPackaged) {
      const bundleDir = path.join(this.config.resourcesPath, "backend", "dbzs-backend");
      const exe =
        process.platform === "win32"
          ? path.join(bundleDir, "dbzs-backend.exe")
          : path.join(bundleDir, "dbzs-backend");
      return this.spawnFn(exe, [], {
        cwd: bundleDir,
        env: {
          ...process.env,
          DBZS_BACKEND_PORT: String(this.config.port),
          PYTHONUNBUFFERED: "1"
        },
        windowsHide: true
      }) as ChildProcessWithoutNullStreams;
    }

    const launch = resolveDevBackendLaunch(this.config.devBackendCwd, this.config.port);

    return this.spawnFn(launch.executable, launch.args, {
      cwd: this.config.devBackendCwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      },
      windowsHide: true,
      shell: launch.shell
    }) as ChildProcessWithoutNullStreams;
  }

  private attachProcessHandlers(process: ChildProcessWithoutNullStreams): void {
    process.stderr?.on("data", (chunk: Buffer) => {
      this.log(`[backend] ${chunk.toString().trim()}`);
    });

    process.on("error", (error: NodeJS.ErrnoException) => {
      this.spawnError = error;
      const message = formatBackendStartupError(error);
      this.log(`[backend] spawn error: ${message}`);
      this.publishStatus("failed", message);
      this.process = null;
    });

    process.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        this.log(`[backend] exited with code ${code}`);
      }

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
