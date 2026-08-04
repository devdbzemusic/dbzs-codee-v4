import type { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import { isToolExposed } from "@/runtime/tool/toolDisclosure";
import { normalizeToolError } from "@/runtime/tool/errorNormalization";
import type { PermissionManager } from "@/runtime/tool/permissionManager";
import {
  describeDeferredTool,
  searchDeferredTools
} from "@/runtime/tool/terminalAllowlist";
import type { ToolAdapterBridge } from "@/runtime/tool/toolAdapterBridge";
import {
  ToolInputSchemaByName,
  type ToolAuditEntry,
  type ToolDefinition,
  type ToolName,
  type ToolRequest,
  type ToolResult
} from "@/runtime/tool/toolContracts";
import type { ToolRegistry } from "@/runtime/tool/toolRegistry";

export interface ToolExecutorOptions {
  registry: ToolRegistry;
  permissions: PermissionManager;
  adapter: ToolAdapterBridge;
  eventBus: RuntimeEventBus;
  defaultTimeoutMs?: number;
}

export class ToolExecutor {
  private readonly running = new Map<string, AbortController>();

  private readonly audit: ToolAuditEntry[] = [];

  private readonly defaultTimeoutMs: number;

  constructor(private readonly options: ToolExecutorOptions) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 20_000;
  }

  listAuditEntries(): ToolAuditEntry[] {
    return [...this.audit];
  }

  cancel(requestId: string): boolean {
    const controller = this.running.get(requestId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    const startedAt = new Date().toISOString();
    const definition = this.options.registry.get(request.name);

    try {
      const input = this.validateInput(definition, request.input);

      const permission = await this.options.permissions.evaluate(
        request.actorId,
        request.name,
        definition.scopes,
        {
          workspaceRoot: request.workspaceRoot,
          input: input as Record<string, unknown>
        }
      );

      if (!permission.granted) {
        throw new Error(permission.reason ?? "Permission denied");
      }

      const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
      const controller = new AbortController();
      this.running.set(request.requestId, controller);

      const output = await this.withTimeout(
        request.requestId,
        timeoutMs,
        () => this.executeToolCall(request, input),
        controller.signal
      );

      const finishedAt = new Date().toISOString();
      const result: ToolResult = {
        requestId: request.requestId,
        toolName: request.name,
        status: "ok",
        startedAt,
        finishedAt,
        output
      };

      this.appendAudit(request, "ok", startedAt, finishedAt);
      await this.options.eventBus.emit("tool-runtime", "tool.completed", result);
      return result;
    } catch (error) {
      const normalized = normalizeToolError(error);
      const finishedAt = new Date().toISOString();

      const status: ToolResult["status"] =
        normalized.code === "TOOL_CANCELLED"
          ? "cancelled"
          : normalized.code === "TOOL_TIMEOUT"
            ? "timeout"
            : "error";

      const result: ToolResult = {
        requestId: request.requestId,
        toolName: request.name,
        status,
        startedAt,
        finishedAt,
        error: normalized
      };

      this.appendAudit(request, status, startedAt, finishedAt, normalized.code);
      await this.options.eventBus.emit("tool-runtime", "tool.failed", result);
      return result;
    } finally {
      this.running.delete(request.requestId);
    }
  }

  private validateInput<TInput>(definition: ToolDefinition<TInput>, input: unknown): TInput {
    return definition.inputSchema.parse(input);
  }

  private appendAudit(
    request: ToolRequest,
    status: ToolResult["status"],
    startedAt: string,
    finishedAt: string,
    errorCode?: string
  ): void {
    this.audit.push({
      requestId: request.requestId,
      toolName: request.name,
      actorId: request.actorId,
      workspaceRoot: request.workspaceRoot,
      inputSummary: JSON.stringify(request.input).slice(0, 160),
      status,
      startedAt,
      finishedAt,
      errorCode
    });
  }

  private async withTimeout<T>(
    requestId: string,
    timeoutMs: number,
    factory: () => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    if (signal.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }

    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Tool request ${requestId} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new DOMException("Operation aborted", "AbortError"));
        },
        { once: true }
      );
    });

    return Promise.race([factory(), timeoutPromise]);
  }

  private async executeToolCall(request: ToolRequest, input: unknown): Promise<unknown> {
    const name = request.name;
    const adapter = this.options.adapter;
    const directRuntimeChatWriteTools: ToolName[] = ["write_file", "apply_patch", "create_file", "delete_file", "rename_file"];
    if (request.actorId === "runtime-chat" && directRuntimeChatWriteTools.includes(name)) {
      throw new Error(`Runtime Chat darf ${name} nicht direkt ausführen. Nutze propose_file_changes fuer Review und Freigabe.`);
    }

    switch (name) {
      case "write_skill_artifact": {
        const value = ToolInputSchemaByName.write_skill_artifact.parse(input);
        if (!request.bridgeContext?.skillRunId || value.skillRunId !== request.bridgeContext.skillRunId) {
          throw new Error("[SKILL_TOOL_POLICY_VIOLATION] Artifact write does not match active skill run.");
        }
        return adapter.writeSkillArtifact(request.workspaceRoot, value);
      }
      case "tool_search": {
        const value = ToolInputSchemaByName.tool_search.parse(input);
        const ctx = request.bridgeContext;
        if (!ctx) {
          throw new Error("Bridge context missing for tool_search.");
        }
        return searchDeferredTools(value.query, ctx.availabilityContext, ctx.deferrableNames);
      }
      case "tool_describe": {
        const value = ToolInputSchemaByName.tool_describe.parse(input);
        const described = describeDeferredTool(value.name);
        if (!described) {
          throw new Error(`Unknown tool: ${value.name}`);
        }
        return described;
      }
      case "tool_call": {
        const value = ToolInputSchemaByName.tool_call.parse(input);
        const targetName = value.name;
        const ctx = request.bridgeContext;
        if (!ctx) {
          throw new Error("Bridge context missing for tool_call.");
        }
        const exposure = isToolExposed(ctx.profile, ctx.availabilityContext, targetName);
        if (!exposure.allowed && !ctx.deferrableNames.includes(targetName)) {
          throw new Error(exposure.reason ?? `Tool ${targetName} is not callable via bridge.`);
        }
        if (!exposure.allowed && ctx.deferrableNames.includes(targetName)) {
          // deferrable via bridge — allowed
        } else if (!exposure.allowed) {
          throw new Error(exposure.reason ?? `Tool ${targetName} is not exposed.`);
        }

        return this.execute({
          ...request,
          name: targetName,
          input: value.input,
          requestId: `${request.requestId}-bridge-${targetName}`
        }).then((result) => {
          if (result.status !== "ok") {
            throw new Error(result.error?.message ?? `Bridge call to ${targetName} failed.`);
          }
          return result.output;
        });
      }
      case "read_file": {
        const value = ToolInputSchemaByName.read_file.parse(input);
        return adapter.readFile(value.path, value.startLine, value.endLine);
      }
      case "write_file": {
        const value = ToolInputSchemaByName.write_file.parse(input);
        await adapter.writeFile(value.path, value.content);
        return { ok: true };
      }
      case "apply_patch": {
        const value = ToolInputSchemaByName.apply_patch.parse(input);
        return adapter.applyPatch(value.path, value.proposedContent, value.previewOnly);
      }
      case "propose_file_changes": {
        const value = ToolInputSchemaByName.propose_file_changes.parse(input);
        return value;
      }
      case "list_files": {
        const value = ToolInputSchemaByName.list_files.parse(input);
        return adapter.listFiles(value.path, value.recursive);
      }
      case "search_workspace": {
        const value = ToolInputSchemaByName.search_workspace.parse(input);
        return adapter.searchWorkspace(value.query, value.limit);
      }
      case "grep": {
        const value = ToolInputSchemaByName.grep.parse(input);
        return adapter.grep(value.pattern, value.include, value.maxResults);
      }
      case "open_file": {
        const value = ToolInputSchemaByName.open_file.parse(input);
        await adapter.openFile(value.path);
        return { ok: true };
      }
      case "create_file": {
        const value = ToolInputSchemaByName.create_file.parse(input);
        await adapter.createFile(value.path, value.content);
        return { ok: true };
      }
      case "delete_file": {
        const value = ToolInputSchemaByName.delete_file.parse(input);
        await adapter.deleteFile(value.path);
        return { ok: true };
      }
      case "rename_file": {
        const value = ToolInputSchemaByName.rename_file.parse(input);
        await adapter.renameFile(value.fromPath, value.toPath);
        return { ok: true };
      }
      case "run_terminal_command": {
        const value = ToolInputSchemaByName.run_terminal_command.parse(input);
        return adapter.runTerminalCommand(value.command, value.cwd, value.timeoutMs);
      }
      case "get_git_diff": {
        const value = ToolInputSchemaByName.get_git_diff.parse(input);
        return adapter.getGitDiff(value.filePath);
      }
      case "run_tests": {
        const value = ToolInputSchemaByName.run_tests.parse(input);
        return adapter.runTests(value.commandId);
      }
      case "run_workspace_command": {
        const value = ToolInputSchemaByName.run_workspace_command.parse(input);
        return adapter.runWorkspaceCommand(value.commandId);
      }
      case "install_dependency": {
        const value = ToolInputSchemaByName.install_dependency.parse(input);
        return adapter.installDependency({
          packageManager: value.packageManager,
          packages: value.packages,
          dependencyType: value.dependencyType,
          reason: value.reason
        });
      }
      case "web_search": {
        const value = ToolInputSchemaByName.web_search.parse(input);
        return adapter.webSearch(
          value.query,
          value.purpose,
          value.maxResults,
          value.recencyDays,
          value.allowedDomains,
          value.safeSearch,
          value.language
        );
      }
      case "web_fetch": {
        const value = ToolInputSchemaByName.web_fetch.parse(input);
        return adapter.webFetch(value.url, value.purpose, value.maxBytes, value.timeoutMs);
      }
      case "ask_user":
        throw new Error(
          "ask_user must be intercepted by the Runtime Chat agent runner before reaching ToolExecutor; " +
            "it has no direct execution path."
        );
      default:
        if (String(name).startsWith("mcp_")) {
          return {
            tool: name,
            status: "mock",
            message: "MCP tool executed via mock provider.",
            input
          };
        }
        throw new Error(`Unhandled tool: ${name}`);
    }
  }
}
