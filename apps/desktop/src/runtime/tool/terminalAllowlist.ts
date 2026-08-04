import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import type { ToolName } from "@/runtime/tool/toolContracts";
import { getBuiltinMetadata } from "@/runtime/tool/toolMetadata";
import { getRuntimeKernel } from "@/services/runtimeKernelService";

export type TerminalAllowlistMode = "exact" | "prefix";

export interface TerminalAllowlistEntry {
  pattern: string;
  mode: TerminalAllowlistMode;
  createdAt: string;
}

export interface TerminalAllowlistSnapshot {
  [workspaceRoot: string]: TerminalAllowlistEntry[];
}

const STORAGE_KEY = "dbzs-terminal-allowlist-v1";

export function normalizeTerminalCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis.localStorage !== "undefined") {
    return globalThis.localStorage;
  }
  return null;
}

function readSnapshot(): TerminalAllowlistSnapshot {
  const storage = getStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as TerminalAllowlistSnapshot;
  } catch {
    return {};
  }
}

function writeSnapshot(snapshot: TerminalAllowlistSnapshot): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore persistence failures
  }
}

export function listTerminalAllowlist(workspaceRoot: string): TerminalAllowlistEntry[] {
  const snapshot = readSnapshot();
  return snapshot[workspaceRoot] ?? [];
}

export function rememberTerminalAllowlist(
  workspaceRoot: string,
  command: string,
  mode: TerminalAllowlistMode = "prefix"
): TerminalAllowlistEntry {
  const pattern = normalizeTerminalCommand(command);
  const snapshot = readSnapshot();
  const entries = snapshot[workspaceRoot] ?? [];
  const existing = entries.find((entry) => entry.pattern === pattern && entry.mode === mode);
  if (existing) {
    return existing;
  }

  const entry: TerminalAllowlistEntry = {
    pattern,
    mode,
    createdAt: new Date().toISOString()
  };
  snapshot[workspaceRoot] = [entry, ...entries];
  writeSnapshot(snapshot);
  return entry;
}

export function revokeTerminalAllowlist(workspaceRoot: string, pattern: string): void {
  const normalized = normalizeTerminalCommand(pattern);
  const snapshot = readSnapshot();
  snapshot[workspaceRoot] = (snapshot[workspaceRoot] ?? []).filter(
    (entry) => entry.pattern !== normalized
  );
  writeSnapshot(snapshot);
}

export function isTerminalAllowlisted(workspaceRoot: string, command: string): boolean {
  const normalized = normalizeTerminalCommand(command);
  const entries = listTerminalAllowlist(workspaceRoot);
  return entries.some((entry) => {
    if (entry.mode === "exact") {
      return normalized === entry.pattern;
    }
    return normalized === entry.pattern || normalized.startsWith(`${entry.pattern} `);
  });
}

export function searchDeferredTools(
  query: string,
  ctx: ToolAvailabilityContext,
  deferrableNames: ToolName[]
): Array<{ name: ToolName; description: string }> {
  const q = query.trim().toLowerCase();
  const registry = getRuntimeKernel().tools.registry;
  const candidates = deferrableNames
    .filter((name) => registry.has(name) && registry.isAvailable(name, ctx))
    .map((name) => {
      const definition = registry.get(name);
      return { name, description: definition.modelDescription };
    });

  if (!q) {
    return candidates.slice(0, 20);
  }

  return candidates
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)
    )
    .slice(0, 20);
}

export function describeDeferredTool(name: string): Record<string, unknown> | null {
  const registry = getRuntimeKernel().tools.registry;
  if (!registry.has(name)) {
    const builtin = getBuiltinMetadata(name);
    if (!builtin) {
      return null;
    }
    return {
      name: builtin.name,
      description: builtin.modelDescription,
      inputSchema: builtin.inputSchema
    };
  }

  const definition = registry.get(name);
  const builtin = getBuiltinMetadata(name);
  return {
    name: definition.name,
    description: definition.modelDescription,
    toolset: definition.toolset,
    inputSchema: builtin?.inputSchema ?? { type: "object" }
  };
}
