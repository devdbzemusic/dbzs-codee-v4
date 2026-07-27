import { describe, expect, it } from "vitest";
import { isPathInsideWorkspace, toAbsPath, validateRelativePath } from "./workspacePathUtils";

describe("workspacePathUtils", () => {
  it("builds absolute paths from relative paths", () => {
    expect(toAbsPath("D:/repo", "src/main.ts")).toBe("D:/repo/src/main.ts");
  });

  it("rejects invalid relative paths", () => {
    expect(validateRelativePath("../secret.txt")).toBe(false);
    expect(validateRelativePath("src/main.ts")).toBe(true);
  });

  it("detects paths inside the active workspace", () => {
    expect(isPathInsideWorkspace("D:/repo/src/main.ts", "D:/repo")).toBe(true);
    expect(isPathInsideWorkspace("D:/other/main.ts", "D:/repo")).toBe(false);
  });
});
