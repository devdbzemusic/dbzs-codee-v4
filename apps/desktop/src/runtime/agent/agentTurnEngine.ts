import type {
  ModelTargetAgent,
  AgentPatchProposal,
  ProposedChange,
  RuntimeChatMessage,
  RuntimeChatRequest,
  RuntimeChatResponse
} from "@dbzs/shared";
import type { AgentPolicy } from "@/runtime/agent/agentContracts";
import { DEFAULT_AGENT_POLICY } from "@/runtime/agent/agentOrchestrator";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import {
  shouldAutoApplyPatches
} from "@/runtime/agent/agentToolProfile";
import {
  formatToolResultForTurn,
  getNativeToolDefinitions,
  isToolExposed,
  parseAssistantToolCalls,
  parseNativeToolCallsFromMessage,
  resolveToolProtocolMode,
  stripToolCallBlocks
} from "@/runtime/agent/toolProtocolAdapter";
import type { ToolAvailabilityContext } from "@/runtime/tool/toolAvailability";
import {
  createAgentTrajectory,
  finalizeTrajectory,
  recordTrajectoryTurn,
  type AgentTrajectory
} from "@/runtime/observability/agentTrajectory";
import type { ToolName, ToolResult } from "@/runtime/tool/toolContracts";
import {
  parseRuntimeToolEnvelope,
  type ParsedRuntimeToolCall
} from "@/services/runtimeChatToolParser";
import {
  AgentOutputParseError,
  looksLikeAgentChangePayload,
  parseAgentOutputToProposedChanges
} from "@/services/agentOutputParser";
import {
  classifyUserExecutionIntent,
  isToolRequiredExecutionIntent,
  type UserExecutionIntent
} from "@/services/executionIntent";
import {
  EXECUTION_PROTOCOL_REPAIR_HINT,
  type AgentProtocolFailure,
  type AgentTurnTerminalReason
} from "@/services/executionHandoff";
import {
  groundToolCall,
  TOOL_CALL_REJECTED_UNRELATED,
  TOOL_GROUNDING_REPAIR_HINT
} from "@/services/toolCallGrounding";

export interface AgentTurnToolCallEvent {
  turn: number;
  call: ParsedRuntimeToolCall;
  status: "running" | "done" | "error";
  result?: ToolResult;
  durationMs?: number;
}

export interface AgentTurnEngineCallbacks {
  onTurnStart: (turn: number) => void;
  onAssistantDelta: (delta: string, totalLength: number, turn: number) => void;
  onToolCall: (event: AgentTurnToolCallEvent) => void;
  onActivityDetail?: (line: string) => void;
}

export interface AgentTurnEngineParams {
  runId: string;
  goal: string;
  targetAgent: ModelTargetAgent;
  profile: AgentToolProfile;
  workspaceRoot: string;
  toolAvailabilityContext: ToolAvailabilityContext;
  baseMessages: RuntimeChatMessage[];
  policy?: AgentPolicy;
  providerId?: string | null;
  /** When set, overrides intent classification from goal text. */
  executionIntent?: UserExecutionIntent;
  /** Force execution-mode rules (no completed without action). */
  requireToolAction?: boolean;
  requestAssistant: (
    targetAgent: ModelTargetAgent,
    request: RuntimeChatRequest,
    onDelta: (delta: string, totalLength: number) => void,
    signal?: AbortSignal
  ) => Promise<RuntimeChatResponse>;
  runTool: (name: ToolName, input: Record<string, unknown>) => Promise<ToolResult>;
  queuePatches: (changes: ProposedChange[]) => Promise<void>;
  applyPatches: (filePaths: string[]) => Promise<void>;
  proposePatch?: (input: {
    output: unknown;
    turn: number;
    decisionId?: string | null;
  }) => Promise<AgentPatchProposal | null>;
  signal?: AbortSignal;
  callbacks: AgentTurnEngineCallbacks;
  skillAllowedNames?: ToolName[];
}

export interface AgentTurnEngineResult {
  finalContent: string;
  trajectory: AgentTrajectory;
  patchCount: number;
  patchDetected: boolean;
  turnsExecuted: number;
  toolCallsExecuted: number;
  systemMessages: RuntimeChatMessage[];
  lastResponse: RuntimeChatResponse | null;
  terminalReason: AgentTurnTerminalReason;
  protocolFailure?: AgentProtocolFailure;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function redactPreview(raw: string, maxBytes = 1200): string {
  let preview = raw.slice(0, maxBytes);
  preview = preview.replace(/([A-Za-z]:\\[^\s"']+)/g, "[path]");
  preview = preview.replace(/(\/Users\/[^\s"']+|\/home\/[^\s"']+)/g, "[path]");
  preview = preview.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  return preview;
}

interface PatchFromContentResult {
  patchCount: number;
  protocolFailure?: AgentProtocolFailure;
}

async function handlePatchFromContent(
  content: string,
  workspaceRoot: string,
  profile: AgentToolProfile,
  queuePatches: (changes: ProposedChange[]) => Promise<void>,
  applyPatches: (filePaths: string[]) => Promise<void>,
  repairAttempted: boolean
): Promise<PatchFromContentResult> {
  if (!looksLikeAgentChangePayload(content)) {
    return { patchCount: 0 };
  }

  try {
    const proposedChanges = parseAgentOutputToProposedChanges(content, {
      agentId: "runtime-chat",
      workspaceRoot
    });
    if (proposedChanges.length === 0) {
      return { patchCount: 0 };
    }

    await queuePatches(proposedChanges);

    if (shouldAutoApplyPatches(profile)) {
      await applyPatches(proposedChanges.map((change) => change.filePath));
    }

    return { patchCount: proposedChanges.length };
  } catch (error) {
    if (error instanceof AgentOutputParseError) {
      return {
        patchCount: 0,
        protocolFailure: {
          parser: "agentOutputParser",
          rawContentLength: content.length,
          rawPreview: redactPreview(content),
          errorCode: "AGENT_OUTPUT_PARSE_ERROR",
          errorMessage: error.message,
          repairAttempted
        }
      };
    }
    throw error;
  }
}

async function handleApplyPatchTool(
  result: ToolResult,
  profile: AgentToolProfile,
  queuePatches: (changes: ProposedChange[]) => Promise<void>,
  applyPatches: (filePaths: string[]) => Promise<void>
): Promise<boolean> {
  if (result.status !== "ok" || !result.output) {
    return false;
  }

  const output = result.output as { filePath?: string; afterContent?: string };
  if (!output.afterContent || !output.filePath) {
    return false;
  }

  const change: ProposedChange = {
    id: `tool-patch-${createId("patch")}`,
    agentId: "runtime-chat",
    filePath: output.filePath,
    proposedContent: output.afterContent,
    reason: "Runtime tool apply_patch",
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  await queuePatches([change]);

  if (shouldAutoApplyPatches(profile)) {
    await applyPatches([change.filePath]);
  }

  return true;
}

export async function runAgentTurnEngine(params: AgentTurnEngineParams): Promise<AgentTurnEngineResult> {
  const policy = params.policy ?? DEFAULT_AGENT_POLICY;
  const trajectory = createAgentTrajectory(params.runId, params.goal, params.profile);
  const turnMessages: RuntimeChatMessage[] = [...params.baseMessages];
  const systemMessages: RuntimeChatMessage[] = [];
  let turnsExecuted = 0;
  let toolCallsExecuted = 0;
  let patchCount = 0;
  let patchDetected = false;
  let finalContent = "";
  let lastResponse: RuntimeChatResponse | null = null;
  let terminalReason: AgentTurnTerminalReason = "final_answer";
  let protocolFailure: AgentProtocolFailure | undefined;
  let repairAttempted = false;
  let skillPolicyViolated = false;

  const executionIntent =
    params.executionIntent ?? classifyUserExecutionIntent(params.goal);
  const requireToolAction =
    params.requireToolAction === true ||
    isToolRequiredExecutionIntent(executionIntent) ||
    params.targetAgent === "coder" ||
    params.targetAgent === "debugger";

  const protocolMode = resolveToolProtocolMode(params.providerId);

  while (turnsExecuted < policy.maxSteps && toolCallsExecuted < policy.maxToolCalls) {
    if (params.signal?.aborted) {
      finalizeTrajectory(trajectory, "cancelled");
      terminalReason = "cancelled";
      break;
    }

    turnsExecuted += 1;
    params.callbacks.onTurnStart(turnsExecuted);
    params.callbacks.onActivityDetail?.(`Turn ${turnsExecuted}: Modell-Anfrage …`);

    let streamedContent = "";
    const response = await params.requestAssistant(
      params.targetAgent,
      {
        messages: turnMessages,
        temperature: 0.2,
    // Cap completion tokens so prompt + tools + max_tokens fits typical 4k slots
    // (matches request-binding outputReserve for planning-sized turns).
    max_tokens: 1024,
        tools:
          protocolMode === "native"
            ? {
                mode: "native" as const,
                definitions: getNativeToolDefinitions(
                  params.profile,
                  params.toolAvailabilityContext,
                  params.skillAllowedNames
                )
              }
            : undefined
      },
      (delta, totalLength) => {
        streamedContent += delta;
        params.callbacks.onAssistantDelta(delta, totalLength, turnsExecuted);
      },
      params.signal
    );

    lastResponse = response;
    const rawContent = response.message.content || streamedContent;
    finalContent = stripToolCallBlocks(rawContent) || rawContent;

    const toolCalls = [
      ...parseNativeToolCallsFromMessage(response.message as any),
      ...parseAssistantToolCalls(rawContent, 8)
    ];
    const promptEnvelope = protocolMode === "prompt"
      ? parseRuntimeToolEnvelope(rawContent)
      : { kind: "none" as const, calls: [] as const };
    const turnToolRecords: Array<{ name: ToolName; status: string; durationMs: number }> = [];

    if (toolCalls.length === 0) {
      if (promptEnvelope.kind === "invalid") {
        protocolFailure = {
          parser: "runtimeChatToolParser",
          rawContentLength: rawContent.length,
          rawPreview: redactPreview(rawContent),
          errorCode: "INVALID_TOOL_ENVELOPE",
          errorMessage: promptEnvelope.reason,
          repairAttempted
        };
        if (!repairAttempted) {
          repairAttempted = true;
          const repairMsg: RuntimeChatMessage = {
            id: `msg-${Date.now().toString(36)}-repair`,
            role: "system",
            content: EXECUTION_PROTOCOL_REPAIR_HINT
          };
          systemMessages.push(repairMsg);
          turnMessages.push({
            id: `msg-${Date.now().toString(36)}-assistant`,
            role: "assistant",
            content: rawContent
          });
          turnMessages.push(repairMsg);
          recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
          continue;
        }
        recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
        finalizeTrajectory(trajectory, "failed", "invalid_protocol");
        terminalReason = "invalid_protocol";
        break;
      }
      const patchResult = await handlePatchFromContent(
        rawContent,
        params.workspaceRoot,
        params.profile,
        params.queuePatches,
        params.applyPatches,
        repairAttempted
      );
      if (patchResult.patchCount > 0) {
        patchCount += patchResult.patchCount;
        patchDetected = true;
        recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
        finalizeTrajectory(trajectory, "completed");
        terminalReason = "patch_proposed";
        break;
      }

      if (patchResult.protocolFailure) {
        protocolFailure = patchResult.protocolFailure;
        if (!repairAttempted && requireToolAction) {
          repairAttempted = true;
          protocolFailure = { ...protocolFailure, repairAttempted: true };
          const repairMsg: RuntimeChatMessage = {
            id: `msg-${Date.now().toString(36)}-repair`,
            role: "system",
            content: `${EXECUTION_PROTOCOL_REPAIR_HINT}\n\n[Protocol Failure]\n${protocolFailure.errorMessage}`
          };
          systemMessages.push(repairMsg);
          turnMessages.push({ id: `msg-${Date.now().toString(36)}-assistant`, role: "assistant", content: rawContent });
          turnMessages.push(repairMsg);
          recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
          params.callbacks.onActivityDetail?.("Protocol-Repair-Turn …");
          continue;
        }
        recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
        finalizeTrajectory(trajectory, "failed", "invalid_protocol");
        terminalReason = "invalid_protocol";
        break;
      }

      if (requireToolAction && toolCallsExecuted === 0 && patchCount === 0) {
        if (!repairAttempted) {
          repairAttempted = true;
          const repairMsg: RuntimeChatMessage = {
            id: `msg-${Date.now().toString(36)}-repair`,
            role: "system",
            content: EXECUTION_PROTOCOL_REPAIR_HINT
          };
          systemMessages.push(repairMsg);
          turnMessages.push({ id: `msg-${Date.now().toString(36)}-assistant`, role: "assistant", content: rawContent });
          turnMessages.push(repairMsg);
          recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
          params.callbacks.onActivityDetail?.("Execution repair: Tool-Aktion erforderlich …");
          continue;
        }
        recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
        finalizeTrajectory(trajectory, "failed", "execution_no_action");
        terminalReason = "execution_no_action";
        break;
      }

      recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
      finalizeTrajectory(trajectory, "completed");
      terminalReason = toolCallsExecuted > 0 ? "tool_calls_executed" : patchCount > 0 ? "patch_proposed" : "final_answer";
      break;
    }

    // Valid tool calls with empty/non-final text are allowed — continue the loop.
    turnMessages.push({ id: `msg-${Date.now().toString(36)}-turn`, role: "assistant", content: rawContent });

    for (const call of toolCalls) {
      if (params.signal?.aborted) {
        finalizeTrajectory(trajectory, "cancelled");
        terminalReason = "cancelled";
        break;
      }

      if (toolCallsExecuted >= policy.maxToolCalls) {
        finalizeTrajectory(trajectory, "budget_exceeded");
        terminalReason = "budget_exceeded";
        break;
      }

      const exposureCheck = isToolExposed(
        params.profile,
        params.toolAvailabilityContext,
        call.name,
        params.skillAllowedNames
      );
      if (!exposureCheck.allowed) {
        const blocked = `[Tool ${call.name}] ${exposureCheck.reason ?? "blocked"}`;
        systemMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: blocked });
        turnMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: blocked });
        params.callbacks.onToolCall({
          turn: turnsExecuted,
          call,
          status: "error"
        });
        if (params.skillAllowedNames && !params.skillAllowedNames.includes(call.name)) {
          skillPolicyViolated = true;
          terminalReason = "skill_tool_policy_violation";
          finalizeTrajectory(trajectory, "failed");
          break;
        }
        continue;
      }

      const grounding = groundToolCall({
        toolName: call.name,
        toolInput: call.input ?? {},
        goalText: params.goal,
        workspaceRoot: params.workspaceRoot
      });
      if (grounding.rejectionReason) {
        const rejected = `[${TOOL_CALL_REJECTED_UNRELATED}] ${call.name}: ${grounding.rejectionReason}`;
        systemMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: rejected });
        turnMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: rejected });
        if (!repairAttempted) {
          repairAttempted = true;
          const repairMsg: RuntimeChatMessage = {
            id: `msg-${Date.now().toString(36)}-repair`,
            role: "system",
            content: TOOL_GROUNDING_REPAIR_HINT
          };
          systemMessages.push(repairMsg);
          turnMessages.push(repairMsg);
        }
        params.callbacks.onToolCall({
          turn: turnsExecuted,
          call,
          status: "error"
        });
        continue;
      }

      toolCallsExecuted += 1;
      params.callbacks.onToolCall({ turn: turnsExecuted, call, status: "running" });
      params.callbacks.onActivityDetail?.(`Tool ${call.name} …`);

      const started = Date.now();
      let result: ToolResult;
      try {
        result = await params.runTool(call.name, call.input);
      } catch (error) {
        result = {
          toolName: call.name,
          requestId: createId("tool"),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "error",
          output: undefined,
          error: {
            code: "TOOL_EXEC_FAILED",
            message: error instanceof Error ? error.message : "Tool execution failed",
            retryable: false
          }
        };
      }

      const durationMs = Date.now() - started;
      turnToolRecords.push({
        name: call.name,
        status: result.status,
        durationMs
      });

      params.callbacks.onToolCall({
        turn: turnsExecuted,
        call,
        status: result.status === "ok" ? "done" : "error",
        result,
        durationMs
      });

      const formatted = formatToolResultForTurn(call.name, result);
      systemMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: formatted });
      turnMessages.push({ id: `msg-${Date.now().toString(36)}-sys`, role: "system", content: formatted });

      if (call.name === "apply_patch") {
        const applied = await handleApplyPatchTool(
          result,
          params.profile,
          params.queuePatches,
          params.applyPatches
        );
        if (applied) {
          patchDetected = true;
          patchCount += 1;
        }
      }

      if (call.name === "propose_file_changes") {
        const proposal = await params.proposePatch?.({
          output: result.output,
          turn: turnsExecuted
        });
        if (proposal) {
          patchDetected = true;
          patchCount += proposal.changes.length;
        }
      }
    }

    recordTrajectoryTurn(trajectory, turnsExecuted, finalContent.length, turnToolRecords);
    if (skillPolicyViolated) {
      break;
    }
    terminalReason = "tool_calls_executed";

    if (trajectory.status === "cancelled" || trajectory.status === "budget_exceeded") {
      break;
    }
  }

  if (!trajectory.finishedAt) {
    if (turnsExecuted >= policy.maxSteps) {
      finalizeTrajectory(trajectory, "budget_exceeded");
      terminalReason = "budget_exceeded";
    } else if (requireToolAction && toolCallsExecuted === 0 && patchCount === 0) {
      finalizeTrajectory(trajectory, "failed", "execution_no_action");
      terminalReason = "execution_no_action";
    } else {
      finalizeTrajectory(trajectory, "completed");
      if (toolCallsExecuted > 0) {
        terminalReason = "tool_calls_executed";
      } else if (patchCount > 0) {
        terminalReason = "patch_proposed";
      } else {
        terminalReason = "final_answer";
      }
    }
  }

  return {
    finalContent,
    trajectory,
    patchCount,
    patchDetected,
    turnsExecuted,
    toolCallsExecuted,
    systemMessages,
    lastResponse,
    terminalReason,
    protocolFailure
  };
}
