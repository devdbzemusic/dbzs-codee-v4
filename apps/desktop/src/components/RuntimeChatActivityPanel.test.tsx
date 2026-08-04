import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeChatActivityPanel } from "./RuntimeChatActivityPanel";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

function makeActivity(id: string, status: "running" | "done" | "error" = "running") {
  return {
    id,
    targetAgent: "coder" as const,
    modelId: "model-1",
    modelName: "Coder",
    summary: "Analyse abgeschlossen",
    startedAt: new Date().toISOString(),
    finishedAt: status === "running" ? null : new Date().toISOString(),
    steps: [
      {
        id: `${id}-step-1`,
        label: "Datei prüfen",
        status,
        detail: "src/App.tsx"
      }
    ]
  };
}

describe("RuntimeChatActivityPanel", () => {
  beforeEach(() => {
    useRuntimeChatStore.setState({
      currentActivity: null,
      lastActivity: null,
      isSending: false,
      clearActivityHistory: vi.fn()
    } as never);
  });

  it("renders the current analysis activity with its steps", () => {
    useRuntimeChatStore.setState({
      currentActivity: makeActivity("run-1"),
      isSending: true
    } as never);

    render(<RuntimeChatActivityPanel />);

    expect(screen.getByText("Analyse-Aktivitaet")).toBeInTheDocument();
    expect(screen.getByText("Analyse laeuft …")).toBeInTheDocument();
    expect(screen.getByText("Datei prüfen")).toBeInTheDocument();
  });

  it("shows the last protocol, toggles it and clears history", () => {
    const clearActivityHistory = vi.fn();
    useRuntimeChatStore.setState({
      currentActivity: null,
      lastActivity: makeActivity("run-2", "done"),
      isSending: false,
      clearActivityHistory
    } as never);

    render(<RuntimeChatActivityPanel />);

    expect(screen.getByText("Letztes Analyse-Protokoll")).toBeInTheDocument();
    expect(screen.queryByText("Datei prüfen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Letztes Analyse-Protokoll/i }));
    expect(screen.getByText("Datei prüfen")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Protokoll leeren" }));
    });
    expect(clearActivityHistory).toHaveBeenCalledTimes(1);
  });
});
