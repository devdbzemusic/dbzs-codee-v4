import { describe, expect, it } from "vitest";
import { shouldSyncWorkspaceSettings } from "./workspaceState";

describe("shouldSyncWorkspaceSettings", () => {
  it("returns false before workspace state is loaded", () => {
    expect(shouldSyncWorkspaceSettings(false)).toBe(false);
  });

  it("returns true after workspace state is loaded", () => {
    expect(shouldSyncWorkspaceSettings(true)).toBe(true);
  });
});
