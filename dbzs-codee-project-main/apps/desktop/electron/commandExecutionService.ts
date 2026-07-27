import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { AllowedCommand, CommandRunLogs, CommandRunStatus, TerminalCommandRequest } from "@dbzs/shared";
import {
  assertValidPackageName,
  buildPackageManagerCommandSuggestions,
  detectWorkspacePackageContract,
  type WorkspacePackageContract
} from "@dbzs/shared";
import { ensurePathInsideWorkspace, toResolvedPath } from "./workspaceService.js";
import {
  buildSpawnDiagnostics,
  buildWindowsCommandInvocation,
  formatSpawnDiagnostics,
  requiresWindowsCmdLauncher,
  type CommandSpawnDiagnostics
} from "./windowsCommandLauncher.js";

const MAX_LOG_CHARS = 1_000_000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ARGS = 32;

const DANGEROUS_PATTERN = /(^|\s)(rm|del|sudo|chmod|wget)\b|curl\s*\|\s*bash|wget\s*\|\s*bash/i;
const SHELL_METACHAR_PATTERN = /[|&;<>()$`"']/;
const STRUCTURED_COMMAND_ALLOWLIST = new Set(["git", "pnpm", "npm", "yarn", "bun", "pytest", "uv"]);
const PNPM_SCRIPTS = /^(test|typecheck|build|e2e|lint|smoke:[a-z0-9:-]+|doctor(?::[a-z0-9:-]+)?|audit|check)$/;
const BLOCKED_GIT_OPTIONS = new Set(["--no-index", "--output", "--src-prefix", "--dst-prefix", "--ext-diff", "--textconv", "--exec-path", "-c", "--config-env"]);
const ALLOWED_GIT_DIFF_OPTIONS = new Set(["--stat", "--name-only", "--cached"]);
const BLOCKED_PYTEST_OPTIONS = new Set(["-p", "-c", "--rootdir", "--confcutdir", "--override-ini"]);

const FALLBACK_ALLOWED_COMMANDS: AllowedCommand[] = [
  { id: "pnpm_test", label: "pnpm test", command: "pnpm", args: ["test"] },
  { id: "pnpm_typecheck", label: "pnpm typecheck", command: "pnpm", args: ["typecheck"] },
  { id: "pnpm_lint", label: "pnpm lint", command: "pnpm", args: ["lint"] },
  { id: "npm_test", label: "npm test", command: "npm", args: ["test"] },
  { id: "npm_run_typecheck", label: "npm run typecheck", command: "npm", args: ["run", "typecheck"] },
  { id: "npm_run_lint", label: "npm run lint", command: "npm", args: ["run", "lint"] },
  { id: "pytest", label: "pytest", command: "pytest", args: [] },
  { id: "uv_run_pytest", label: "uv run pytest", command: "uv", args: ["run", "pytest"] },
  { id: "git_status", label: "git status", command: "git", args: ["status"] },
  { id: "git_diff", label: "git diff", command: "git", args: ["diff"] }
];

/** @deprecated Prefer listAllowedCommands() which is workspace-aware. Kept for tests/import stability. */
export const ALLOWED_COMMANDS: AllowedCommand[] = FALLBACK_ALLOWED_COMMANDS;

function isInstallInvocation(command: string, args: string[]): boolean {
  if (command === "npm") {
    return args[0] === "install" || args[0] === "i" || args[0] === "add";
  }
  if (command === "pnpm" || command === "yarn" || command === "bun") {
    return args[0] === "add" || args[0] === "install" || args[0] === "i";
  }
  return false;
}

function validateInstallArgs(command: string, args: string[]): void {
  if (args.some((a) => a === "-g" || a === "--global")) {
    block("Globale Paketinstallation ist verboten.");
  }
  const skip = new Set([
    "install",
    "i",
    "add",
    "--save-dev",
    "--save",
    "-D",
    "--dev",
    "-d",
    "--no-save",
    "--exact",
    "-E"
  ]);
  for (const arg of args) {
    if (skip.has(arg) || arg.startsWith("-")) {
      continue;
    }
    const name = arg.includes("@") && !arg.startsWith("@")
      ? arg.slice(0, arg.indexOf("@", 1))
      : arg.startsWith("@")
        ? arg.includes("@", 1)
          ? arg.slice(0, arg.indexOf("@", 1))
          : arg
        : arg.includes("@")
          ? arg.slice(0, arg.indexOf("@"))
          : arg;
    try {
      assertValidPackageName(name.startsWith("@") ? arg.split("@").length > 2 ? `@${arg.split("@")[1]}` : name : name);
    } catch {
      // Scoped packages: @scope/name or @scope/name@version
      const scoped = arg.match(/^(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)(?:@.+)?$/i);
      if (!scoped) {
        block(`Ungueltiger Paketname: ${arg}`);
      }
      assertValidPackageName(scoped[1]);
    }
  }
  if (command === "npm" && !(args[0] === "install" || args[0] === "i" || args[0] === "add")) {
    block("npm Install-Syntax ungueltig.");
  }
}

function hasAllowedArguments(command: string, args: string[]): boolean {
  if (command === "git") {
    return args.length > 0 && ["status", "diff"].includes(args[0]);
  }
  if (command === "pnpm" || command === "yarn" || command === "bun" || command === "npm") {
    if (isInstallInvocation(command, args)) {
      try {
        validateInstallArgs(command, args);
        return true;
      } catch {
        return false;
      }
    }
  }
  if (command === "pnpm") {
    if (args.length === 0) {
      return false;
    }
    if (args[0] === "run") {
      return args.length > 1 && typeof args[1] === "string" && PNPM_SCRIPTS.test(args[1]);
    }
    return PNPM_SCRIPTS.test(args[0]);
  }
  if (command === "npm") {
    if (args[0] === "run") {
      return args.length > 1 && typeof args[1] === "string" && PNPM_SCRIPTS.test(args[1]);
    }
    return args[0] === "test";
  }
  if (command === "yarn") {
    return args.length > 0 && PNPM_SCRIPTS.test(args[0]);
  }
  if (command === "bun") {
    if (args[0] === "run") {
      return args.length > 1 && typeof args[1] === "string" && PNPM_SCRIPTS.test(args[1]);
    }
    return args.length > 0 && PNPM_SCRIPTS.test(args[0]);
  }
  if (command === "pytest") {
    return true;
  }
  return command === "uv" && args[0] === "run" && args[1] === "pytest";
}

function block(message: string): never {
  throw new Error(`[COMMAND_BLOCKED] ${message}`);
}

function validatePathArg(workspaceRoot: string, value: string): string {
  const pathPart = value.split("::", 1)[0];
  try {
    return ensurePathInsideWorkspace(workspaceRoot, pathPart);
  } catch {
    return block("Pfad liegt ausserhalb des Workspace.");
  }
}

function validateGitArgs(workspaceRoot: string, args: string[]): string[] {
  if (args[0] === "status") {
    if (args.length > 2 || (args.length === 2 && args[1] !== "--short")) block("git status erlaubt nur optional --short.");
    return [];
  }
  if (args[0] !== "diff") block("Git-Unterbefehl ist nicht erlaubt.");
  const resolved: string[] = [];
  let paths = false;
  for (const arg of args.slice(1)) {
    const option = arg.split("=", 1)[0];
    if (BLOCKED_GIT_OPTIONS.has(option)) block(`Git-Option ${option} ist blockiert.`);
    if (arg === "--") { paths = true; continue; }
    if (!paths) {
      if (!ALLOWED_GIT_DIFF_OPTIONS.has(arg)) block("Git-diff-Argumente brauchen '--' vor Dateipfaden.");
      continue;
    }
    resolved.push(validatePathArg(workspaceRoot, arg));
  }
  return resolved;
}

function validatePytestArgs(workspaceRoot: string, args: string[]): string[] {
  const resolved: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const option = arg.split("=", 1)[0];
    if (BLOCKED_PYTEST_OPTIONS.has(option)) block(`Pytest-Option ${option} ist blockiert.`);
    if (arg === "-k" || arg === "-m") {
      if (!args[index + 1]) block(`${arg} erwartet einen Ausdruck.`);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      if (!["-q", "-v", "-vv", "-x", "--maxfail=1"].includes(arg)) block(`Pytest-Option ${arg} ist nicht erlaubt.`);
      continue;
    }
    resolved.push(validatePathArg(workspaceRoot, arg));
  }
  return resolved;
}

function validatePackageManagerArgs(workspaceRoot: string, command: string, args: string[]): string[] {
  if (isInstallInvocation(command, args)) {
    validateInstallArgs(command, args);
    return [];
  }
  const scriptArgIndex = command === "pnpm" && args[0] === "run" ? 1
    : command === "npm" && args[0] === "run" ? 1
    : command === "bun" && args[0] === "run" ? 1
    : 0;
  const passthroughArgs = args.slice(scriptArgIndex + 1);
  const resolved: string[] = [];
  for (const arg of passthroughArgs) {
    if (arg === "--") {
      continue;
    }
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
    const looksPathLike = /[\\/]/.test(value) || value.startsWith(".") || /^[A-Za-z]:/.test(value) || value.includes("::");
    if (!looksPathLike) {
      continue;
    }
    if (arg.startsWith("-") && !arg.includes("=")) {
      block("Package-Script-Optionen mit Pfadwerten muessen als separates Workspace-Argument uebergeben werden.");
    }
    resolved.push(validatePathArg(workspaceRoot, value));
  }
  return resolved;
}

function readWorkspacePackageContract(workspaceRoot: string): WorkspacePackageContract {
  const lockfileNames = [
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "npm-shrinkwrap.json"
  ].filter((name) => existsSync(path.join(workspaceRoot, name)));

  let packageJson: { packageManager?: unknown; scripts?: Record<string, unknown> } | null = null;
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
        packageManager?: unknown;
        scripts?: Record<string, unknown>;
      };
    } catch {
      packageJson = null;
    }
  }

  return detectWorkspacePackageContract({
    packageJson,
    lockfileNames
  });
}

interface InternalCommandRun {
  status: CommandRunStatus;
  logs: CommandRunLogs;
  process: ChildProcessWithoutNullStreams | null;
  timeoutHandle: NodeJS.Timeout | null;
}

interface CommandExecutionServiceOptions {
  spawnImpl?: typeof spawn;
}

export class CommandExecutionService {
  private readonly spawnImpl: typeof spawn;

  private readonly runs = new Map<string, InternalCommandRun>();

  private workspaceRoot: string | null = null;

  constructor(options: CommandExecutionServiceOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  setWorkspaceRoot(workspaceRoot: string | null): void {
    this.workspaceRoot = workspaceRoot ? toResolvedPath(workspaceRoot) : null;
  }

  listAllowedCommands(): AllowedCommand[] {
    if (!this.workspaceRoot) {
      return [...FALLBACK_ALLOWED_COMMANDS];
    }
    try {
      const contract = readWorkspacePackageContract(this.workspaceRoot);
      const suggestions = buildPackageManagerCommandSuggestions(contract);
      return suggestions.map((entry) => ({
        id: entry.id,
        label: entry.label,
        command: entry.command,
        args: entry.args
      }));
    } catch {
      return [...FALLBACK_ALLOWED_COMMANDS];
    }
  }

  getWorkspacePackageContract(): WorkspacePackageContract | null {
    if (!this.workspaceRoot) return null;
    try {
      return readWorkspacePackageContract(this.workspaceRoot);
    } catch {
      return null;
    }
  }

  private resolveWorkspace(workspaceRoot: string): string {
    const resolvedWorkspace = toResolvedPath(workspaceRoot);
    if (this.workspaceRoot) {
      ensurePathInsideWorkspace(this.workspaceRoot, resolvedWorkspace);
    }
    return resolvedWorkspace;
  }

  private ensureSafeCommand(command: AllowedCommand | undefined): AllowedCommand {
    if (!command) {
      throw new Error("[COMMAND_BLOCKED] Freie Commands sind blockiert. Nutze eine erlaubte commandId.");
    }

    const commandLine = [command.command, ...command.args].join(" ");
    if (DANGEROUS_PATTERN.test(commandLine)) {
      throw new Error("[COMMAND_BLOCKED] Gefaehrliche Commands sind blockiert.");
    }

    return command;
  }

  private resolveCommandById(commandId: string): AllowedCommand | undefined {
    const dynamic = this.listAllowedCommands();
    return dynamic.find((entry) => entry.id === commandId)
      ?? FALLBACK_ALLOWED_COMMANDS.find((entry) => entry.id === commandId);
  }

  private ensureStructuredCommand(request: TerminalCommandRequest, workspaceRoot: string): TerminalCommandRequest {
    if (!request.command || request.command.trim().length === 0) {
      throw new Error("[COMMAND_BLOCKED] Leerer Befehl.");
    }

    const normalizedCommand = request.command.trim();
    if (!STRUCTURED_COMMAND_ALLOWLIST.has(normalizedCommand)) {
      throw new Error("[COMMAND_BLOCKED] Befehl ist nicht erlaubt.");
    }

    if (SHELL_METACHAR_PATTERN.test(normalizedCommand)) {
      throw new Error("[COMMAND_BLOCKED] Shell-Metazeichen sind blockiert.");
    }

    if (!Array.isArray(request.args)) {
      throw new Error("[COMMAND_BLOCKED] Argumentliste fehlt oder ist ungueltig.");
    }
    const args = request.args;
    if (args.length > MAX_ARGS) {
      throw new Error("[COMMAND_BLOCKED] Zu viele Argumente.");
    }

    for (const arg of args) {
      if (typeof arg !== "string" || arg.length === 0) {
        throw new Error("[COMMAND_BLOCKED] Ungueltiges Argument.");
      }
      if (SHELL_METACHAR_PATTERN.test(arg)) {
        throw new Error("[COMMAND_BLOCKED] Shell-Metazeichen sind blockiert.");
      }
      if (arg.includes("\0")) {
        throw new Error("[COMMAND_BLOCKED] Ungueltiges Argument.");
      }
    }

    const commandLine = [normalizedCommand, ...args].join(" ");
    if (DANGEROUS_PATTERN.test(commandLine)) {
      throw new Error("[COMMAND_BLOCKED] Gefaehrlicher Befehl ist blockiert.");
    }
    if (!hasAllowedArguments(normalizedCommand, args)) {
      throw new Error("[COMMAND_BLOCKED] Argumentkombination ist nicht erlaubt.");
    }

    if (normalizedCommand === "git") validateGitArgs(workspaceRoot, args);
    if (normalizedCommand === "pytest") validatePytestArgs(workspaceRoot, args);
    if (normalizedCommand === "uv") validatePytestArgs(workspaceRoot, args.slice(2));
    if (["pnpm", "npm", "yarn", "bun"].includes(normalizedCommand)) {
      validatePackageManagerArgs(workspaceRoot, normalizedCommand, args);
    }

    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 30_000, 1_000), MAX_TIMEOUT_MS);
    return {
      ...request,
      command: normalizedCommand,
      args,
      timeoutMs
    };
  }

  private generateRunId(commandId: string): string {
    return `${Date.now()}-${commandId}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private finishRun(runId: string, updater: (status: CommandRunStatus) => CommandRunStatus): void {
    const entry = this.runs.get(runId);
    if (!entry) {
      return;
    }

    if (entry.status.status !== "running") {
      return;
    }

    entry.status = updater(entry.status);
    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
      entry.timeoutHandle = null;
    }
    entry.process = null;
  }

  private spawnAllowlistedProcess(input: {
    command: string;
    args: string[];
    cwd: string;
  }): { child: ChildProcessWithoutNullStreams; diagnostics: CommandSpawnDiagnostics } {
    const useLauncher = requiresWindowsCmdLauncher(process.platform, input.command);
    if (useLauncher) {
      const invocation = buildWindowsCommandInvocation(input.command, input.args);
      const diagnostics: CommandSpawnDiagnostics = {
        platform: process.platform,
        launcher: invocation.diagnostics.launcher,
        executable: invocation.diagnostics.executable,
        args: invocation.diagnostics.args,
        cwd: input.cwd
      };
      const child = this.spawnImpl(invocation.file, invocation.args, {
        cwd: input.cwd,
        shell: false,
        windowsHide: true
      });
      return { child, diagnostics };
    }

    const diagnostics: CommandSpawnDiagnostics = {
      platform: process.platform,
      launcher: input.command,
      executable: input.command,
      args: input.args,
      cwd: input.cwd
    };
    const child = this.spawnImpl(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
      windowsHide: true
    });
    return { child, diagnostics };
  }

  async executeStructuredCommand(workspaceRoot: string, request: TerminalCommandRequest): Promise<CommandRunStatus> {
    const resolvedWorkspace = this.resolveWorkspace(workspaceRoot);
    const validatedRequest = this.ensureStructuredCommand(request, resolvedWorkspace);
    const resolvedCwd = validatedRequest.cwd
      ? ensurePathInsideWorkspace(this.workspaceRoot ?? workspaceRoot, validatedRequest.cwd)
      : resolvedWorkspace;
    const runId = this.generateRunId(validatedRequest.command);
    const startedAt = new Date().toISOString();

    const initialStatus: CommandRunStatus = {
      runId,
      commandId: validatedRequest.command,
      label: validatedRequest.command,
      status: "running",
      exitCode: null,
      startedAt,
      finishedAt: null,
      timedOut: false,
      cancelled: false
    };

    const runEntry: InternalCommandRun = {
      status: initialStatus,
      logs: {
        runId,
        stdout: "",
        stderr: ""
      },
      process: null,
      timeoutHandle: null
    };
    this.runs.set(runId, runEntry);

    return new Promise<CommandRunStatus>((resolve) => {
      let diagnostics: CommandSpawnDiagnostics;
      let child: ChildProcessWithoutNullStreams;
      try {
        const spawned = this.spawnAllowlistedProcess({
          command: validatedRequest.command,
          args: validatedRequest.args,
          cwd: resolvedCwd
        });
        child = spawned.child;
        diagnostics = spawned.diagnostics;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.finishRun(runId, (status) => {
          const nextStatus = {
            ...status,
            status: "failed" as const,
            exitCode: 1,
            finishedAt: new Date().toISOString()
          };
          runEntry.logs.stderr += `${message}\n`;
          resolve({ ...nextStatus });
          return nextStatus;
        });
        return;
      }

      runEntry.process = child;

      child.stdout.on("data", (chunk: Buffer | string) => {
        const value = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        const current = this.runs.get(runId);
        if (!current) {
          return;
        }
        current.logs.stdout = (current.logs.stdout + value).slice(-MAX_LOG_CHARS);
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const value = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        const current = this.runs.get(runId);
        if (!current) {
          return;
        }
        current.logs.stderr = (current.logs.stderr + value).slice(-MAX_LOG_CHARS);
      });

      const settle = (status: CommandRunStatus) => {
        resolve({ ...status });
      };

      child.on("error", (error: Error) => {
        const current = this.runs.get(runId);
        if (!current) {
          return;
        }
        const enriched = buildSpawnDiagnostics({
          ...diagnostics,
          error: error as NodeJS.ErrnoException
        });
        current.logs.stderr += `${formatSpawnDiagnostics(enriched)}\n${error.message}\n`;
        this.finishRun(runId, (status) => {
          const nextStatus = {
            ...status,
            status: "failed" as const,
            exitCode: 1,
            finishedAt: new Date().toISOString()
          };
          settle(nextStatus);
          return nextStatus;
        });
      });

      child.on("exit", (code: number | null) => {
        const current = this.runs.get(runId);
        if (!current) {
          return;
        }

        const exitCode = code ?? 1;
        this.finishRun(runId, (status) => {
          const nextStatus = {
            ...status,
            status: status.cancelled ? "cancelled" as const : status.timedOut ? "failed" as const : exitCode === 0 ? "completed" as const : "failed" as const,
            exitCode,
            finishedAt: new Date().toISOString()
          };
          settle(nextStatus);
          return nextStatus;
        });
      });

      runEntry.timeoutHandle = setTimeout(() => {
        const current = this.runs.get(runId);
        if (!current || current.status.status !== "running") {
          return;
        }
        current.logs.stderr += "[TIMEOUT] Command timeout reached.\n";
        if (current.process?.pid) {
          killProcessTree(current.process.pid);
        }
        this.finishRun(runId, (status) => {
          const nextStatus = {
            ...status,
            status: "failed" as const,
            timedOut: true,
            finishedAt: new Date().toISOString()
          };
          settle(nextStatus);
          return nextStatus;
        });
      }, Math.max(1, validatedRequest.timeoutMs ?? 30_000));
    });
  }

  async executeCommand(workspaceRoot: string, commandId: string, timeoutMs: number): Promise<CommandRunStatus> {
    const resolvedWorkspace = this.resolveWorkspace(workspaceRoot);
    const stats = await fs.stat(resolvedWorkspace);
    if (!stats.isDirectory()) {
      throw new Error("[WORKSPACE_INVALID] Workspace-Pfad ist kein Verzeichnis.");
    }

    const command = this.ensureSafeCommand(this.resolveCommandById(commandId));
    const validatedCommand = this.ensureStructuredCommand({
      command: command.command,
      args: command.args,
      cwd: resolvedWorkspace,
      timeoutMs
    }, resolvedWorkspace);
    const runId = this.generateRunId(commandId);
    const startedAt = new Date().toISOString();

    const initialStatus: CommandRunStatus = {
      runId,
      commandId: command.id,
      label: command.label,
      status: "running",
      exitCode: null,
      startedAt,
      finishedAt: null,
      timedOut: false,
      cancelled: false
    };

    const runEntry: InternalCommandRun = {
      status: initialStatus,
      logs: {
        runId,
        stdout: "",
        stderr: ""
      },
      process: null,
      timeoutHandle: null
    };
    this.runs.set(runId, runEntry);

    let diagnostics: CommandSpawnDiagnostics;
    let child: ChildProcessWithoutNullStreams;
    try {
      const spawned = this.spawnAllowlistedProcess({
        command: validatedCommand.command,
        args: validatedCommand.args,
        cwd: resolvedWorkspace
      });
      child = spawned.child;
      diagnostics = spawned.diagnostics;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runEntry.logs.stderr += `${message}\n`;
      this.finishRun(runId, (status) => ({
        ...status,
        status: "failed",
        exitCode: 1,
        finishedAt: new Date().toISOString()
      }));
      return { ...this.runs.get(runId)!.status };
    }

    runEntry.process = child;

    child.stdout.on("data", (chunk: Buffer | string) => {
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const current = this.runs.get(runId);
      if (!current) {
        return;
      }
      current.logs.stdout = (current.logs.stdout + value).slice(-MAX_LOG_CHARS);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const current = this.runs.get(runId);
      if (!current) {
        return;
      }
      current.logs.stderr = (current.logs.stderr + value).slice(-MAX_LOG_CHARS);
    });

    child.on("error", (error: Error) => {
      const current = this.runs.get(runId);
      if (!current) {
        return;
      }
      const enriched = buildSpawnDiagnostics({
        ...diagnostics,
        error: error as NodeJS.ErrnoException
      });
      current.logs.stderr += `${formatSpawnDiagnostics(enriched)}\n${error.message}\n`;
      this.finishRun(runId, (status) => ({
        ...status,
        status: "failed",
        exitCode: 1,
        finishedAt: new Date().toISOString()
      }));
    });

    child.on("exit", (code: number | null) => {
      const current = this.runs.get(runId);
      if (!current) {
        return;
      }

      const exitCode = code ?? 1;
      this.finishRun(runId, (status) => ({
        ...status,
        status: status.cancelled ? "cancelled" : status.timedOut ? "failed" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        finishedAt: new Date().toISOString()
      }));
    });

    runEntry.timeoutHandle = setTimeout(() => {
      const current = this.runs.get(runId);
      if (!current || current.status.status !== "running") {
        return;
      }
      current.logs.stderr += "[TIMEOUT] Command timeout reached.\n";
      if (current.process?.pid) {
        killProcessTree(current.process.pid);
      }
      this.finishRun(runId, (status) => ({
        ...status,
        status: "failed",
        timedOut: true,
        finishedAt: new Date().toISOString()
      }));
    }, Math.max(1, timeoutMs));

    return { ...initialStatus };
  }

  cancelCommand(runId: string): { cancelled: boolean } {
    const entry = this.runs.get(runId);
    if (!entry || entry.status.status !== "running") {
      return { cancelled: false };
    }

    if (entry.process?.pid) {
      killProcessTree(entry.process.pid);
    }

    this.finishRun(runId, (status) => ({
      ...status,
      status: "cancelled",
      cancelled: true,
      finishedAt: new Date().toISOString()
    }));

    return { cancelled: true };
  }

  getCommandRunStatus(runId: string): CommandRunStatus {
    const entry = this.runs.get(runId);
    if (!entry) {
      throw new Error("Command run not found.");
    }
    return { ...entry.status };
  }

  streamCommandLogs(runId: string): CommandRunLogs {
    const entry = this.runs.get(runId);
    if (!entry) {
      throw new Error("Command run not found.");
    }

    return {
      runId: entry.logs.runId,
      stdout: entry.logs.stdout,
      stderr: entry.logs.stderr
    };
  }
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/F", "/T", "/PID", String(pid)], { shell: false, windowsHide: true });
    killer.on("error", (error) => console.error(`[PROCESS_KILL_FAILED] PID ${pid}:`, error));
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch (e) {
      console.error(`[PROCESS_KILL_FAILED] Failed to kill process ${pid}:`, e);
    }
  }
}
