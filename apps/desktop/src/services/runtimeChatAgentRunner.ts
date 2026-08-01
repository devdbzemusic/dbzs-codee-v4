import type {
  AgentPatchProposal,
  AssistantAnswer,
  AssistantQuestion,
  ChatActionRequest,
  ModelTargetAgent,
  RuntimeChatMessage,
  RuntimeChatRequest,
  RuntimeChatResponse,
  RuntimeSlotId,
  RuntimeChatToolCallRecord,
  AgentWebSearchRequest,
  AgentWebFetchRequest,
  AgentWebDocument,
  AgentCitation,
  ToolOutputLayers
} from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import { storeFullToolLog } from "@/services/toolOutputLogStore";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import { upsertRuntimeActorPolicyForProfile } from "@/runtime/agent/agentProfilePolicy";
import { runAgentTurnEngine, type AgentTurnToolCallEvent } from "@/runtime/agent/agentTurnEngine";
import {
  buildToolSystemMessages,
  resolveToolProtocolMode
} from "@/runtime/agent/toolProtocolAdapter";
import { resolveToolExposure } from "@/runtime/tool/toolDisclosure";
import type { AgentTrajectory } from "@/runtime/observability/agentTrajectory";
import { AskUserInputSchema } from "@/runtime/tool/toolContracts";
import type { ToolName, ToolResult } from "@/runtime/tool/toolContracts";
import { buildToolAvailabilityContext } from "@/services/toolAvailabilityService";
import { messagesAlreadyIncludeToolCatalog } from "@/services/providerToolBudget";
import { buildRuntimeToolRequest, getRuntimeKernel } from "@/services/runtimeKernelService";
import { approvalCoordinator } from "@/services/approvalCoordinator";
import { questionCoordinator } from "@/services/questionCoordinator";
import { appendRunEvent, updateRunStatus } from "@/services/runtimeChatRunHelpers";
import { clearPendingQuestion, writePendingQuestion } from "@/services/pendingQuestionPersistence";
import { useEditorStore } from "@/stores/editorStore";
import { useRuntimeAgentStore } from "@/stores/runtimeAgentStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ActiveSkillRuntimeContext } from "@/runtime/skill/skillContracts";
import {
  classifyUserExecutionIntent,
  requiresWorkspaceInspectionToolAction
} from "@/services/executionIntent";

export interface AgentChatRunnerParams {
  runId: string;
  goal: string;
  targetAgent: ModelTargetAgent;
  profile: AgentToolProfile;
  workspaceRoot: string;
  systemMessages: RuntimeChatMessage[];
  historyMessages: RuntimeChatMessage[];
  providerId?: string | null;
  modelId?: string | null;
  slotId?: RuntimeSlotId | null;
  fallbackPolicy?: RuntimeChatRequest["fallback_policy"];
  decisionId?: string | null;
  fileContext?: RuntimeChatRequest["file_context"];
  signal?: AbortSignal;
  requestAssistant: (
    request: RuntimeChatRequest,
    onDelta: (delta: string, totalLength: number) => void,
    signal?: AbortSignal
  ) => Promise<RuntimeChatResponse>;
  onStreamUpdate: (content: string, turn: number, toolCalls: RuntimeChatToolCallRecord[]) => void;
  onPatchProposal?: (proposal: AgentPatchProposal) => Promise<void>;
  onTurnStart: (turn: number) => void;
  onActivityDetail?: (line: string) => void;
  activeSkill?: ActiveSkillRuntimeContext;
  /** Zusätzliche Host-Policy, z. B. das kleine Remediation-Toolset je Phase. */
  allowedToolNames?: ToolName[];
}

export interface AgentChatRunnerResult {
  finalContent: string;
  trajectory: AgentTrajectory;
  patchCount: number;
  patchDetected: boolean;
  systemMessages: RuntimeChatMessage[];
  lastResponse: RuntimeChatResponse | null;
  assistantMessage: RuntimeChatMessage;
  turnsExecuted: number;
  toolCallsExecuted: number;
  terminalReason?: import("@/services/executionHandoff").AgentTurnTerminalReason;
  protocolFailure?: import("@/services/executionHandoff").AgentProtocolFailure;
}

function createToolCallId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tc-${crypto.randomUUID()}`;
  }
  return `tc-${Date.now().toString(36)}`;
}

const AGENT_CONTEXT_MAX_CHARS = 4000;
const ERROR_LINE_PATTERN = /error|exception|traceback|fail(ed|ure)?/i;

/**
 * Keeps lines matching ERROR_LINE_PATTERN plus one line of surrounding
 * context, so the model's own repair loop sees the actual failure instead of
 * an arbitrary character cutoff that might land mid-stack-trace. Falls back
 * to a plain (longer than displaySummary) slice when no error lines match.
 */
function buildAgentContext(fullText: string): string {
  const lines = fullText.split("\n");
  const errorLineIndices = new Set<number>();
  lines.forEach((line, index) => {
    if (ERROR_LINE_PATTERN.test(line)) {
      errorLineIndices.add(index);
      if (index > 0) errorLineIndices.add(index - 1);
      if (index < lines.length - 1) errorLineIndices.add(index + 1);
    }
  });

  if (errorLineIndices.size === 0) {
    return fullText.slice(0, AGENT_CONTEXT_MAX_CHARS);
  }

  const kept = Array.from(errorLineIndices)
    .sort((a, b) => a - b)
    .map((index) => lines[index]);
  return kept.join("\n").slice(0, AGENT_CONTEXT_MAX_CHARS);
}

function rawToolOutputText(name: string, output: unknown): string {
  if (name === "run_terminal_command" && output && typeof output === "object") {
    const term = output as { stdout?: string; stderr?: string };
    return [term.stdout, term.stderr].filter(Boolean).join("\n");
  }
  if (name === "run_tests" && output && typeof output === "object") {
    const test = output as { summary?: string; exitCode?: number; stdout?: string; stderr?: string };
    return [test.summary, test.stdout, test.stderr].filter(Boolean).join("\n") || `exit ${test.exitCode ?? "?"}`;
  }
  if (name === "web_fetch" && output && typeof output === "object") {
    const doc = output as { url?: string; text?: string };
    return doc.text ?? "";
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output ?? "");
  }
}

function displaySummaryFor(name: string, result: AgentTurnToolCallEvent["result"]): string {
  if (!result) {
    return "";
  }
  if (result.status !== "ok") {
    return result.error?.message ?? "Fehler";
  }
  const output = result.output;
  if (name === "run_terminal_command" && output && typeof output === "object") {
    const term = output as { stdout?: string; stderr?: string };
    return [term.stdout, term.stderr].filter(Boolean).join("\n").slice(0, 500);
  }
  if (name === "run_tests" && output && typeof output === "object") {
    const test = output as { summary?: string; exitCode?: number; stdout?: string; stderr?: string };
    return (
      test.summary ??
      [test.stdout, test.stderr].filter(Boolean).join("\n").slice(0, 400) ??
      `exit ${test.exitCode ?? "?"}`
    );
  }
  if (name === "apply_patch" && output && typeof output === "object") {
    const patch = output as { filePath?: string };
    return patch.filePath ?? "";
  }
  if (name === "web_search" && output && typeof output === "object") {
    const search = output as { items?: Array<{ title?: string; url?: string }> };
    return `Web search found ${(search.items ?? []).length} results.`;
  }
  if (name === "web_fetch" && output && typeof output === "object") {
    const doc = output as { url?: string; text?: string };
    return `Fetched URL: ${doc.url ?? ""}. Size: ${doc.text?.length ?? 0} chars.`;
  }
  try {
    return JSON.stringify(output).slice(0, 400);
  } catch {
    return "ok";
  }
}

/**
 * Three-tier tool output: displaySummary (UI, ~300-500 chars) vs agentContext
 * (kept for the model's own repair-loop reasoning — actual error lines, not
 * an arbitrary cutoff) vs fullLogRef (a reference; only the reference goes
 * into the prompt, never the full untruncated text).
 */
export function summarizeToolOutput(name: string, result: AgentTurnToolCallEvent["result"]): ToolOutputLayers {
  const displaySummary = displaySummaryFor(name, result);
  if (!result || result.status !== "ok") {
    return { displaySummary, agentContext: displaySummary };
  }

  const fullText = rawToolOutputText(name, result.output);
  if (!fullText) {
    return { displaySummary, agentContext: displaySummary };
  }

  const agentContext = buildAgentContext(fullText);
  const fullLogRef = fullText.length > AGENT_CONTEXT_MAX_CHARS ? storeFullToolLog(fullText) : undefined;
  return { displaySummary, agentContext, fullLogRef };
}

function createApprovalRequestId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function waitForApprovalDecision(requestId: string, signal?: AbortSignal): Promise<boolean> {
  const resolution = await approvalCoordinator.waitForResolution(requestId, signal);
  return resolution.status === "approved";
}

export async function runAgentChatTurnLoop(params: AgentChatRunnerParams): Promise<AgentChatRunnerResult> {
  const protocolMode = resolveToolProtocolMode(params.providerId);
  const toolAvailabilityContext = buildToolAvailabilityContext(params.workspaceRoot);
  const skillAllowedNames = params.allowedToolNames ?? params.activeSkill?.effectiveAllowedTools;
  const toolExposure = resolveToolExposure(params.profile, toolAvailabilityContext, skillAllowedNames);
  const executionIntent = classifyUserExecutionIntent(params.goal);
  const workspaceInspectionRequiresTool = requiresWorkspaceInspectionToolAction(params.goal, executionIntent);
  // Tool catalog must already be frozen into systemMessages by the budget/binding path.
  // Only inject here when missing (legacy callers / tests).
  const toolSystemMessages = messagesAlreadyIncludeToolCatalog(params.systemMessages)
    ? []
    : buildToolSystemMessages(params.profile, protocolMode, toolAvailabilityContext, skillAllowedNames);

  const baseMessages: RuntimeChatMessage[] = [
    ...params.systemMessages,
    ...toolSystemMessages,
    ...params.historyMessages
  ];

  const toolCallMap = new Map<string, RuntimeChatToolCallRecord>();
  let streamedContent = "";

  upsertRuntimeActorPolicyForProfile("runtime-chat", params.profile, skillAllowedNames);

  const bridgeContext = {
    deferrableNames: toolExposure.deferrableNames,
    profile: params.profile,
    availabilityContext: toolAvailabilityContext,
    skillRunId: params.activeSkill?.run.id,
    skillAllowedNames
  };

  const engineResult = await runAgentTurnEngine({
    runId: params.runId,
    goal: params.goal,
    targetAgent: params.targetAgent,
    profile: params.profile,
    workspaceRoot: params.workspaceRoot,
    toolAvailabilityContext,
    skillAllowedNames,
    baseMessages,
    providerId: params.providerId,
    requireToolAction:
      params.targetAgent === "coder" ||
      params.targetAgent === "debugger" ||
      workspaceInspectionRequiresTool,
    executionIntent,
    signal: params.signal,
    requestAssistant: (agent, request, onDelta, signal) => {
      // P1 Requirement 11: Agentenloop uses same broker decision (model_id, slot_id, fallback_policy)
      // from runtimeChatStore. Do not create new routing decision.
      return params.requestAssistant(
        {
          ...request,
          file_context: params.fileContext,
          model_id: params.modelId ?? request.model_id,
          slot_id: params.slotId ?? request.slot_id,
          fallback_policy: params.fallbackPolicy ?? request.fallback_policy,
          tools: request.tools
        },
        onDelta,
        signal
      );
    },
    runTool: async (name: ToolName, input: Record<string, unknown>) => {
      const chatStore = useRuntimeChatStore.getState();

      if (name === "write_skill_artifact") {
        const activeSkill = params.activeSkill;
        if (!activeSkill || String(input.skillRunId ?? "") !== activeSkill.run.id) {
          throw new Error("[SKILL_TOOL_POLICY_VIOLATION] No matching active skill run.");
        }
        if (!activeSkill.run.artifactWriteApproved) {
          const approved =
            process.env.NODE_ENV === "test" ||
            window.confirm(
              `Skill „${activeSkill.run.skillId}“ darf für diesen Run ausschließlich Dateien unter ` +
              `.codee/skill-runs/${activeSkill.run.id}/artifacts/ schreiben. Zulassen?`
            );
          if (!approved) {
            throw new Error("[SKILL_ARTIFACT_APPROVAL_REJECTED] Artifact write was rejected.");
          }
          const updated = await window.dbzs.approveSkillRunArtifacts?.(
            params.workspaceRoot,
            activeSkill.run.id
          );
          if (!updated) throw new Error("[SKILL_ARTIFACT_APPROVAL_FAILED] Approval could not be stored.");
          activeSkill.run = updated;
        }
      }

      if (name === "web_search") {
        const searchRequest: AgentWebSearchRequest = {
          id: self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7),
          runId: params.runId,
          query: String(input.query ?? ""),
          purpose: String(input.purpose ?? ""),
          maxResults: Number(input.maxResults ?? 5),
          recencyDays: input.recencyDays ? Number(input.recencyDays) : undefined,
          allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains as string[] : undefined,
          safeSearch: (input.safeSearch as any) ?? "strict",
          language: input.language ? String(input.language) : undefined,
          createdAt: new Date().toISOString()
        };

        const mode = chatStore.webResearchApprovalMode;
        if ((mode === "ask_every_request" || (mode === "ask_once_per_run" && !chatStore.webResearchApprovedForRun)) && process.env.NODE_ENV !== "test") {
          const runId = params.runId;
          const messageId = `msg-${Date.now().toString(36)}-web-${Math.random().toString(36).substring(2, 6)}`;
          const approvalRequestId = createApprovalRequestId("web-search");
          
          const approveAction: import("@dbzs/shared").ChatActionRequest = {
            id: `act-${Math.random().toString(36).substring(2, 10)}`,
            runId,
            messageId,
            workspaceRoot: params.workspaceRoot,
            workspaceId: workspaceScopeId(params.workspaceRoot),
            kind: "approve_web_access",
            title: "Websuche erlauben",
            riskLevel: "medium",
            payload: { query: searchRequest.query, approvalRequestId },
            state: "pending",
            createdAt: new Date().toISOString()
          };
          const rejectAction: import("@dbzs/shared").ChatActionRequest = {
            id: `act-${Math.random().toString(36).substring(2, 10)}`,
            runId,
            messageId,
            workspaceRoot: params.workspaceRoot,
            workspaceId: workspaceScopeId(params.workspaceRoot),
            kind: "reject_web_access",
            title: "Ablehnen",
            riskLevel: "low",
            payload: { query: searchRequest.query, approvalRequestId },
            state: "pending",
            createdAt: new Date().toISOString()
          };

          approvalCoordinator.register(approvalRequestId);

          useRuntimeChatStore.setState((state) => ({
            webResearchStatus: "idle",
            messages: [
              ...state.messages,
              {
                id: messageId,
                role: "system",
                content: `Zustimmung für Websuche erforderlich: "${searchRequest.query}" (Zweck: ${searchRequest.purpose})`,
                actions: [approveAction, rejectAction]
              }
            ]
          }));

          const approved = await waitForApprovalDecision(approvalRequestId, params.signal);
          if (!approved) {
            throw new Error("[RESEARCH_APPROVAL_REJECTED] Web search was rejected by user.");
          }
        }

        useRuntimeChatStore.setState({
          activeWebSearches: [...useRuntimeChatStore.getState().activeWebSearches, searchRequest],
          webResearchStatus: "searching",
          webResearchError: null
        });

        try {
          const res = await useRuntimeAgentStore.getState().runTool(
            buildRuntimeToolRequest(name, params.workspaceRoot, input, "runtime-chat", bridgeContext)
          );
          if (res.status === "ok" && res.output) {
            useRuntimeChatStore.setState({
              webResearchStatus: "succeeded",
              activeWebSearches: useRuntimeChatStore.getState().activeWebSearches.filter(s => s.id !== searchRequest.id)
            });
          } else {
            useRuntimeChatStore.setState({
              webResearchStatus: "failed",
              webResearchError: res.error?.message ?? "Search failed",
              activeWebSearches: useRuntimeChatStore.getState().activeWebSearches.filter(s => s.id !== searchRequest.id)
            });
          }
          return res;
        } catch (err) {
          useRuntimeChatStore.setState({
            webResearchStatus: "failed",
            webResearchError: err instanceof Error ? err.message : String(err),
            activeWebSearches: useRuntimeChatStore.getState().activeWebSearches.filter(s => s.id !== searchRequest.id)
          });
          throw err;
        }
      }

      if (name === "web_fetch") {
        const fetchRequest: AgentWebFetchRequest = {
          id: self.crypto.randomUUID ? self.crypto.randomUUID() : Math.random().toString(36).substring(7),
          runId: params.runId,
          url: String(input.url ?? ""),
          purpose: String(input.purpose ?? ""),
          maxBytes: input.maxBytes ? Number(input.maxBytes) : undefined,
          timeoutMs: input.timeoutMs ? Number(input.timeoutMs) : undefined,
          createdAt: new Date().toISOString()
        };

        const mode = chatStore.webResearchApprovalMode;
        if ((mode === "ask_every_request" || (mode === "ask_once_per_run" && !chatStore.webResearchApprovedForRun)) && process.env.NODE_ENV !== "test") {
          const runId = params.runId;
          const messageId = `msg-${Date.now().toString(36)}-web-${Math.random().toString(36).substring(2, 6)}`;
          const approvalRequestId = createApprovalRequestId("web-fetch");
          
          const approveAction: import("@dbzs/shared").ChatActionRequest = {
            id: `act-${Math.random().toString(36).substring(2, 10)}`,
            runId,
            messageId,
            workspaceRoot: params.workspaceRoot,
            workspaceId: workspaceScopeId(params.workspaceRoot),
            kind: "approve_web_access",
            title: "Websuche erlauben",
            riskLevel: "medium",
            payload: { url: fetchRequest.url, approvalRequestId },
            state: "pending",
            createdAt: new Date().toISOString()
          };
          const rejectAction: import("@dbzs/shared").ChatActionRequest = {
            id: `act-${Math.random().toString(36).substring(2, 10)}`,
            runId,
            messageId,
            workspaceRoot: params.workspaceRoot,
            workspaceId: workspaceScopeId(params.workspaceRoot),
            kind: "reject_web_access",
            title: "Ablehnen",
            riskLevel: "low",
            payload: { url: fetchRequest.url, approvalRequestId },
            state: "pending",
            createdAt: new Date().toISOString()
          };

          approvalCoordinator.register(approvalRequestId);

          useRuntimeChatStore.setState((state) => ({
            webResearchStatus: "idle",
            messages: [
              ...state.messages,
              {
                id: messageId,
                role: "system",
                content: `Zustimmung für Web-Fetch erforderlich: ${fetchRequest.url} (Zweck: ${fetchRequest.purpose})`,
                actions: [approveAction, rejectAction]
              }
            ]
          }));

          const approved = await waitForApprovalDecision(approvalRequestId, params.signal);
          if (!approved) {
            throw new Error("[RESEARCH_APPROVAL_REJECTED] Web fetch was rejected by user.");
          }
        }

        useRuntimeChatStore.setState({
          activeWebFetches: [...useRuntimeChatStore.getState().activeWebFetches, fetchRequest],
          webResearchStatus: "fetching",
          webResearchError: null
        });

        try {
          const res = await useRuntimeAgentStore.getState().runTool(
            buildRuntimeToolRequest(name, params.workspaceRoot, input, "runtime-chat", bridgeContext)
          );
          if (res.status === "ok" && res.output) {
            const doc = res.output as AgentWebDocument;
            const newCitation: AgentCitation = {
              id: `C${useRuntimeChatStore.getState().webResearchCitations.length + 1}`,
              sourceUrl: doc.url,
              sourceTitle: doc.title,
              sourceDomain: doc.sourceDomain,
              retrievedAt: new Date().toISOString()
            };
            (res.output as any).citation_id = newCitation.id;

            useRuntimeChatStore.setState({
              webResearchStatus: "succeeded",
              webResearchCitations: [...useRuntimeChatStore.getState().webResearchCitations, newCitation],
              activeWebFetches: useRuntimeChatStore.getState().activeWebFetches.filter(f => f.id !== fetchRequest.id)
            });
          } else {
            useRuntimeChatStore.setState({
              webResearchStatus: "failed",
              webResearchError: res.error?.message ?? "Fetch failed",
              activeWebFetches: useRuntimeChatStore.getState().activeWebFetches.filter(f => f.id !== fetchRequest.id)
            });
          }
          return res;
        } catch (err) {
          useRuntimeChatStore.setState({
            webResearchStatus: "failed",
            webResearchError: err instanceof Error ? err.message : String(err),
            activeWebFetches: useRuntimeChatStore.getState().activeWebFetches.filter(f => f.id !== fetchRequest.id)
          });
          throw err;
        }
      }

      if (name === "run_command") {
        const commandId = String(input.commandId ?? "");
        const settings = useSettingsStore.getState().settings;
        if (settings.safeCommandConfirmation && process.env.NODE_ENV !== "test") {
          const runId = params.runId;
          const messageId = `msg-${Date.now().toString(36)}-cmd-${Math.random().toString(36).substring(2, 6)}`;
          const approvalRequestId = createApprovalRequestId("command");
          
          const approveAction: import("@dbzs/shared").ChatActionRequest = {
            id: `act-${Math.random().toString(36).substring(2, 10)}`,
            runId,
            messageId,
            workspaceRoot: params.workspaceRoot,
            workspaceId: workspaceScopeId(params.workspaceRoot),
            kind: "approve_command",
            title: "Ausführen",
            riskLevel: "medium",
            payload: { commandId, approvalRequestId },
            state: "pending",
            createdAt: new Date().toISOString()
          };
          const rejectAction: import("@dbzs/shared").ChatActionRequest = {
            id: `act-${Math.random().toString(36).substring(2, 10)}`,
            runId,
            messageId,
            workspaceRoot: params.workspaceRoot,
            workspaceId: workspaceScopeId(params.workspaceRoot),
            kind: "reject_command",
            title: "Ablehnen",
            riskLevel: "low",
            payload: { commandId, approvalRequestId },
            state: "pending",
            createdAt: new Date().toISOString()
          };

          approvalCoordinator.register(approvalRequestId);

          useRuntimeChatStore.setState((state) => ({
            messages: [
              ...state.messages,
              {
                id: messageId,
                role: "system",
                content: `Freigabe für Terminalbefehl erforderlich: \`${commandId}\``,
                actions: [approveAction, rejectAction]
              }
            ]
          }));

          const approved = await waitForApprovalDecision(approvalRequestId, params.signal);
          if (!approved) {
            throw new Error("[COMMAND_APPROVAL_REJECTED] Terminal command was rejected by user.");
          }
        }
      }

      if (name === "ask_user") {
        const parsed = AskUserInputSchema.parse(input);
        const runId = params.runId;
        const requestId = createApprovalRequestId("ask-user");
        const messageId = `msg-${Date.now().toString(36)}-ask-${Math.random().toString(36).substring(2, 6)}`;
        const startedAt = new Date().toISOString();

        const question: AssistantQuestion = {
          id: requestId,
          questionType: parsed.questionType,
          prompt: parsed.prompt,
          context: parsed.context,
          options: parsed.options,
          allowFreeText: parsed.allowFreeText,
          riskLevel: parsed.riskLevel,
          toolCallId: requestId
        };

        const action: ChatActionRequest = {
          id: `act-${Math.random().toString(36).substring(2, 10)}`,
          runId,
          messageId,
          workspaceRoot: params.workspaceRoot,
          workspaceId: workspaceScopeId(params.workspaceRoot),
          kind: "answer_question",
          title: parsed.prompt,
          description: parsed.context,
          riskLevel: parsed.riskLevel,
          payload: { question, requestId },
          state: "pending",
          createdAt: startedAt
        };

        questionCoordinator.register(requestId);

        useRuntimeChatStore.setState((state) => ({
          messages: [
            ...state.messages,
            {
              id: messageId,
              role: "system",
              content: parsed.prompt,
              actions: [action]
            }
          ],
          activeRun: state.activeRun
            ? appendRunEvent(
                updateRunStatus(state.activeRun, "waiting_for_user_answer"),
                "chat.question_asked",
                parsed.prompt
              )
            : state.activeRun
        }));

        await writePendingQuestion({
          runId,
          goal: params.goal,
          targetAgent: params.targetAgent,
          profile: params.profile,
          workspaceRoot: params.workspaceRoot,
          providerId: params.providerId,
          modelId: params.modelId,
          slotId: params.slotId,
          fallbackPolicy: params.fallbackPolicy,
          decisionId: params.decisionId,
          fileContext: params.fileContext,
          systemMessages: params.systemMessages,
          historyMessages: params.historyMessages,
          question,
          toolCallRequestId: requestId,
          askedAt: startedAt
        });

        try {
          const answer = await questionCoordinator.waitForAnswer(requestId, params.signal);

          useRuntimeChatStore.setState((state) => ({
            activeRun: state.activeRun
              ? appendRunEvent(
                  updateRunStatus(state.activeRun, "running_tools"),
                  "chat.answer_received",
                  answer.freeText ?? answer.optionIds?.join(", ") ?? (answer.skipped ? "(übersprungen)" : "")
                )
              : state.activeRun
          }));

          const result: ToolResult<{ answer: AssistantAnswer }> = {
            requestId,
            toolName: "ask_user",
            status: "ok",
            startedAt,
            finishedAt: new Date().toISOString(),
            output: { answer }
          };
          return result;
        } finally {
          await clearPendingQuestion(params.workspaceRoot).catch(() => {});
        }
      }

      const toolResult = await useRuntimeAgentStore.getState().runTool(
        buildRuntimeToolRequest(name, params.workspaceRoot, input, "runtime-chat", bridgeContext)
      );
      if (params.activeSkill) {
        params.activeSkill.run.metrics.skill_tool_call_count += 1;
        if (name === "write_skill_artifact" && toolResult.status === "ok") {
          params.activeSkill.run.metrics.skill_artifact_count += 1;
          params.activeSkill.run.events.push({
            type: "skill.artifact.created",
            timestamp: new Date().toISOString(),
            detail: String(input.relativePath ?? "")
          });
          await getRuntimeKernel().events.emit("skill-runtime", "skill.artifact.created", {
            skillRunId: params.activeSkill.run.id,
            skillId: params.activeSkill.run.skillId,
            relativePath: String(input.relativePath ?? "")
          });
        }
      }
      return toolResult;
    },
    proposePatch: async (input) => {
      if (!params.onPatchProposal) {
        return null;
      }
      const { normalizeProposeFileChangesToolOutput } = await import("@/services/runtimeChatPatchProposal");
      const proposal = normalizeProposeFileChangesToolOutput({
        output: input.output,
        runId: params.runId,
        decisionId: params.decisionId,
        workspaceRoot: params.workspaceRoot
      });
      await params.onPatchProposal(proposal);
      return proposal;
    },
    queuePatches: async (changes) => {
      await useEditorStore.getState().queueProposedChanges(changes);
    },
    applyPatches: async (filePaths) => {
      for (const filePath of filePaths) {
        await useEditorStore.getState().applyPendingChange(filePath);
      }
    },
    callbacks: {
      onTurnStart: (turn) => {
        streamedContent = "";
        params.onTurnStart(turn);
      },
      onAssistantDelta: (delta, _totalLength, turn) => {
        streamedContent += delta;
        params.onStreamUpdate(streamedContent, turn, Array.from(toolCallMap.values()));
      },
      onToolCall: (event) => {
        const key = `${event.turn}:${event.call.name}:${JSON.stringify(event.call.input)}`;
        const id = toolCallMap.has(key) ? toolCallMap.get(key)!.id : createToolCallId();
        const outputLayers = summarizeToolOutput(event.call.name, event.result);
        toolCallMap.set(key, {
          id,
          name: event.call.name,
          status: event.status,
          input: event.call.input,
          durationMs: event.durationMs,
          outputSummary: outputLayers.displaySummary,
          agentContext: outputLayers.agentContext,
          fullLogRef: outputLayers.fullLogRef,
          filePath:
            typeof event.call.input.path === "string"
              ? event.call.input.path
              : typeof event.call.input.filePath === "string"
                ? event.call.input.filePath
                : undefined,
          diffPreview:
            event.result?.output && typeof event.result.output === "object"
              ? ((event.result.output as { diff?: string }).diff?.slice(0, 200) ?? undefined)
              : undefined
        });
        params.onStreamUpdate(streamedContent, event.turn, Array.from(toolCallMap.values()));
      },
      onActivityDetail: params.onActivityDetail
    }
  });

  const assistantMessage: RuntimeChatMessage = {
    id: `msg-${Date.now().toString(36)}-runner`,
    role: "assistant",
    content: engineResult.finalContent,
    toolCalls: [...toolCallMap.values()],
    meta: { type: "trajectory", trajectoryRunId: params.runId }
  };

  return {
    finalContent: engineResult.finalContent,
    trajectory: engineResult.trajectory,
    patchCount: engineResult.patchCount,
    patchDetected: engineResult.patchDetected,
    systemMessages: engineResult.systemMessages,
    lastResponse: engineResult.lastResponse,
    assistantMessage,
    turnsExecuted: engineResult.turnsExecuted,
    toolCallsExecuted: engineResult.toolCallsExecuted,
    terminalReason: engineResult.terminalReason,
    protocolFailure: engineResult.protocolFailure
  };
}




