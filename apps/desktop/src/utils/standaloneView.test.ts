import { describe, expect, it, vi } from "vitest";
import { buildRuntimeChatWindowUrl, readStandaloneView } from "@/utils/standaloneView";

describe("standaloneView", () => {
  it("reads runtime chat mode from hash", () => {
    vi.stubGlobal("location", {
      hash: "#runtime-chat",
      search: ""
    });

    expect(readStandaloneView()).toBe("runtime-chat");
  });

  it("reads runtime chat mode from query param", () => {
    vi.stubGlobal("location", {
      hash: "",
      search: "?view=runtime-chat"
    });

    expect(readStandaloneView()).toBe("runtime-chat");
  });

  it("reads platform diagnostics mode from hash", () => {
    vi.stubGlobal("location", {
      hash: "#platform-diagnostics",
      search: ""
    });

    expect(readStandaloneView()).toBe("platform-diagnostics");
  });

  it("builds a stable runtime chat window url", () => {
    expect(buildRuntimeChatWindowUrl("http://localhost:5173/")).toBe(
      "http://localhost:5173/?view=runtime-chat#runtime-chat"
    );
  });
});
