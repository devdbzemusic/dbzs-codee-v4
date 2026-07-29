import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeChatMessage } from "@dbzs/shared";
import { RuntimeChatMessageCard } from "@/components/runtime-chat/RuntimeChatMessageCard";
import { useWorkspaceStore } from "@/stores/workspaceStore";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeMessage(): RuntimeChatMessage {
  return {
    id: "msg-followup",
    role: "assistant",
    content: "Hier ist meine Antwort.",
    actions: [
      {
        id: "act-approve-patch",
        runId: "run-1",
        messageId: "msg-followup",
        workspaceRoot: "C:/work/a",
        workspaceId: "c:/work/a",
        kind: "approve_patch",
        title: "Übernehmen",
        state: "pending",
        payload: { proposalId: "patch-1" },
        createdAt: new Date().toISOString()
      },
      {
        id: "followup-msg-followup-show_next_steps",
        runId: "run-1",
        messageId: "msg-followup",
        workspaceRoot: "C:/work/a",
        workspaceId: "c:/work/a",
        kind: "show_next_steps",
        title: "Nächste Schritte",
        state: "pending",
        riskLevel: "low",
        payload: { prompt: "Gib die naechsten 3 priorisierten Schritte inklusive kurzer Begruendung an." },
        createdAt: new Date().toISOString()
      }
    ]
  };
}

describe("RuntimeChatMessageCard follow-up actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useWorkspaceStore.setState({
      state: { ...useWorkspaceStore.getState().state, projectPath: "C:/work/a" }
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders required actions regardless of isSending/isLatestAssistantMessage", () => {
    act(() => {
      root.render(
        <RuntimeChatMessageCard
          message={makeMessage()}
          canApply={false}
          isSending={true}
          isLatestAssistantMessage={false}
          onApply={() => {}}
        />
      );
    });

    expect(container.textContent).toContain("Übernehmen");
  });

  it("hides the follow-up block when the message is not the latest assistant message", () => {
    act(() => {
      root.render(
        <RuntimeChatMessageCard
          message={makeMessage()}
          canApply={false}
          isSending={false}
          isLatestAssistantMessage={false}
          onApply={() => {}}
        />
      );
    });

    expect(container.querySelector('[aria-label="Vorgeschlagene Folgeaktionen"]')).toBeNull();
    expect(container.textContent).not.toContain("Nächste Schritte");
  });

  it("shows the follow-up block on the latest assistant message and disables it while sending", () => {
    act(() => {
      root.render(
        <RuntimeChatMessageCard
          message={makeMessage()}
          canApply={false}
          isSending={true}
          isLatestAssistantMessage={true}
          onApply={() => {}}
        />
      );
    });

    const followUpBlock = container.querySelector('[aria-label="Vorgeschlagene Folgeaktionen"]');
    expect(followUpBlock).not.toBeNull();
    const button = [...(followUpBlock?.querySelectorAll("button") ?? [])].find(
      (btn) => btn.textContent?.includes("Nächste Schritte")
    );
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the follow-up button when not sending", () => {
    act(() => {
      root.render(
        <RuntimeChatMessageCard
          message={makeMessage()}
          canApply={false}
          isSending={false}
          isLatestAssistantMessage={true}
          onApply={() => {}}
        />
      );
    });

    const followUpBlock = container.querySelector('[aria-label="Vorgeschlagene Folgeaktionen"]');
    const button = [...(followUpBlock?.querySelectorAll("button") ?? [])].find(
      (btn) => btn.textContent?.includes("Nächste Schritte")
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("RuntimeChatMessageCard system message collapsing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useWorkspaceStore.setState({
      state: { ...useWorkspaceStore.getState().state, projectPath: "C:/work/a" }
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("collapses a long tool-result system message even without the compact prop (real app default)", () => {
    const toolResultMessage: RuntimeChatMessage = {
      id: "msg-tool-result",
      role: "system",
      content: `[Tool Result: list_files]\nStatus: ok\nOutput:\n${"x".repeat(300)}`
    };

    act(() => {
      root.render(
        <RuntimeChatMessageCard
          message={toolResultMessage}
          canApply={false}
          onApply={() => {}}
        />
      );
    });

    expect(container.querySelector("details")).not.toBeNull();
    expect(container.textContent).toContain("System-Kontext");
  });

  it("does not collapse an [Analyse-Protokoll] system message", () => {
    const analysisMessage: RuntimeChatMessage = {
      id: "msg-analysis",
      role: "system",
      content: `[Analyse-Protokoll]\n${"x".repeat(300)}`
    };

    act(() => {
      root.render(
        <RuntimeChatMessageCard
          message={analysisMessage}
          canApply={false}
          onApply={() => {}}
        />
      );
    });

    expect(container.querySelector("details")).toBeNull();
  });
});
