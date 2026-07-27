import type { PatchApprovalCallback } from "@/runtime/agent/agentLoop";
import { RuntimeKernel } from "@/runtime/runtimeKernel";
import type { SqliteLikeDatabase, SqliteLikeStatement } from "@/runtime/memory/sqliteMemoryRuntime";
import type { ApprovalCallback } from "@/runtime/tool/permissionManager";
import type { ToolBridgeContext, ToolName, ToolRequest, ToolResult, ToolScope } from "@/runtime/tool/toolContracts";
import type { ToolRegistryProvider } from "@/runtime/tool/toolRegistry";

interface RuntimeMemoryRow {
  id: string;
  scope: string;
  workspace_root: string;
  content: string;
  tags_json: string;
  embedding_json: string | null;
  created_at: string;
  updated_at: string;
}

class InMemorySqliteStatement implements SqliteLikeStatement {
  constructor(
    private readonly rows: Map<string, RuntimeMemoryRow>,
    private readonly sql: string
  ) {}

  run(...params: unknown[]): unknown {
    const normalized = this.sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.includes("insert into memory_records")) {
      const [id, scope, workspaceRoot, content, tagsJson, embeddingJson, createdAt, updatedAt] = params;
      this.rows.set(String(id), {
        id: String(id),
        scope: String(scope),
        workspace_root: String(workspaceRoot),
        content: String(content),
        tags_json: String(tagsJson),
        embedding_json: embeddingJson == null ? null : String(embeddingJson),
        created_at: String(createdAt),
        updated_at: String(updatedAt)
      });
      return undefined;
    }

    if (normalized.includes("delete from memory_records")) {
      this.rows.delete(String(params[0] ?? ""));
      return undefined;
    }

    return undefined;
  }

  get<T = unknown>(..._params: unknown[]): T {
    return undefined as T;
  }

  all<T = unknown>(...params: unknown[]): T[] {
    const normalized = this.sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.includes("where workspace_root = ? and scope = ?")) {
      const [workspaceRoot, scope] = params;
      return [...this.rows.values()]
        .filter((row) => row.workspace_root === String(workspaceRoot) && row.scope === String(scope))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)) as T[];
    }

    if (normalized.includes("where workspace_root = ? and embedding_json is not null")) {
      const [workspaceRoot] = params;
      return [...this.rows.values()].filter(
        (row) => row.workspace_root === String(workspaceRoot) && row.embedding_json !== null
      ) as T[];
    }

    return [];
  }
}

class InMemorySqliteDatabase implements SqliteLikeDatabase {
  private readonly rows = new Map<string, RuntimeMemoryRow>();

  prepare(sql: string): SqliteLikeStatement {
    return new InMemorySqliteStatement(this.rows, sql);
  }

  exec(_sql: string): void {
    // Table creation is a no-op for the in-memory adapter.
  }
}

export const DEFAULT_RUNTIME_SCOPES: ToolScope[] = [
  "filesystem.read",
  "filesystem.write",
  "workspace.inspect",
  "workspace.search",
  "terminal.exec",
  "git.read",
  "tests.exec"
];

export const RUNTIME_TOOLS_REQUIRING_APPROVAL: ToolName[] = [
  "write_file",
  "apply_patch",
  "delete_file",
  "run_terminal_command"
];

const sharedRuntimeDb = new InMemorySqliteDatabase();

let kernel: RuntimeKernel | null = null;
let toolApprovalCallback: ApprovalCallback | undefined;
let patchApprovalCallback: PatchApprovalCallback | undefined;
let initialized = false;

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateKernel(): RuntimeKernel {
  if (!kernel) {
    kernel = new RuntimeKernel({
      sqliteDb: sharedRuntimeDb,
      requestPatchApproval: (...args) =>
        patchApprovalCallback?.(...args) ?? Promise.resolve(false),
      requestToolApproval: (...args) =>
        toolApprovalCallback?.(...args) ?? Promise.resolve(false)
    });
    initialized = false;
  }
  return kernel;
}

export function setRuntimeToolApprovalCallback(callback: ApprovalCallback | undefined): void {
  toolApprovalCallback = callback;
  kernel = null;
  initialized = false;
}

export function setRuntimePatchApprovalCallback(callback: PatchApprovalCallback | undefined): void {
  patchApprovalCallback = callback;
  kernel = null;
  initialized = false;
}

export function resetRuntimeKernelForTests(): void {
  kernel = null;
  initialized = false;
  toolApprovalCallback = undefined;
  patchApprovalCallback = undefined;
}

export function getRuntimeKernel(): RuntimeKernel {
  return getOrCreateKernel();
}

export async function ensureRuntimeKernelInitialized(): Promise<RuntimeKernel> {
  const instance = getOrCreateKernel();
  if (!initialized) {
    await instance.initialize();
    initialized = true;
  }
  return instance;
}

export function upsertRuntimeActorPolicy(actorId: string): void {
  getOrCreateKernel().tools.permissions.upsertPolicy({
    actorId,
    allowedScopes: DEFAULT_RUNTIME_SCOPES,
    requiresApprovalFor: RUNTIME_TOOLS_REQUIRING_APPROVAL
  });
}

export function listRuntimeToolNames(): ToolName[] {
  return getOrCreateKernel().tools.listTools();
}

export function registerRuntimeToolProvider(provider: ToolRegistryProvider): () => void {
  return getOrCreateKernel().tools.registerProvider(provider);
}

export async function runRuntimeTool(request: ToolRequest): Promise<ToolResult> {
  await ensureRuntimeKernelInitialized();
  upsertRuntimeActorPolicy(request.actorId);
  return getOrCreateKernel().tools.run(request);
}

export function buildRuntimeToolRequest(
  name: ToolName,
  workspaceRoot: string,
  input: Record<string, unknown>,
  actorId = "runtime-chat",
  bridgeContext?: ToolBridgeContext
): ToolRequest {
  return {
    name,
    actorId,
    requestId: createId("tool"),
    workspaceRoot,
    input,
    bridgeContext
  };
}
