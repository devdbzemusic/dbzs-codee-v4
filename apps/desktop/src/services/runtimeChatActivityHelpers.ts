import type { ModelTargetAgent, RuntimeChatWorkspaceContext, WorkspaceFile } from "@dbzs/shared";
import type {
  RuntimeChatActivityRun,
  RuntimeChatActivityStep,
  RuntimeChatRoutingInfo
} from "@/types/runtimeChatActivity";

export function createActivityRun(userPrompt: string, targetAgent: ModelTargetAgent): RuntimeChatActivityRun {
  return {
    id: createActivityId(),
    startedAt: new Date().toISOString(),
    userPrompt,
    targetAgent,
    steps: []
  };
}

export function createActivityId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `activity-${Date.now().toString(36)}`;
}

export function upsertActivityStep(
  steps: RuntimeChatActivityStep[],
  id: string,
  label: string,
  status: RuntimeChatActivityStep["status"],
  detail = ""
): RuntimeChatActivityStep[] {
  const existing = steps.find((step) => step.id === id);
  if (existing) {
    return steps.map((step) =>
      step.id === id
        ? {
            ...step,
            label,
            status,
            detail: detail || step.detail
          }
        : step
    );
  }

  return [...steps, { id, label, status, detail }];
}

export function appendActivityStepDetail(steps: RuntimeChatActivityStep[], id: string, line: string): RuntimeChatActivityStep[] {
  return steps.map((step) =>
    step.id === id
      ? {
          ...step,
          detail: step.detail ? `${step.detail}\n${line}` : line
        }
      : step
  );
}

export function agentLabel(agent: ModelTargetAgent): string {
  switch (agent) {
    case "planner":
      return "Planner";
    case "coder":
      return "Coder";
    case "reviewer":
      return "Reviewer";
    case "debugger":
      return "Debugger";
    case "runtime_chat":
    default:
      return "Runtime Chat";
  }
}

export function buildResponseAnalysisMessage(input: {
  routing: RuntimeChatRoutingInfo;
  workspaceContext: RuntimeChatWorkspaceContext | null | undefined;
  activeFile: WorkspaceFile | null;
  historyMessageCount: number;
  systemContextCount: number;
  responseLength: number;
  modelId?: string | null;
  modelName?: string | null;
  patchDetected: boolean;
  patchCount: number;
  durationMs: number;
}): string {
  const modelLabel =
    input.modelName ?? input.modelId ?? input.routing.modelName ?? input.routing.modelId ?? "unbekannt";
  const providerLabel = input.routing.providerId ?? "runtime";

  const lines = [
    "[Analyse-Protokoll]",
    `Dauer: ${(input.durationMs / 1000).toFixed(1)}s`,
    `Agent: ${agentLabel(input.routing.targetAgent)}`,
    `Modell: ${modelLabel} (${providerLabel})`,
    `Verlauf: ${input.historyMessageCount} Chat-Nachrichten, ${input.systemContextCount} Kontext-Systemnachrichten`
  ];

  if (input.workspaceContext) {
    lines.push(
      `Workspace: ${input.workspaceContext.name} (${input.workspaceContext.sampledFiles.length} Dateien geladen, ${input.workspaceContext.fileTree.length} im Baum)`
    );
    if (input.workspaceContext.sampledFiles.length > 0) {
      lines.push(
        "Analysierte Dateien:",
        ...input.workspaceContext.sampledFiles.map(
          (file) => `- ${file.relativePath} (${file.language}, ${file.content.length} Zeichen)`
        )
      );
    }
  } else {
    lines.push("Workspace: nicht eingebunden");
  }

  if (input.activeFile) {
    lines.push(
      `Aktive Datei: ${input.activeFile.name} (${input.activeFile.language}, ${input.activeFile.content.length} Zeichen)`
    );
  } else {
    lines.push("Aktive Datei: keine");
  }

  lines.push(`Antwort: ${input.responseLength} Zeichen`);

  if (input.patchDetected) {
    lines.push(`Patch-Erkennung: ${input.patchCount} Vorschlag/Vorschlaege erkannt`);
  } else {
    lines.push("Patch-Erkennung: keine");
  }

  return lines.join("\n");
}
