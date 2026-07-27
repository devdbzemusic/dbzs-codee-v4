import { describe, expect, it } from "vitest";
import { parsePatchProposalsFromArtifacts } from "./agentRunnerStore";

describe("parsePatchProposalsFromArtifacts", () => {
  it("parses patch_proposals.json artifact content", () => {
    const proposals = parsePatchProposalsFromArtifacts([
      {
        name: "patch_proposals.json",
        content: JSON.stringify({
          patches: [
            {
              file_path: "src/app.ts",
              proposed_content: "export {}",
              summary: "fix"
            }
          ]
        })
      }
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.file_path).toBe("src/app.ts");
  });

  it("returns empty list when artifact is missing", () => {
    expect(parsePatchProposalsFromArtifacts([])).toEqual([]);
  });
});
