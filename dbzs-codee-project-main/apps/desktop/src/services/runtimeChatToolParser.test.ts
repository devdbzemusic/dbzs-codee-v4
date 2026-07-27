import { describe, expect, it } from "vitest";
import {
  parseRuntimeToolCallsFromAssistant,
  parseRuntimeToolEnvelope
} from "@/services/runtimeChatToolParser";

describe("runtimeChatToolParser", () => {
  it("führt Markdown-Toolanleitungen nicht aus", () => {
    const content = [
      "Ich lese die Datei.",
      "```tool-call",
      '{"tool":"read_file","input":{"path":"src/App.tsx"}}',
      "```"
    ].join("\n");

    const calls = parseRuntimeToolCallsFromAssistant(content);
    expect(calls).toHaveLength(0);
  });

  it("erkennt ausschließlich den exakten Envelope", () => {
    const content =
      '<CODEE_TOOL_CALL>\n{"name":"read_file","arguments":{"path":"src/App.tsx"}}\n</CODEE_TOOL_CALL>';
    expect(parseRuntimeToolCallsFromAssistant(content)).toEqual([
      { name: "read_file", input: { path: "src/App.tsx" } }
    ]);
  });

  it("weist Prosa und ungültige Envelopes eindeutig zurück", () => {
    expect(parseRuntimeToolEnvelope(
      'Bitte ausführen:\n<CODEE_TOOL_CALL>{"name":"read_file","arguments":{}}</CODEE_TOOL_CALL>'
    )).toMatchObject({ kind: "invalid", reason: "text_outside_envelope" });
    expect(parseRuntimeToolEnvelope(
      '<CODEE_TOOL_CALL>{"tool":"read_file","input":{}}</CODEE_TOOL_CALL>'
    )).toMatchObject({ kind: "invalid", reason: "invalid_envelope_payload" });
  });
});
