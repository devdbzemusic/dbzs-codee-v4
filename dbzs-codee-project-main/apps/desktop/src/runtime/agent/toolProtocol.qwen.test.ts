import { describe, expect, it } from "vitest";
import {
  parseAssistantToolCalls,
  parseNativeToolCallsFromMessage
} from "@/runtime/agent/toolProtocolAdapter";

describe("tool protocol — Qwen/llama text + native", () => {
  it("parses strict text envelopes used by local llama.cpp models", () => {
    const content = [
      "<CODEE_TOOL_CALL>",
      '{"name":"read_file","arguments":{"path":"package.json"}}',
      "</CODEE_TOOL_CALL>",
      ""
    ].join("\n");
    const calls = parseAssistantToolCalls(content, 8);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("read_file");
    expect(calls[0]?.input).toEqual({ path: "package.json" });
  });

  it("keeps native message.tool_calls even when content is empty", () => {
    const calls = parseNativeToolCallsFromMessage({
      tool_calls: [
        {
          function: {
            name: "install_dependency",
            arguments: JSON.stringify({
              packageManager: "npm",
              packages: [{ name: "electron" }],
              dependencyType: "development",
              reason: "Electron desktop shell"
            })
          }
        }
      ]
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("install_dependency");
  });
});
