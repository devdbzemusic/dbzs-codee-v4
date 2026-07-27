import type { AssistantQuestion, ModelTargetAgent, RuntimeChatMessage, RuntimeSlotId } from "@dbzs/shared";
import { workspaceScopeId } from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import { backendClient } from "@/services/backendClient";

const PENDING_QUESTION_PATH = ".codee/pending-question.json";

export interface PendingQuestionState {
  runId: string;
  goal: string;
  targetAgent: ModelTargetAgent;
  profile: AgentToolProfile;
  workspaceRoot: string;
  providerId?: string | null;
  modelId?: string | null;
  slotId?: RuntimeSlotId | null;
  fallbackPolicy?: string;
  decisionId?: string | null;
  fileContext?: unknown;
  systemMessages: RuntimeChatMessage[];
  historyMessages: RuntimeChatMessage[];
  question: AssistantQuestion;
  toolCallRequestId: string;
  askedAt: string;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function joinPath(base: string, segment: string): string {
  const normalizedBase = base.replace(/[\\/]+$/, "");
  return `${normalizedBase}/${segment}`;
}

function isPendingQuestionState(value: unknown): value is PendingQuestionState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const casted = value as Partial<PendingQuestionState>;
  return (
    typeof casted.runId === "string" &&
    typeof casted.goal === "string" &&
    typeof casted.workspaceRoot === "string" &&
    Array.isArray(casted.systemMessages) &&
    Array.isArray(casted.historyMessages) &&
    typeof casted.question === "object" &&
    casted.question !== null &&
    typeof casted.toolCallRequestId === "string"
  );
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function writePendingQuestion(state: PendingQuestionState): Promise<void> {
  const writeProjectFile = backendClient.writeProjectFile;
  if (!writeProjectFile) {
    return;
  }
  const path = joinPath(normalizePath(state.workspaceRoot), PENDING_QUESTION_PATH);
  await writeProjectFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

export async function readPendingQuestion(workspaceRoot: string): Promise<PendingQuestionState | null> {
  const readProjectFile = backendClient.readProjectFile;
  if (!readProjectFile) {
    return null;
  }
  const path = joinPath(normalizePath(workspaceRoot), PENDING_QUESTION_PATH);
  try {
    const existing = await readProjectFile(path);
    if (!existing?.content) {
      return null;
    }
    const parsed = safeJsonParse(existing.content);
    if (!isPendingQuestionState(parsed)) {
      return null;
    }
    return workspaceScopeId(parsed.workspaceRoot) === workspaceScopeId(workspaceRoot) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearPendingQuestion(workspaceRoot: string): Promise<void> {
  const writeProjectFile = backendClient.writeProjectFile;
  if (!writeProjectFile) {
    return;
  }
  const path = joinPath(normalizePath(workspaceRoot), PENDING_QUESTION_PATH);
  await writeProjectFile(path, "null\n");
}
