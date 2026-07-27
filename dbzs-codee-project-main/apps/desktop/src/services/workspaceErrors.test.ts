import { describe, expect, it } from "vitest";
import { parseWorkspaceError, toWorkspaceUserMessage } from "./workspaceErrors";

describe("workspaceErrors", () => {
  it("parses workspace error code prefixes", () => {
    const parsed = parseWorkspaceError(new Error("[WORKSPACE_WRITE_TOO_LARGE] Workspace write exceeds byte limit."));
    expect(parsed.code).toBe("WORKSPACE_WRITE_TOO_LARGE");
    expect(parsed.message).toBe("Workspace write exceeds byte limit.");
  });

  it("maps known workspace codes to user-friendly text", () => {
    const message = toWorkspaceUserMessage(
      new Error("[WORKSPACE_PREVIEW_MISSING] Write preview is missing or expired."),
      "Fallback"
    );
    expect(message).toContain("Diff-Preview ist abgelaufen");
  });

  it("falls back to plain error text when no code is present", () => {
    const message = toWorkspaceUserMessage(new Error("Simple failure"), "Fallback");
    expect(message).toBe("Simple failure");
  });
});
