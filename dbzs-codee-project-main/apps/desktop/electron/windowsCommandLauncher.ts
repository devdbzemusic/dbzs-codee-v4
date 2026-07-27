import { accessSync, constants as FsConstants } from "node:fs";
import path from "node:path";

export interface CommandSpawnDiagnostics {
  platform: string;
  launcher: string;
  executable: string;
  args: string[];
  cwd: string;
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

const DEFAULT_WIN_COMSPEC = "C:\\Windows\\System32\\cmd.exe";

/**
 * Resolve a validated Windows command launcher (cmd.exe).
 * Prefer process.env.ComSpec when it points at an absolute cmd.exe.
 */
export function resolveWindowsCommandLauncher(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env.ComSpec ?? env.COMSPEC ?? "").trim();
  if (raw) {
    const normalized = path.normalize(raw);
    const base = path.basename(normalized).toLowerCase();
    if (path.isAbsolute(normalized) && base === "cmd.exe") {
      try {
        accessSync(normalized, FsConstants.F_OK);
        return normalized;
      } catch {
        // fall through to default
      }
    }
  }
  return DEFAULT_WIN_COMSPEC;
}

/**
 * Quote a single argument for cmd.exe /c per Windows quoting rules.
 * Rejects shell metacharacters that must never appear in allowlisted argv.
 */
export function quoteWindowsCmdArgument(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (/[\r\n]/.test(arg)) {
    throw new Error("[COMMAND_BLOCKED] Newlines in command arguments are forbidden.");
  }
  if (/[|&<>^%]/.test(arg)) {
    throw new Error("[COMMAND_BLOCKED] Shell metacharacters in command arguments are forbidden.");
  }
  if (!/[\s"]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

export interface WindowsCommandInvocation {
  file: string;
  args: string[];
  diagnostics: Pick<CommandSpawnDiagnostics, "launcher" | "executable" | "args">;
}

/**
 * Build a safe Windows spawn invocation: ComSpec /d /s /c <quoted argv>.
 * Caller must keep shell: false on the spawned cmd.exe process.
 */
export function buildWindowsCommandInvocation(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): WindowsCommandInvocation {
  if (!executable.trim()) {
    throw new Error("[COMMAND_BLOCKED] Empty executable.");
  }
  if (/[|&;<>()$`"'\r\n]/.test(executable) || executable.includes("..")) {
    throw new Error("[COMMAND_BLOCKED] Invalid executable name.");
  }
  const launcher = resolveWindowsCommandLauncher(env);
  const commandLine = [executable, ...args].map(quoteWindowsCmdArgument).join(" ");
  return {
    file: launcher,
    args: ["/d", "/s", "/c", commandLine],
    diagnostics: {
      launcher,
      executable,
      args: [...args]
    }
  };
}

const WINDOWS_CMD_WRAPPER_COMMANDS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "npm.cmd",
  "pnpm.cmd",
  "yarn.cmd",
  "bun.cmd",
  "npx.cmd"
]);

export function requiresWindowsCmdLauncher(
  platform: NodeJS.Platform,
  command: string
): boolean {
  if (platform !== "win32") {
    return false;
  }
  const lower = command.toLowerCase();
  return (
    WINDOWS_CMD_WRAPPER_COMMANDS.has(lower) ||
    lower.endsWith(".cmd") ||
    lower.endsWith(".bat")
  );
}

export function verifyExecutableAvailability(
  executable: string,
  platform: NodeJS.Platform = process.platform
): { available: boolean; reason?: string } {
  if (!executable.trim()) {
    return { available: false, reason: "empty_executable" };
  }
  if (platform === "win32" && requiresWindowsCmdLauncher(platform, executable)) {
    // Resolved via PATH inside cmd.exe — availability checked at spawn time.
    return { available: true };
  }
  if (path.isAbsolute(executable)) {
    try {
      accessSync(executable, FsConstants.F_OK);
      return { available: true };
    } catch {
      return { available: false, reason: "executable_not_found" };
    }
  }
  // Relative / PATH binaries: defer to spawn.
  return { available: true };
}

export function formatSpawnDiagnostics(diag: CommandSpawnDiagnostics): string {
  return [
    `[SPAWN_FAILED] platform=${diag.platform}`,
    `launcher=${diag.launcher}`,
    `executable=${diag.executable}`,
    `args=${JSON.stringify(diag.args)}`,
    `cwd=${diag.cwd}`,
    diag.code ? `code=${diag.code}` : null,
    typeof diag.errno === "number" ? `errno=${diag.errno}` : null,
    diag.syscall ? `syscall=${diag.syscall}` : null
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildSpawnDiagnostics(input: {
  platform: string;
  launcher: string;
  executable: string;
  args: string[];
  cwd: string;
  error?: NodeJS.ErrnoException;
}): CommandSpawnDiagnostics {
  return {
    platform: input.platform,
    launcher: input.launcher,
    executable: input.executable,
    args: input.args,
    cwd: input.cwd,
    code: input.error?.code,
    errno: typeof input.error?.errno === "number" ? input.error.errno : undefined,
    syscall: input.error?.syscall,
    path: input.error?.path
  };
}
