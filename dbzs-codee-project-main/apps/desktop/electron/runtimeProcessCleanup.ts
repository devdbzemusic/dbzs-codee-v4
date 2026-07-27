import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WindowsProcessInfo {
  ProcessId: number;
  Name?: string | null;
  CommandLine?: string | null;
}

export interface RuntimeProcessCleanupOptions {
  backendPort?: number;
  runtimePorts?: number[];
  currentPid?: number;
  devUserDataDir?: string | null;
  pruneTransientDirectories?: boolean;
  log?: (line: string) => void;
}

export interface RuntimeProcessCleanupReport {
  scannedPorts: number[];
  candidatePids: number[];
  killedPids: number[];
  prunedDirectories: string[];
  errors: string[];
}

const RUNTIME_PROCESS_NAMES = new Set([
  "llama-server",
  "llama-server.exe",
  "llama-cli",
  "llama-cli.exe",
  "dbzs-backend",
  "dbzs-backend.exe",
  "uvicorn",
  "uvicorn.exe",
  "python",
  "python.exe",
  "pythonw",
  "pythonw.exe"
]);

const SLOT_MARKERS = ["quality_cpu", "fast_gpu", "utility", "orchestrator_cpu"];
const BACKEND_MARKERS = ["app.main:app", "dbzs-backend", "backend\\app\\main.py", "backend/app/main.py"];
const DEV_TRANSIENT_SUBDIRECTORIES = [
  "cache",
  "session",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "Crashpad"
];

function normalizeName(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

function normalizeCommandLine(commandLine?: string | null): string {
  return (commandLine ?? "").trim().toLowerCase();
}

function portMarkers(ports: readonly number[]): string[] {
  return ports.flatMap((port) => [
    `--port ${port}`,
    `:${port}`,
    ` ${port} `,
    `"${port}"`
  ]);
}

function commandLineContainsKnownMarker(commandLine: string, ports: readonly number[], backendPort: number): boolean {
  if (!commandLine) {
    return false;
  }
  if (BACKEND_MARKERS.some((marker) => commandLine.includes(marker))) {
    return true;
  }
  if (SLOT_MARKERS.some((marker) => commandLine.includes(marker))) {
    return true;
  }
  if (commandLine.includes("--port") && portMarkers([...ports, backendPort]).some((marker) => commandLine.includes(marker))) {
    return true;
  }
  return false;
}

function isKnownRuntimeProcess(processInfo: WindowsProcessInfo, ports: readonly number[], backendPort: number): boolean {
  const name = normalizeName(processInfo.Name);
  const commandLine = normalizeCommandLine(processInfo.CommandLine);
  if (!RUNTIME_PROCESS_NAMES.has(name)) {
    return false;
  }

  if (name.startsWith("llama-server") || name.startsWith("llama-cli")) {
    return commandLineContainsKnownMarker(commandLine, ports, backendPort) || commandLine.includes("llama");
  }

  return commandLineContainsKnownMarker(commandLine, ports, backendPort);
}

export function collectWindowsCleanupCandidatePids(input: {
  netstatOutput: string;
  processes: WindowsProcessInfo[];
  runtimePorts?: number[];
  backendPort?: number;
  currentPid?: number;
}): number[] {
  const runtimePorts = input.runtimePorts ?? [8081, 8082, 8083, 8084];
  const backendPort = input.backendPort ?? 8876;
  const targetPorts = new Set<number>([...runtimePorts, backendPort]);
  const candidates = new Set<number>();

  for (const line of input.netstatOutput.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!match) {
      continue;
    }
    const port = Number.parseInt(match[1] ?? "", 10);
    const pid = Number.parseInt(match[2] ?? "", 10);
    if (targetPorts.has(port) && Number.isFinite(pid) && pid > 0) {
      candidates.add(pid);
    }
  }

  for (const processInfo of input.processes) {
    if (!Number.isFinite(processInfo.ProcessId) || processInfo.ProcessId <= 0) {
      continue;
    }
    if (isKnownRuntimeProcess(processInfo, runtimePorts, backendPort)) {
      candidates.add(processInfo.ProcessId);
    }
  }

  const currentPid = input.currentPid ?? process.pid;
  candidates.delete(currentPid);
  candidates.delete(0);
  return [...candidates].sort((left, right) => left - right);
}

async function queryWindowsProcesses(): Promise<WindowsProcessInfo[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
    ],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout) as WindowsProcessInfo | WindowsProcessInfo[] | null;
  if (!parsed) {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function queryWindowsNetstat(): Promise<string> {
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return stdout;
}

async function killWindowsPid(pid: number): Promise<void> {
  await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

async function pruneDevTransientDirectories(devUserDataDir: string | null | undefined): Promise<string[]> {
  if (!devUserDataDir) {
    return [];
  }

  const normalized = path.resolve(devUserDataDir).toLowerCase();
  if (!normalized.includes("dbzs-codee-dev-user-data")) {
    return [];
  }

  const removed: string[] = [];
  for (const relativePath of DEV_TRANSIENT_SUBDIRECTORIES) {
    const target = path.join(devUserDataDir, relativePath);
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 2 });
      removed.push(target);
    } catch {
      // Best effort cleanup only.
    }
  }
  return removed;
}

export async function cleanupLingeringRuntimeArtifacts(
  options: RuntimeProcessCleanupOptions = {}
): Promise<RuntimeProcessCleanupReport> {
  const runtimePorts = options.runtimePorts ?? [8081, 8082, 8083, 8084];
  const backendPort = options.backendPort ?? 8876;
  const log = options.log ?? (() => {});
  const report: RuntimeProcessCleanupReport = {
    scannedPorts: [...runtimePorts, backendPort],
    candidatePids: [],
    killedPids: [],
    prunedDirectories: [],
    errors: []
  };

  if (process.platform === "win32") {
    try {
      const [netstatOutput, processes] = await Promise.all([
        queryWindowsNetstat(),
        queryWindowsProcesses()
      ]);
      report.candidatePids = collectWindowsCleanupCandidatePids({
        netstatOutput,
        processes,
        runtimePorts,
        backendPort,
        currentPid: options.currentPid
      });
      for (const pid of report.candidatePids) {
        try {
          await killWindowsPid(pid);
          report.killedPids.push(pid);
          log(`Killed lingering runtime process PID=${pid}`);
        } catch (error) {
          report.errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (options.pruneTransientDirectories !== false) {
    report.prunedDirectories = await pruneDevTransientDirectories(options.devUserDataDir);
  }

  return report;
}
