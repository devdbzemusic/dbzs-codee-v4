export interface NoActionRecoverySignal {
  kind: "diff" | "code" | "command" | "file_hint";
  label: string;
  preview: string;
}

export interface NoActionRecoveryAnalysis {
  signals: NoActionRecoverySignal[];
  hasRecoverableOutput: boolean;
  summary: string;
}

const FENCED_BLOCK_PATTERN = /```([a-zA-Z0-9_.+-]*)\s*\n([\s\S]*?)```/g;
const DIFF_LINE_PATTERN = /^(diff --git|---\s+\S+|\+\+\+\s+\S+|@@\s+-\d+)/m;
const COMMAND_LINE_PATTERN = /^\s*(?:pnpm|npm|yarn|bun|python|pytest|uv|git|node|npx)\s+[^\n]{2,}$/m;
const FILE_HINT_PATTERN = /(?:^|\n)\s*(?:Datei|File|Pfad|Path)\s*:\s*`?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]+)`?/i;
const FILE_LABEL_LINE_PATTERN = /^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?`?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]+)`?\s*:?\s*$/;

function trimPreview(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function uniqueSignals(signals: NoActionRecoverySignal[]): NoActionRecoverySignal[] {
  const seen = new Set<string>();
  const result: NoActionRecoverySignal[] = [];
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.label}:${signal.preview}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }
  return result.slice(0, 5);
}

function extractFileHintBeforeBlock(text: string, blockStartIndex: number): string | null {
  const prefix = text.slice(0, blockStartIndex);
  const lines = prefix.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  const match = lastLine?.match(FILE_LABEL_LINE_PATTERN);
  return match?.[1]?.replace(/\\/g, "/") ?? null;
}

export function analyzeNoActionRecoveryOutput(content: string | null | undefined): NoActionRecoveryAnalysis {
  const text = content?.trim() ?? "";
  if (!text) {
    return { signals: [], hasRecoverableOutput: false, summary: "Keine verwertbaren Inhalte erkannt." };
  }

  const signals: NoActionRecoverySignal[] = [];
  for (const match of text.matchAll(FENCED_BLOCK_PATTERN)) {
    const language = (match[1] ?? "").toLowerCase();
    const block = match[2] ?? "";
    if (!block.trim()) continue;
    const inferredPath = extractFileHintBeforeBlock(text, match.index ?? 0);
    if (inferredPath) {
      signals.push({ kind: "file_hint", label: "Dateihinweis", preview: inferredPath });
    }
    if (language === "diff" || language === "patch" || DIFF_LINE_PATTERN.test(block)) {
      signals.push({ kind: "diff", label: "Diff/Patch-Block", preview: trimPreview(block) });
      continue;
    }
    if (["bash", "sh", "shell", "powershell", "ps1", "cmd"].includes(language) || COMMAND_LINE_PATTERN.test(block)) {
      signals.push({ kind: "command", label: "Terminal-Befehl", preview: trimPreview(block) });
      continue;
    }
    signals.push({ kind: "code", label: language ? `Code-Block (${language})` : "Code-Block", preview: trimPreview(block) });
  }

  if (DIFF_LINE_PATTERN.test(text) && !signals.some((signal) => signal.kind === "diff")) {
    signals.push({ kind: "diff", label: "Inline-Diff", preview: trimPreview(text) });
  }

  const commandMatch = text.match(COMMAND_LINE_PATTERN);
  if (commandMatch && !signals.some((signal) => signal.kind === "command")) {
    signals.push({ kind: "command", label: "Inline-Befehl", preview: trimPreview(commandMatch[0] ?? "") });
  }

  const fileHint = text.match(FILE_HINT_PATTERN);
  if (fileHint?.[1]) {
    signals.push({ kind: "file_hint", label: "Dateihinweis", preview: fileHint[1].replace(/\\/g, "/") });
  }

  const unique = uniqueSignals(signals);
  const labels = unique.map((signal) => signal.label).join(", ");
  return {
    signals: unique,
    hasRecoverableOutput: unique.length > 0,
    summary: unique.length > 0 ? `Erkannt: ${labels}.` : "Keine verwertbaren Inhalte erkannt."
  };
}

export function buildNoActionRecoveryPrompt(input: {
  originalUserPrompt?: string | null;
  analysis: NoActionRecoveryAnalysis;
}): string {
  const original = input.originalUserPrompt?.trim();
  const evidence = input.analysis.signals
    .map((signal, index) => `${index + 1}. ${signal.label}: ${signal.preview}`)
    .join("\n");
  return [
    "Die letzte Antwort enthielt verwertbare Hinweise, aber keine ausfuehrbare CODEE-Aktion.",
    original ? `Urspruenglicher Auftrag: ${original}` : null,
    "",
    "Erkannte Hinweise:",
    evidence || "- keine",
    "",
    "Wandle das jetzt in eine sichere CODEE-Aktion um.",
    "Wenn Dateien geaendert werden sollen, nutze einen Patch-/Dateiaenderungs-Vorschlag mit Review.",
    "Wenn nur ein Befehl sinnvoll ist, schlage den Befehl als freigabepflichtige Aktion vor.",
    "Keine automatische Ausfuehrung ohne Nutzerfreigabe."
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
