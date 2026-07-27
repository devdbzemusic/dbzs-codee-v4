import { describe, expect, it } from "vitest";
import { toolsRequiringApproval } from "./agentToolProfile";

describe("toolsRequiringApproval", () => {
  it("requires approval for file-mutating tools in the full profile", () => {
    const approvalTools = toolsRequiringApproval("full");
    expect(approvalTools).toEqual(
      expect.arrayContaining(["write_file", "apply_patch", "create_file", "rename_file", "delete_file"])
    );
  });

  it("requires approval for file-mutating tools in the agent profile", () => {
    const approvalTools = toolsRequiringApproval("agent");
    expect(approvalTools).toEqual(
      expect.arrayContaining(["write_file", "apply_patch", "create_file", "rename_file", "delete_file"])
    );
  });

  it("does not require approval for read-only tools in ask profile", () => {
    expect(toolsRequiringApproval("ask")).toEqual([]);
  });
});
