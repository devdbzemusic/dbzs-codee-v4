import { describe, expect, it } from "vitest";
import {
  resolveWorkflowPhaseToolLimit,
  resolveWorkflowPhaseToolNames,
  resolveWorkflowToolPhase
} from "@/services/workflowPhaseToolPolicy";

describe("workflowPhaseToolPolicy", () => {
  it("keeps planning on a compact 5-tool set", () => {
    const names = resolveWorkflowPhaseToolNames({
      taskType: "planning",
      phase: "planning"
    });
    expect(names).toEqual([
      "list_files",
      "read_file",
      "search_workspace",
      "grep",
      "ask_user"
    ]);
    expect(resolveWorkflowPhaseToolLimit({ taskType: "planning", phase: "planning" })).toBe(5);
  });

  it("maps implementation-like phases to execution tools", () => {
    expect(resolveWorkflowToolPhase({ taskType: "small_code_change", phase: "implementation" })).toBe("implementation");
    const names = resolveWorkflowPhaseToolNames({
      taskType: "small_code_change",
      phase: "implementation"
    });
    expect(names).toContain("apply_patch");
    expect(names).toContain("run_tests");
  });

  it("filters against skill-allowed tools", () => {
    const names = resolveWorkflowPhaseToolNames({
      taskType: "review",
      phase: "planning",
      skillAllowedNames: ["read_file", "ask_user", "write_skill_artifact"]
    });
    expect(names).toEqual(["read_file", "ask_user"]);
  });
});
