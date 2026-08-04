import { describe, it, expect } from "vitest";
import { summarizeToolOutput } from "./runtimeChatAgentRunner";
import { getFullToolLog } from "./toolOutputLogStore";
import type { ToolResult } from "@/runtime/tool/toolContracts";

function makeResult(status: "ok" | "error", output?: unknown, errorMessage?: string): ToolResult {
  return {
    requestId: "req-1",
    toolName: "run_terminal_command",
    status,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    output,
    error: errorMessage ? { message: errorMessage, code: "failed", retryable: false } : undefined
  };
}

describe("summarizeToolOutput (Tool Output Layering)", () => {
  it("returns empty layers when there is no result", () => {
    const layers = summarizeToolOutput("run_terminal_command", undefined);

    expect(layers.displaySummary).toBe("");
    expect(layers.agentContext).toBe("");
    expect(layers.fullLogRef).toBeUndefined();
  });

  it("surfaces the error message on failure without a fullLogRef", () => {
    const result = makeResult("error", undefined, "Command failed with exit code 1");

    const layers = summarizeToolOutput("run_terminal_command", result);

    expect(layers.displaySummary).toBe("Command failed with exit code 1");
    expect(layers.agentContext).toBe("Command failed with exit code 1");
    expect(layers.fullLogRef).toBeUndefined();
  });

  it("clips displaySummary to ~500 chars but keeps a longer agentContext", () => {
    const longOutput = "line of normal output\n".repeat(100); // ~2300 chars
    const result = makeResult("ok", { stdout: longOutput, stderr: "" });

    const layers = summarizeToolOutput("run_terminal_command", result);

    expect(layers.displaySummary.length).toBeLessThanOrEqual(500);
    expect(layers.agentContext.length).toBeGreaterThan(layers.displaySummary.length);
  });

  it("acceptance: agentContext retains actual error lines instead of an arbitrary cutoff", () => {
    const noise = "harmless log line\n".repeat(50); // pushes the real error well past a naive 500-char cutoff
    const output = `${noise}Traceback (most recent call last):\n  File "x.py", line 1\nValueError: something broke\n${noise}`;
    const result = makeResult("ok", { stdout: output, stderr: "" });

    const layers = summarizeToolOutput("run_terminal_command", result);

    expect(layers.displaySummary).not.toContain("ValueError");
    expect(layers.agentContext).toContain("ValueError: something broke");
    expect(layers.agentContext).toContain("Traceback");
  });

  it("acceptance: long output gets a fullLogRef, and the full text is retrievable by it", () => {
    const longOutput = "x".repeat(10_000);
    const result = makeResult("ok", { stdout: longOutput, stderr: "" });

    const layers = summarizeToolOutput("run_terminal_command", result);

    expect(layers.fullLogRef).toBeDefined();
    const stored = getFullToolLog(layers.fullLogRef!);
    expect(stored).toBe(longOutput);
  });

  it("does not create a fullLogRef for short output", () => {
    const result = makeResult("ok", { stdout: "short output", stderr: "" });

    const layers = summarizeToolOutput("run_terminal_command", result);

    expect(layers.fullLogRef).toBeUndefined();
  });
});
