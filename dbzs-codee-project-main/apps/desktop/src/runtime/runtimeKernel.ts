import { AgentOrchestrator, DEFAULT_AGENT_POLICY } from "@/runtime/agent/agentOrchestrator";
import type { AgentLoopResult, AgentRunRequest } from "@/runtime/agent/agentContracts";
import {
  ActiveFileCollector,
  DiagnosticsCollector,
  GitDiffCollector,
  OpenTabsCollector,
  WorkspaceStructureCollector
} from "@/runtime/context/contextCollectors";
import { ContextPipeline } from "@/runtime/context/contextPipeline";
import { PromptContextBuilder } from "@/runtime/context/promptContextBuilder";
import { RuntimeEventBus } from "@/runtime/core/runtimeEventBus";
import { MemoryRuntime } from "@/runtime/memory/memoryRuntime";
import type { SqliteLikeDatabase } from "@/runtime/memory/sqliteMemoryRuntime";
import { SqliteMemoryRepository } from "@/runtime/memory/sqliteMemoryRuntime";
import { SimpleEmbeddingProvider } from "@/runtime/memory/simpleEmbeddingProvider";
import { DesktopToolAdapterBridge } from "@/runtime/tool/toolAdapterBridge";
import { ToolRuntime } from "@/runtime/tool/toolRuntime";
import type { PromptContext } from "@/runtime/context/contextContracts";
import type { AgentExecutionContext } from "@/runtime/agent/agentContracts";
import type { PatchApprovalCallback } from "@/runtime/agent/agentLoop";
import { selectRecommendedCommandIds } from "@/stores/testAgentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { ToolAdapterBridge } from "@/runtime/tool/toolAdapterBridge";
import type { ApprovalCallback } from "@/runtime/tool/permissionManager";
import type { ToolScope } from "@/runtime/tool/toolContracts";

const DEFAULT_RUNTIME_SCOPES: ToolScope[] = [
  "filesystem.read",
  "filesystem.write",
  "workspace.inspect",
  "workspace.search",
  "terminal.exec",
  "git.read",
  "tests.exec"
];

function deriveExecutionContext(goal: string, context: PromptContext): AgentExecutionContext {
  const activeFileSignal = context.signals.find((signal) => signal.source === "active_file");
  const primaryFilePath =
    activeFileSignal?.key ??
    context.signals.find((signal) => signal.source === "open_tabs")?.key;

  const relatedFilePaths = Array.from(
    new Set(
      context.signals
        .map((signal) => signal.key)
        .filter((key) => key.includes("/") || key.includes("\\"))
    )
  ).slice(0, 8);

  const gitDiffFilePath = context.signals.find(
    (signal) => signal.source === "git_diff" && signal.key !== "repo-status"
  )?.key;

  const files = useWorkspaceStore.getState().files;
  const [testCommandId] = selectRecommendedCommandIds(files);

  return {
    primaryFilePath,
    relatedFilePaths,
    searchQuery: goal,
    gitDiffFilePath,
    testCommandId,
    scratchNotePath: ".codee/runtime-agent-proposal.md",
    contextSummary: context.summary,
    primaryFileExcerpt: activeFileSignal?.value.slice(0, 1200)
  };
}

export interface RuntimeKernelOptions {
  sqliteDb: SqliteLikeDatabase;
  toolAdapter?: ToolAdapterBridge;
  requestPatchApproval?: PatchApprovalCallback;
  requestToolApproval?: ApprovalCallback;
}

export class RuntimeKernel {
  readonly events: RuntimeEventBus;

  readonly tools: ToolRuntime;

  readonly context: ContextPipeline;

  readonly promptContext: PromptContextBuilder;

  readonly memory: MemoryRuntime;

  readonly agent: AgentOrchestrator;

  private readonly embeddings = new SimpleEmbeddingProvider();

  constructor(options: RuntimeKernelOptions) {
    this.events = new RuntimeEventBus();
    this.tools = new ToolRuntime(
      this.events,
      options.toolAdapter ?? new DesktopToolAdapterBridge(),
      options.requestToolApproval
    );
    this.context = new ContextPipeline([
      new ActiveFileCollector(),
      new OpenTabsCollector(),
      new DiagnosticsCollector(),
      new GitDiffCollector(),
      new WorkspaceStructureCollector()
    ]);
    this.promptContext = new PromptContextBuilder();

    const memoryRepository = new SqliteMemoryRepository(options.sqliteDb);
    this.memory = new MemoryRuntime(memoryRepository, this.embeddings);

    this.agent = new AgentOrchestrator(
      this.events,
      {
        runTool: (request) => this.tools.run(request)
      },
      DEFAULT_AGENT_POLICY,
      options.requestPatchApproval
    );
  }

  async initialize(): Promise<void> {
    await this.memory.initialize();
  }

  async runAgent(request: AgentRunRequest, signal: AbortSignal): Promise<AgentLoopResult> {
    this.tools.permissions.upsertPolicy({
      actorId: request.actorId,
      allowedScopes: DEFAULT_RUNTIME_SCOPES
    });

    const context = await this.context.buildPromptContext({
      userGoal: request.goal,
      maxTokens: 5000
    });

    const promptBlocks = this.promptContext.build(context);

    await this.memory.remember(
      request.workspaceRoot,
      "session",
      [promptBlocks.systemBlock, promptBlocks.contextBlock].join("\n\n"),
      [request.role, request.mode]
    );

    return this.agent.run(
      {
        ...request,
        executionContext: deriveExecutionContext(request.goal, context)
      },
      signal
    );
  }
}
