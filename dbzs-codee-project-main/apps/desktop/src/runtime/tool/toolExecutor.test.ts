import { describe, expect, it, vi } from "vitest";
import { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import { PermissionManager } from "@/runtime/tool/permissionManager";
import type { ToolAdapterBridge } from "@/runtime/tool/toolAdapterBridge";
import type { ToolRequest } from "@/runtime/tool/toolContracts";
import { ToolExecutor } from "@/runtime/tool/toolExecutor";
import { getBuiltinMetadata, metadataToToolDefinition } from "@/runtime/tool/toolMetadata";
import { rememberTerminalAllowlist } from "@/runtime/tool/terminalAllowlist";
import { ToolRegistry } from "@/runtime/tool/toolRegistry";
import { ensureLocalStorage } from "@/test/ensureLocalStorage";

function registerBuiltin(registry: ToolRegistry, name: "read_file" | "apply_patch" | "run_terminal_command") {
  const metadata = getBuiltinMetadata(name);
  if (!metadata) {
    throw new Error(`Missing metadata for ${name}`);
  }
  registry.register(metadataToToolDefinition(metadata));
}

function createExecutor(
  adapter: Partial<ToolAdapterBridge>,
  options?: {
    defaultTimeoutMs?: number;
    approvalCallback?: (actorId: string, toolName: string, reason: string) => Promise<boolean>;
    requiresApprovalFor?: Array<"read_file" | "apply_patch" | "run_terminal_command">;
  }
) {
  const registry = new ToolRegistry();
  registerBuiltin(registry, "read_file");
  registerBuiltin(registry, "apply_patch");
  registerBuiltin(registry, "run_terminal_command");

  const permissions = new PermissionManager(options?.approvalCallback);
  permissions.upsertPolicy({
    actorId: "user",
    allowedScopes: ["filesystem.read", "filesystem.write", "terminal.exec"],
    requiresApprovalFor: options?.requiresApprovalFor
  });

  return new ToolExecutor({
    adapter: adapter as ToolAdapterBridge,
    eventBus: new RuntimeEventBus(),
    permissions,
    registry,
    defaultTimeoutMs: options?.defaultTimeoutMs ?? 20
  });
}

function baseRequest(input: Record<string, unknown>): ToolRequest {
  return {
    name: "read_file",
    actorId: "user",
    requestId: "req-1",
    workspaceRoot: "D:/repo",
    input
  };
}

describe("ToolExecutor", () => {
  it("executes a tool successfully", async () => {
    const executor = createExecutor({
      readFile: async () => "hello"
    });

    const result = await executor.execute(baseRequest({ path: "README.md" }));
    expect(result.status).toBe("ok");
    expect(result.output).toBe("hello");
  });

  it("returns timeout when tool exceeds timeout", async () => {
    const executor = createExecutor(
      {
        readFile: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "late";
        }
      },
      { defaultTimeoutMs: 10 }
    );

    const result = await executor.execute(baseRequest({ path: "README.md" }));
    expect(result.status).toBe("timeout");
  });

  it("supports explicit cancellation", async () => {
    const executor = createExecutor(
      {
        readFile: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "late";
        }
      },
      { defaultTimeoutMs: 200 }
    );

    const request = baseRequest({ path: "README.md" });
    const pending = executor.execute(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelled = executor.cancel("req-1");
    expect(cancelled).toBe(true);

    const result = await pending;
    expect(result.status).toBe("cancelled");
  });

  it("forwards explicit proposed content for apply_patch", async () => {
    const applyPatch = vi.fn().mockResolvedValue({ ok: true });
    const executor = createExecutor(
      {
        applyPatch
      },
      { defaultTimeoutMs: 200 }
    );

    const result = await executor.execute({
      name: "apply_patch",
      actorId: "user",
      requestId: "req-2",
      workspaceRoot: "D:/repo",
      input: {
        path: ".codee/runtime-agent-proposal.md",
        targetPath: "docs/RUNTIME_ARCHITECTURE_CODEE.md",
        summary: "update readme",
        proposedContent: "# Runtime Change Proposal",
        previewOnly: true
      }
    });

    expect(result.status).toBe("ok");
    expect(applyPatch).toHaveBeenCalledWith(
      ".codee/runtime-agent-proposal.md",
      "# Runtime Change Proposal",
      true
    );
  });

  it("bypasses approval when terminal command is allowlisted", async () => {
    ensureLocalStorage();
    localStorage.clear();
    rememberTerminalAllowlist("D:/repo", "pnpm test", "prefix");
    const approval = vi.fn().mockResolvedValue(false);
    const runTerminalCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok" });
    const executor = createExecutor(
      { runTerminalCommand },
      {
        approvalCallback: approval,
        requiresApprovalFor: ["run_terminal_command"]
      }
    );

    const result = await executor.execute({
      name: "run_terminal_command",
      actorId: "user",
      requestId: "req-3",
      workspaceRoot: "D:/repo",
      input: { command: "pnpm test --filter desktop" }
    });

    expect(result.status).toBe("ok");
    expect(approval).not.toHaveBeenCalled();
    expect(runTerminalCommand).toHaveBeenCalledOnce();
  });

  it("forces approval for execPolicy prompt commands", async () => {
    const approval = vi.fn().mockResolvedValue(true);
    const runTerminalCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok" });
    const executor = createExecutor(
      { runTerminalCommand },
      {
        approvalCallback: approval,
        requiresApprovalFor: []
      }
    );

    const result = await executor.execute({
      name: "run_terminal_command",
      actorId: "user",
      requestId: "req-4",
      workspaceRoot: "D:/repo",
      input: { command: "del /s /f build" }
    });

    expect(approval).toHaveBeenCalledOnce();
    expect(result.status).toBe("ok");
  });
});
