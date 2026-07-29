import { describe, expect, it, beforeEach } from "vitest";
import {
  finalizeRuntimeRun,
  isGenericRuntimeErrorSentinel,
  isToolOnlyAnswer,
  isValidFinalAnswer,
  looksLikeContextOverflowMessage,
  resetRuntimeRunFinalizationForTests
} from "./runtimeRunFinalization";

describe("runtimeRunFinalization", () => {
  beforeEach(() => {
    resetRuntimeRunFinalizationForTests();
  });

  it("erkennt generische Fehler-Sentinels", () => {
    expect(
      isGenericRuntimeErrorSentinel(
        "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen."
      )
    ).toBe(true);
    expect(isValidFinalAnswer("1) Schritt A\n2) Schritt B\n3) Schritt C")).toBe(true);
    expect(isValidFinalAnswer("")).toBe(false);
  });

  it("erkennt einen rohen Tool-Call-Envelope als isToolOnlyAnswer", () => {
    expect(
      isToolOnlyAnswer(
        '<CODEE_TOOL_CALL>{"name":"list_files","arguments":{"path":"/models","recursive":true}}</CODEE_TOOL_CALL>'
      )
    ).toBe(true);
    expect(isToolOnlyAnswer("")).toBe(false);
    expect(isToolOnlyAnswer("Im Workspace wurden 3 GGUF-Modelle gefunden.")).toBe(false);
    expect(
      isToolOnlyAnswer(
        'Hier ist das Ergebnis. <CODEE_TOOL_CALL>{"name":"list_files","arguments":{}}</CODEE_TOOL_CALL>'
      )
    ).toBe(true);
  });

  it("lehnt eine reine Tool-Call-Envelope als gültige Endantwort ab", () => {
    expect(
      isValidFinalAnswer(
        '<CODEE_TOOL_CALL>{"name":"list_files","arguments":{"path":"/models","recursive":true}}</CODEE_TOOL_CALL>'
      )
    ).toBe(false);
  });

  it("markiert einen Lauf als agent_loop_incomplete, wenn agentLoopCompleted false ist (Budget/Cancel-Faelle)", () => {
    const result = finalizeRuntimeRun({
      runId: "run-loop-incomplete",
      outcome: "success",
      finalAnswer: "Teilweise Ausgabe, aber der Turn-Loop wurde nicht sauber abgeschlossen.",
      agentTurnCount: 5,
      pipeline: { modelOutputReceived: true, agentLoopCompleted: false, outputParsed: true }
    });
    expect(result.outcome).toBe("agent_loop_incomplete");
    expect(result.status).toBe("failed");
    expect(result.suppressAssistantSuccess).toBe(true);
  });

  it("markiert einen Lauf mit reinem Tool-Call-Envelope als Endantwort nicht als success", () => {
    const result = finalizeRuntimeRun({
      runId: "run-tool-only",
      outcome: "success",
      finalAnswer:
        '<CODEE_TOOL_CALL>{"name":"list_files","arguments":{"path":"/models","recursive":true}}</CODEE_TOOL_CALL>',
      agentTurnCount: 1,
      pipeline: { modelOutputReceived: true, agentLoopCompleted: true, outputParsed: true }
    });
    expect(result.outcome).not.toBe("success");
    expect(result.status).toBe("failed");
    expect(result.suppressAssistantSuccess).toBe(true);
  });

  it("markiert Safe-Fallback nicht als success", () => {
    const result = finalizeRuntimeRun({
      runId: "run-1",
      outcome: "success",
      finalAnswer: "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen.",
      safeFallback: true,
      agentTurnCount: 1
    });
    expect(result.outcome).toBe("generation_failed");
    expect(result.status).toBe("failed");
    expect(result.finalAnswerDelivered).toBe(false);
    expect(result.suppressAssistantSuccess).toBe(true);
    expect(result.userMessage).not.toMatch(/Erfolgreich/);
    expect(result.userMessage).not.toMatch(/kürzer/);
  });

  it("setzt empty_final_answer bei leerem Output", () => {
    const result = finalizeRuntimeRun({
      runId: "run-2",
      outcome: "success",
      finalAnswer: "   ",
      agentTurnCount: 1,
      pipeline: { modelOutputReceived: false, agentLoopCompleted: true }
    });
    expect(result.outcome).toBe("empty_final_answer");
    expect(result.status).toBe("failed");
  });

  it("erlaubt success nur mit gültiger Endantwort", () => {
    const result = finalizeRuntimeRun({
      runId: "run-3",
      outcome: "success",
      finalAnswer: "Drei priorisierte Schritte:\n1. A\n2. B\n3. C",
      agentTurnCount: 1,
      pipeline: {
        modelOutputReceived: true,
        agentLoopCompleted: true,
        outputParsed: true
      }
    });
    expect(result.outcome).toBe("success");
    expect(result.status).toBe("completed");
    expect(result.finalAnswerDelivered).toBe(true);
    expect(result.userMessage).toContain("Gültige Endantwort");
  });

  it("ignoriert doppelte Finalisierung", () => {
    const first = finalizeRuntimeRun({
      runId: "run-4",
      outcome: "success",
      finalAnswer: "ok"
    });
    const second = finalizeRuntimeRun({
      runId: "run-4",
      outcome: "generation_failed",
      finalAnswer: "fail"
    });
    expect(second.outcome).toBe(first.outcome);
    expect(second.diagnostics.finalOutcome).toBe("success");
  });

  it("begrenzt Raw Preview und redigiert Secrets", () => {
    const secret = `token=supersecret ${"x".repeat(5000)}`;
    const result = finalizeRuntimeRun({
      runId: "run-5",
      outcome: "generation_failed",
      finalAnswer: "Runtime konnte die Anfrage nicht ausführen",
      rawContent: secret
    });
    expect(result.diagnostics.rawContentPreview?.length ?? 0).toBeLessThanOrEqual(4096);
    expect(result.diagnostics.rawContentPreview).toContain("[redacted]");
  });

  it("ordnet Context-Overflow korrekt zu", () => {
    const result = finalizeRuntimeRun({
      runId: "run-6",
      outcome: "success",
      finalAnswer:
        "Die Anfrage ist größer als das aktuelle Runtime-Kontextfenster. Bitte weniger Datei-/Workspace-Kontext senden.",
      safeFallback: true
    });
    expect(result.outcome).toBe("context_overflow");
    expect(result.userMessage).toMatch(/Kontextfenster|Context/i);
  });

  it("mappt Safe-Fallback mit 'context' im Text nicht fälschlich auf context_overflow", () => {
    const result = finalizeRuntimeRun({
      runId: "run-7",
      outcome: "success",
      finalAnswer: "Runtime konnte die Anfrage nicht ausführen. Please update the React context provider.",
      safeFallback: true
    });
    expect(result.outcome).toBe("generation_failed");
    expect(result.outcome).not.toBe("context_overflow");
  });

  it("erkennt looksLikeContextOverflowMessage nur bei echten Overflow-Phrasen", () => {
    expect(looksLikeContextOverflowMessage("Update the React context")).toBe(false);
    expect(looksLikeContextOverflowMessage("context window exceeded")).toBe(true);
    expect(
      looksLikeContextOverflowMessage(
        "Die Anfrage ist größer als das aktuelle Runtime-Kontextfenster."
      )
    ).toBe(true);
  });
});
