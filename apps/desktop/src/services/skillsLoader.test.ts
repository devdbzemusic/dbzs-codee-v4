import { describe, expect, it } from "vitest";
import { listRuntimeChatSkills } from "@/services/runtimeChatSkills";

describe("skillsLoader integration", () => {
  it("includes bundled fallback skills", () => {
    const skills = listRuntimeChatSkills();
    expect(skills.some((skill) => skill.id === "code-review")).toBe(true);
    expect(skills.some((skill) => skill.id === "implement")).toBe(true);
  });

  it("discovers SKILL.md entries from apps/desktop/src/skills", () => {
    const skills = listRuntimeChatSkills();
    expect(skills.some((skill) => skill.id.includes("doc") || skill.label.toLowerCase().includes("doc"))).toBe(true);
  });
});
