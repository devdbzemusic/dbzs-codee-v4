import { describe, expect, it } from "vitest";
import {
  REVIEW_REMEDIATION_PHASE_TOOL_LIMITS,
  resolveReviewRemediationPhaseToolNames,
  resolveReviewRemediationToolPhase
} from "./reviewRemediationToolPolicy";

describe("reviewRemediationToolPolicy", () => {
  it("begrenzt Planning, Implementation und Verification", () => {
    for (const phase of ["planning", "implementation", "review"] as const) {
      const resolved = resolveReviewRemediationToolPhase(phase);
      expect(resolveReviewRemediationPhaseToolNames(phase).length)
        .toBeLessThanOrEqual(REVIEW_REMEDIATION_PHASE_TOOL_LIMITS[resolved]);
    }
    expect(resolveReviewRemediationPhaseToolNames("planning")).toEqual([
      "read_file", "list_files", "grep", "ask_user"
    ]);
    expect(resolveReviewRemediationPhaseToolNames("implementation")).toContain("apply_patch");
    expect(resolveReviewRemediationPhaseToolNames("review")).not.toContain("apply_patch");
  });

  it("bildet mit einer Skill-Policy die Schnittmenge", () => {
    expect(resolveReviewRemediationPhaseToolNames("implementation", [
      "read_file", "apply_patch", "web_search"
    ])).toEqual(["read_file", "apply_patch"]);
  });
});
