import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DebugLogPanel } from "./DebugLogPanel";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { observabilityService } from "@/runtime/observability/observabilityService";
import type { RuntimeChatRun } from "@dbzs/shared";

function makeRun(overrides: Partial<RuntimeChatRun> = {}): RuntimeChatRun {
  return {
    id: "run-1",
    userMessageId: "user-1",
    status: "streaming",
    startedAt: new Date().toISOString(),
    mode: "auto",
    profile: "ask",
    contextEnabled: false,
    events: [],
    turns: [],
    toolCalls: [],
    fileChanges: [],
    commands: [],
    ...overrides
  };
}

describe("DebugLogPanel", () => {
  beforeEach(() => {
    useRuntimeChatStore.setState({ activeRun: null, historicalRuns: {} });
  });

  afterEach(() => {
    cleanup();
    useRuntimeChatStore.setState({ activeRun: null, historicalRuns: {} });
  });

  it("zeigt einen Platzhalter, solange keine Events aufgetreten sind", () => {
    render(<DebugLogPanel />);
    expect(screen.getByText(/Noch keine Events/i)).toBeInTheDocument();
  });

  it("zeigt RuntimeChatEvents des aktiven Runs live an", () => {
    render(<DebugLogPanel />);

    act(() => {
      useRuntimeChatStore.setState({
        activeRun: makeRun({
          events: [
            { id: "evt-1", type: "routing.started", timestamp: new Date().toISOString(), message: "Modell-Routing" }
          ]
        })
      });
    });

    expect(screen.getByText("routing.started")).toBeInTheDocument();
    expect(screen.getByText(/Modell-Routing/)).toBeInTheDocument();
  });

  it("haengt nur neu hinzugekommene Events an, wiederholt keine bereits gesehenen", () => {
    render(<DebugLogPanel />);

    act(() => {
      useRuntimeChatStore.setState({
        activeRun: makeRun({
          events: [{ id: "evt-1", type: "routing.started", timestamp: new Date().toISOString() }]
        })
      });
    });
    act(() => {
      useRuntimeChatStore.setState({
        activeRun: makeRun({
          events: [
            { id: "evt-1", type: "routing.started", timestamp: new Date().toISOString() },
            { id: "evt-2", type: "routing.completed", timestamp: new Date().toISOString() }
          ]
        })
      });
    });

    expect(screen.getAllByText("routing.started")).toHaveLength(1);
    expect(screen.getByText("routing.completed")).toBeInTheDocument();
  });

  it("abonniert den ObservabilityService und zeigt dessen Events an", () => {
    render(<DebugLogPanel />);

    act(() => {
      observabilityService.handleEvent({
        type: "chat_session_started",
        trace: {
          sessionId: "session-1",
          targetAgent: "coder",
          status: "active",
          startedAt: new Date().toISOString(),
          workspaceRoot: null,
          contextProofs: [],
          handoffLogs: [],
          toolExecutionLogs: []
        } as never
      });
    });

    expect(screen.getByText(/session_started/)).toBeInTheDocument();
    expect(screen.getByText(/\[observability\]/)).toBeInTheDocument();
  });

  it("leert die Liste ueber den Leeren-Button", () => {
    render(<DebugLogPanel />);
    act(() => {
      useRuntimeChatStore.setState({
        activeRun: makeRun({
          events: [{ id: "evt-1", type: "routing.started", timestamp: new Date().toISOString() }]
        })
      });
    });
    expect(screen.getByText("routing.started")).toBeInTheDocument();

    act(() => {
      screen.getByText("Leeren").click();
    });

    expect(screen.queryByText("routing.started")).not.toBeInTheDocument();
    expect(screen.getByText(/Noch keine Events/i)).toBeInTheDocument();
  });
});
