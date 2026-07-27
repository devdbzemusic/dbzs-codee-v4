import type {
  AgentAction,
  AgentPatchApplyResult,
  AgentPatchPreview,
  AgentPatchProposal,
  AgentPlanProposal,
  ModelTargetAgent,
  PatchValidationResult,
  RuntimeChatMessage,
  RuntimeChatToolCallRecord,
  RuntimeChatWorkspaceContext,
  RuntimeStatus,
  WorkspaceFile
} from "@dbzs/shared";
import { agentRunService } from "@/services/agentRunService";
import { buildRuntimeAgentActionRegistry } from "@/services/runtimeAgentActions";
import { parseAssistantPayload } from "@/services/assistantPayloadParser";
import { classifyRuntimeChatError, formatChatErrorForUser } from "@/services/runtimeChatErrorClassifier";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import type { RuntimeChatActivityRun, RuntimeChatActivityStep } from "@/types/runtimeChatActivity";
import { estimateTokensCharHeuristic, type SpoolerLaneItem } from "@/runtime/context/contextSpooler";
import { useEditorStore } from "@/stores/editorStore";
import { useGitStore } from "@/stores/gitStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const MAX_CONTEXT_CHARS = 16_000;
const TOOLS_ENABLED_STORAGE_KEY = "dbzs-runtime-chat-tools-enabled";

interface WorkspaceContextPathNormalizationResult {
  normalized: string[];
  rejected: string[];
}

function summarizeRejectedContextPath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, "/");
  if (!normalized) return "<empty>";
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//") || normalized.startsWith("/")) {
    return "<absolute path rejected>";
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export async function normalizeWorkspaceContextPathCandidates(
  workspaceRoot: string,
  values: string[],
  normalizer?: (workspaceRoot: string, candidates: string[]) => Promise<string[]>
): Promise<WorkspaceContextPathNormalizationResult> {
  const normalized: string[] = [];
  const rejected: string[] = [];
  for (const value of values) {
    try {
      const [result] = normalizer
        ? await normalizer(workspaceRoot, [value])
        : [value.replace(/\\/g, "/")];
      if (result) normalized.push(result);
      else rejected.push(summarizeRejectedContextPath(value));
    } catch {
      rejected.push(summarizeRejectedContextPath(value));
    }
  }
  return { normalized, rejected };
}

export function loadToolsEnabled(): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }
  return localStorage.getItem(TOOLS_ENABLED_STORAGE_KEY) !== "0";
}

export const STOPPED_RUNTIME_STATUS: RuntimeStatus = {
  state: "stopped",
  provider: null,
  model_id: null,
  model_name: null,
  port: null,
  pid: null,
  endpoint: null,
  message: ""
};

function isImplementationWorkflowPhase(phase: string | null | undefined): boolean {
  return phase === "implementation" || phase === "executing" || phase === "awaiting_patch_approval";
}

function normalizeImplementationTaskType(
  taskType: import("@dbzs/shared").RuntimeTaskType,
  contractTaskType?: import("@dbzs/shared").RuntimeTaskType
): import("@dbzs/shared").RuntimeTaskType {
  const candidate =
    contractTaskType && contractTaskType !== "planning" && contractTaskType !== "architecture"
      ? contractTaskType
      : taskType;
  switch (candidate) {
    case "large_code_change":
    case "small_code_change":
    case "refactoring":
      return candidate;
    default:
      return "small_code_change";
  }
}

export function normalizeImplementationContinuationRouting(input: {
  phase?: string | null;
  taskType: import("@dbzs/shared").RuntimeTaskType;
  contractTaskType?: import("@dbzs/shared").RuntimeTaskType;
  targetAgent: ModelTargetAgent;
  preferPlannerFirst: boolean;
}): {
  taskType: import("@dbzs/shared").RuntimeTaskType;
  targetAgent: ModelTargetAgent;
  preferPlannerFirst: boolean;
  normalized: boolean;
} {
  if (!isImplementationWorkflowPhase(input.phase)) {
    return {
      taskType: input.taskType,
      targetAgent: input.targetAgent,
      preferPlannerFirst: input.preferPlannerFirst,
      normalized: false
    };
  }

  return {
    taskType: normalizeImplementationTaskType(input.taskType, input.contractTaskType),
    targetAgent: "coder",
    preferPlannerFirst: false,
    normalized: true
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${label} hat länger als ${timeoutMs / 1000}s gedauert`));
    }, timeoutMs);
  });

  if (signal) {
    if (signal.aborted) {
      if (timeoutId) clearTimeout(timeoutId);
      return Promise.reject(signal.reason || new Error("Cancelled"));
    }

    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(signal.reason || new Error("Cancelled"));
      });
    });

    return Promise.race([promise, timeoutPromise, abortPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export async function refreshRuntimeStatus(fallback: RuntimeStatus | null): Promise<RuntimeStatus> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const status = await import("@/services/backendClient").then(({ backendClient }) => backendClient.getRuntimeStatus());
      useRuntimeStore.setState({ status });
      return status;
    } catch {
      if (attempt < 2) {
        await sleep(200 * (attempt + 1));
      }
    }
  }

  try {
    const slots = await runtimeSlotManager.getAllSlotsStatus();
    const readySlot = slots.find((slot) => runtimeSlotManager.isSlotReady(slot));
    const runningSlot = readySlot ?? slots.find((slot) => slot.state === "running");
    if (runningSlot) {
      const status: RuntimeStatus = {
        state: runningSlot.state,
        provider: runningSlot.provider === "llama.cpp" || runningSlot.provider === "ollama" ? runningSlot.provider : null,
        model_id: runningSlot.model_id,
        model_name: runningSlot.model_name,
        port: runningSlot.port,
        pid: runningSlot.pid,
        endpoint: runningSlot.endpoint,
        message: runningSlot.message ?? `Slot ${runningSlot.slot_id} ist aktiv.`,
        stderr_tail: runningSlot.stderr_tail ?? undefined,
        stdout_tail: runningSlot.stdout_tail ?? undefined
      };
      useRuntimeStore.setState({ status });
      return status;
    }
  } catch {
    // best effort
  }

  const storeStatus = useRuntimeStore.getState().status;
  if (storeStatus?.state === "running") {
    return storeStatus;
  }
  if (fallback?.state === "running") {
    return fallback;
  }
  return fallback ?? STOPPED_RUNTIME_STATUS;
}

export function buildFileContext(activeFile: WorkspaceFile | null) {
  if (!activeFile) {
    return null;
  }

  return {
    path: activeFile.path,
    language: activeFile.language,
    content: activeFile.content.slice(0, MAX_CONTEXT_CHARS)
  };
}

export function buildWorkspaceLaneItems(
  workspaceContext: RuntimeChatWorkspaceContext | null | undefined,
  fallbackMessage: string | null
): SpoolerLaneItem[] {
  if (!workspaceContext) {
    return fallbackMessage
      ? [{
          id: "active-task-workspace",
          content: fallbackMessage,
          estimatedTokens: estimateTokensCharHeuristic(fallbackMessage)
        }]
      : [];
  }

  const fileTreePreview = workspaceContext.fileTree.slice(0, 40).map((entry) => `- ${entry}`).join("\n");
  const summary = [
    "[Workspace Context]",
    `Name: ${workspaceContext.name}`,
    `Root: ${workspaceContext.rootPath}`,
    "",
    "Project file tree (preview):",
    fileTreePreview || "- (leer)"
  ].join("\n");

  return [
    {
      id: "active-task-workspace-summary",
      content: summary,
      estimatedTokens: estimateTokensCharHeuristic(summary)
    },
    ...workspaceContext.sampledFiles.map((file, index) => {
      const content = `### ${file.relativePath} (${file.language})\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
      return {
        id: `active-task-workspace-file-${index}`,
        source: file.relativePath,
        dedupeContent: file.content,
        content,
        estimatedTokens: estimateTokensCharHeuristic(content),
        pinned: true
      };
    })
  ];
}

export const PRESET_MESSAGES: Record<"plan" | "refactor" | "review" | "summarize" | "next_steps", string> = {
  plan: "Erstelle einen klaren Implementierungsplan mit konkreten Schritten, Risiken und Tests.",
  refactor: "Schlage einen sicheren Refactor vor (kleine Schritte, Diff-freundlich, mit Validierung).",
  review: "Fuehre ein fokussiertes Code-Review durch: Risiken, Regressionen, fehlende Tests.",
  summarize: "Fasse den aktuellen Stand knapp zusammen: Fortschritt, offene Punkte, naechster Schritt.",
  next_steps: "Gib die naechsten 3 priorisierten Schritte inklusive kurzer Begruendung an."
};

const SIGNIFICANT_TURN_PATTERN = /\b(fehler|error|falsch|nicht funktioniert|bug|failed|exception|korrektur|correct(ed|ion)?|achtung|warnung|warning)\b/i;

export function isSignificantConversationTurn(message: RuntimeChatMessage): boolean {
  if (message.actions && message.actions.length > 0) {
    return true;
  }
  if (message.toolCalls?.some((call) => call.status === "error")) {
    return true;
  }
  return SIGNIFICANT_TURN_PATTERN.test(message.content);
}

export function createMessageId(prefix: string): string {
  return `msg-${Date.now().toString(36)}-${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}

export function appendSystemPatchMessage<TState extends { messages: RuntimeChatMessage[] }>(
  set: (updater: (state: TState) => Partial<TState>) => void,
  content: string,
  actions?: import("@dbzs/shared").ChatActionRequest[]
): string {
  const messageId = createMessageId("patch");
  set((state) => ({
    messages: [
      ...state.messages,
      {
        id: messageId,
        role: "system",
        content,
        actions
      }
    ]
  }) as Partial<TState>);
  return messageId;
}

export function syncRuntimeAgentActions(
  messages: RuntimeChatMessage[],
  planProposalsById: Record<string, AgentPlanProposal>
): { messages: RuntimeChatMessage[]; agentActionsById: Record<string, AgentAction> } {
  return buildRuntimeAgentActionRegistry(messages, { planProposalsById });
}

function validationCommandIds(commands: string[] | undefined): string[] {
  const allowed = new Set(["pnpm_typecheck", "pnpm_test", "npm_run_typecheck", "npm_test"]);
  return [...new Set((commands ?? []).filter((command) => allowed.has(command)))];
}

export async function runPatchValidation(
  workspaceRoot: string,
  proposal: AgentPatchProposal
): Promise<PatchValidationResult | null> {
  const executeSafeCommand = window.dbzs.executeSafeCommand;
  const getSafeCommandRunStatus = window.dbzs.getSafeCommandRunStatus;
  const streamSafeCommandLogs = window.dbzs.streamSafeCommandLogs;
  const commands = validationCommandIds(proposal.validationCommands);
  if (!executeSafeCommand || !getSafeCommandRunStatus || commands.length === 0) {
    return null;
  }

  const results: PatchValidationResult["commands"] = [];
  for (const commandId of commands) {
    let run = await executeSafeCommand(workspaceRoot, commandId);
    while (run.status === "running") {
      await sleep(250);
      run = await getSafeCommandRunStatus(run.runId);
    }

    let stdout = "";
    let stderr = "";
    if (streamSafeCommandLogs) {
      try {
        const logs = await streamSafeCommandLogs(run.runId);
        stdout = logs.stdout ?? "";
        stderr = logs.stderr ?? "";
      } catch {
        // Command status remains the source of truth.
      }
    }
    results.push({
      commandId,
      exitCode: typeof run.exitCode === "number" ? run.exitCode : null,
      stdout,
      stderr
    });
  }

  return {
    proposalId: proposal.id,
    success: results.every((result) => result.exitCode === 0),
    commands: results
  };
}

export async function refreshWorkspaceAfterPatch(workspaceRoot: string, filePaths: string[]): Promise<void> {
  try {
    await Promise.allSettled([
      useWorkspaceStore.getState().scanFiles(),
      useGitStore.getState().refreshGitStatus()
    ]);
  } catch {
    // best effort
  }

  const editor = useEditorStore.getState();
  const tabs = editor?.tabs ?? [];
  for (const filePath of filePaths) {
    try {
      const absolutePath = filePath.includes(":") ? filePath : `${workspaceRoot.replace(/[\\/]+$/, "")}\\${filePath.replace(/\//g, "\\")}`;
      const openTab = tabs.find((tab) => tab.type === "file" && (tab.path === absolutePath || tab.path.endsWith(filePath)));
      if (openTab?.type === "file") {
        await editor.openWorkspaceFile(openTab.path);
      }
    } catch {
      // best effort
    }
  }
}

export function formatChatError(error: unknown): string {
  return formatChatErrorForUser(error);
}

export async function requestAssistantResponse(
  request: Parameters<typeof agentRunService.sendChatStream>[0],
  onDelta: (delta: string, totalLength: number) => void,
  signal?: AbortSignal
) {
  let lastError: unknown = null;
  let retryAttempts = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const streamed = await agentRunService.sendChatStream(request, { onDelta }, signal);
      if (
        (streamed as { safe_fallback?: boolean }).safe_fallback === true ||
        Boolean((streamed as { provider_error?: unknown }).provider_error)
      ) {
        return streamed;
      }
      if (streamed.message.content.trim().length > 0) {
        return streamed;
      }

      const fallback = await agentRunService.sendChat(request, signal);
      if (
        fallback.message.content &&
        !(fallback as { safe_fallback?: boolean }).safe_fallback &&
        !(fallback as { provider_error?: unknown }).provider_error &&
        (await import("@/services/providerRuntimeEvents")).isModelContentDelta(fallback.message.content)
      ) {
        onDelta(fallback.message.content, fallback.message.content.length);
      }
      return fallback;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error;
      const classified = classifyRuntimeChatError(error);
      if (!classified.shouldRetry || retryAttempts >= classified.maxRetries) {
        break;
      }
      retryAttempts += 1;
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Chat-Anfrage konnte nicht ausgefuehrt werden.");
}

export function targetAgentForPreset(preset: "plan" | "refactor" | "review" | "summarize" | "next_steps"): ModelTargetAgent {
  switch (preset) {
    case "plan":
      return "planner";
    case "refactor":
      return "coder";
    case "review":
      return "reviewer";
    case "summarize":
    case "next_steps":
    default:
      return "runtime_chat";
  }
}

export function patchActivityRun(
  run: RuntimeChatActivityRun,
  patch: Partial<RuntimeChatActivityRun>
): RuntimeChatActivityRun {
  return { ...run, ...patch };
}

export function patchActivitySteps(
  run: RuntimeChatActivityRun,
  nextSteps: RuntimeChatActivityStep[]
): RuntimeChatActivityRun {
  return { ...run, steps: nextSteps };
}
