import type { ToolName } from "@/runtime/tool/toolContracts";
import { ToolNameSchema } from "@/runtime/tool/toolContracts";

export interface ParsedRuntimeToolCall {
  name: ToolName;
  input: Record<string, unknown>;
}

export type RuntimeToolEnvelopeParseResult =
  | { kind: "none"; calls: [] }
  | { kind: "valid"; calls: ParsedRuntimeToolCall[] }
  | { kind: "invalid"; calls: []; reason: string };

const OPEN = "<CODEE_TOOL_CALL>";
const CLOSE = "</CODEE_TOOL_CALL>";
const ENVELOPE = /<CODEE_TOOL_CALL>\s*([\s\S]*?)\s*<\/CODEE_TOOL_CALL>/g;

function parsePayload(raw: string): ParsedRuntimeToolCall | null {
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; arguments?: unknown };
    if (
      Object.keys(parsed).some((key) => key !== "name" && key !== "arguments") ||
      !parsed.arguments ||
      typeof parsed.arguments !== "object" ||
      Array.isArray(parsed.arguments)
    ) {
      return null;
    }
    const name = ToolNameSchema.safeParse(parsed.name);
    return name.success
      ? { name: name.data, input: parsed.arguments as Record<string, unknown> }
      : null;
  } catch {
    return null;
  }
}

export function parseRuntimeToolEnvelope(content: string): RuntimeToolEnvelopeParseResult {
  const hasMarker = content.includes(OPEN) || content.includes(CLOSE);
  if (!hasMarker) return { kind: "none", calls: [] };

  const matches = [...content.matchAll(ENVELOPE)];
  if (matches.length === 0) {
    return { kind: "invalid", calls: [], reason: "unclosed_or_mismatched_envelope" };
  }
  // Prompt mode is intentionally unambiguous: envelopes may follow each other,
  // but explanatory prose or Markdown around them is never executable.
  const remainder = content.replace(ENVELOPE, "").trim();
  if (remainder) {
    return { kind: "invalid", calls: [], reason: "text_outside_envelope" };
  }
  const calls = matches.map((match) => parsePayload(match[1] ?? ""));
  if (calls.some((call) => call === null)) {
    return { kind: "invalid", calls: [], reason: "invalid_envelope_payload" };
  }
  return { kind: "valid", calls: calls as ParsedRuntimeToolCall[] };
}

export function parseRuntimeToolCallsFromAssistant(content: string): ParsedRuntimeToolCall[] {
  const result = parseRuntimeToolEnvelope(content);
  return result.kind === "valid" ? result.calls.slice(0, 12) : [];
}

export const RUNTIME_TOOLS_SYSTEM_HINT = [
  "[Runtime Tools]",
  "Nutze Tools direkt. Ein Prompt-Toolaufruf ist ausschließlich dieses exakte Envelope ohne Markdown oder Begleittext:",
  "<CODEE_TOOL_CALL>",
  '{"name":"read_file","arguments":{"path":"package.json"}}',
  "</CODEE_TOOL_CALL>",
  "JSON in Markdown, Inline-JSON und Tool-Anleitungen sind keine Toolaufrufe.",
  "",
  "[Execution Policy — Execute, Don't Instruct]",
  "Bei Implementierung, Fix, Refactoring, Test oder Build: Werkzeuge selbst verwenden.",
  "Wenn Ausführung blockiert ist, den konkreten Blocker nennen."
].join("\n");
