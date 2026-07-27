import { beforeEach, describe, expect, it, vi } from "vitest";
import { initRuntimeChatSync, resetRuntimeChatSyncForTests } from "@/services/runtimeChatSync";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

describe("runtimeChatSync", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      }
    });

    resetRuntimeChatSyncForTests();
    useRuntimeChatStore.setState({
      messages: [],
      isSending: false,
      error: null
    });
  });

  it("loads persisted chat state on init", () => {
    localStorage.setItem(
      "dbzs-runtime-chat-state",
      JSON.stringify({
        messages: [{ role: "user", content: "Hallo" }],
        isSending: false,
        error: null
      })
    );

    initRuntimeChatSync();

    expect(useRuntimeChatStore.getState().messages).toEqual([{ role: "user", content: "Hallo" }]);
  });

  it("persists chat state updates for other windows", () => {
    initRuntimeChatSync();

    useRuntimeChatStore.setState({
      messages: [{ id: "msg-test", role: "assistant", content: "Antwort" }],
      isSending: false,
      error: null
    });

    const raw = localStorage.getItem("dbzs-runtime-chat-state");
    expect(raw).toContain("Antwort");
  });
});

