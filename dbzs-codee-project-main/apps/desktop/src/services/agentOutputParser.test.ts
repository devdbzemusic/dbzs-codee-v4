import { describe, expect, it } from "vitest";
import {
  AgentOutputParseError,
  looksLikeAgentChangePayload,
  parseAgentOutputToProposedChanges
} from "./agentOutputParser";

describe("parseAgentOutputToProposedChanges", () => {
  const workspaceRoot = "D:/Dev/repo/dbzs-codee";

  it("parst gueltiges Agent-JSON zu ProposedChange[]", () => {
    const parsed = parseAgentOutputToProposedChanges(
      JSON.stringify({
        changes: [
          {
            filePath: "apps/desktop/src/App.tsx",
            proposedContent: "export function App() { return null; }",
            reason: "UI vereinfachen"
          }
        ]
      }),
      {
        agentId: "runtime-chat",
        workspaceRoot
      }
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.filePath).toContain("/apps/desktop/src/App.tsx");
    expect(parsed[0]?.agentId).toBe("runtime-chat");
    expect(parsed[0]?.status).toBe("pending");
  });

  it("lehnt ungueltiges JSON ab", () => {
    expect(() =>
      parseAgentOutputToProposedChanges("{invalid", {
        agentId: "runtime-chat",
        workspaceRoot
      })
    ).toThrowError(AgentOutputParseError);

    try {
      parseAgentOutputToProposedChanges("{invalid", {
        agentId: "runtime-chat",
        workspaceRoot
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AgentOutputParseError);
      expect((error as AgentOutputParseError).code).toBe("INVALID_JSON");
    }
  });

  it("blockiert Pfade ausserhalb des Workspace", () => {
    expect(() =>
      parseAgentOutputToProposedChanges(
        JSON.stringify({
          changes: [
            {
              filePath: "../outside.ts",
              proposedContent: "console.log('bad');"
            }
          ]
        }),
        {
          agentId: "runtime-chat",
          workspaceRoot
        }
      )
    ).toThrowError(AgentOutputParseError);

    try {
      parseAgentOutputToProposedChanges(
        JSON.stringify({
          changes: [
            {
              filePath: "C:/Windows/System32/drivers/etc/hosts",
              proposedContent: "127.0.0.1 test"
            }
          ]
        }),
        {
          agentId: "runtime-chat",
          workspaceRoot
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AgentOutputParseError);
      expect((error as AgentOutputParseError).code).toBe("OUTSIDE_WORKSPACE");
    }
  });

  it("lehnt leere changes ab", () => {
    expect(() =>
      parseAgentOutputToProposedChanges(
        JSON.stringify({ changes: [] }),
        {
          agentId: "runtime-chat",
          workspaceRoot
        }
      )
    ).toThrowError(AgentOutputParseError);
  });

  it("parst JSON aus Markdown-Codeblock", () => {
    const parsed = parseAgentOutputToProposedChanges(
      [
        "Hier ist der Patch:",
        "```json",
        JSON.stringify({
          changes: [
            {
              filePath: "apps/desktop/src/App.tsx",
              proposedContent: "export function App() { return null; }"
            }
          ]
        }),
        "```"
      ].join("\n"),
      {
        agentId: "runtime-chat",
        workspaceRoot
      }
    );

    expect(parsed).toHaveLength(1);
  });

  it("parst ein changes-Array ohne Wrapper-Objekt", () => {
    const parsed = parseAgentOutputToProposedChanges(
      JSON.stringify([
        {
          filePath: "apps/desktop/src/App.tsx",
          proposedContent: "export function App() { return null; }"
        }
      ]),
      {
        agentId: "runtime-chat",
        workspaceRoot
      }
    );

    expect(parsed).toHaveLength(1);
  });

  it("parst JSON mit begleitendem Freitext", () => {
    const parsed = parseAgentOutputToProposedChanges(
      [
        "Ich habe folgende Aenderung vorbereitet:",
        JSON.stringify({
          changes: [
            {
              filePath: "apps/desktop/src/App.tsx",
              proposedContent: "export function App() { return null; }"
            }
          ]
        }),
        "Bitte pruefen."
      ].join("\n"),
      {
        agentId: "runtime-chat",
        workspaceRoot
      }
    );

    expect(parsed).toHaveLength(1);
  });

  it("erkennt nur parsebare change payloads", () => {
    expect(looksLikeAgentChangePayload('{"changes":[{"filePath":"a.ts","proposedContent":"x"}]}')).toBe(true);
    expect(looksLikeAgentChangePayload('{"changes": "not-an-array"}')).toBe(false);
    expect(looksLikeAgentChangePayload('{ "summary": "changes planned" }')).toBe(false);
    expect(looksLikeAgentChangePayload("{invalid")).toBe(false);
  });

  it("lehnt fehlenden filePath und proposedContent ab", () => {
    expect(() =>
      parseAgentOutputToProposedChanges(
        JSON.stringify({
          changes: [{ proposedContent: "x" }]
        }),
        {
          agentId: "runtime-chat",
          workspaceRoot
        }
      )
    ).toThrowError(AgentOutputParseError);

    expect(() =>
      parseAgentOutputToProposedChanges(
        JSON.stringify({
          changes: [{ filePath: "apps/desktop/src/App.tsx" }]
        }),
        {
          agentId: "runtime-chat",
          workspaceRoot
        }
      )
    ).toThrowError(AgentOutputParseError);
  });
});
