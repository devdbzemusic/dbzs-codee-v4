import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES,
  isContextPathAllowed,
  workspaceScopeId
} from "./contextPolicy";

describe("contextPolicy", () => {
  it("enthaelt alle verbindlichen internen Verzeichnisse", () => {
    expect(DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES).toEqual(expect.arrayContaining([
      ".codee",
      "restore-points",
      "node_modules",
      ".git",
      "dist",
      "build",
      "target",
      "coverage"
    ]));
  });

  it("schliesst interne Pfade standardmaessig aus", () => {
    expect(isContextPathAllowed(".codee/resources/foo.ts")).toBe(false);
    expect(isContextPathAllowed("src/build/generated.ts")).toBe(false);
    expect(isContextPathAllowed("src/App.tsx")).toBe(true);
  });

  it("erlaubt interne Pfade nur bei expliziter und bestaetigter Freigabe", () => {
    expect(isContextPathAllowed(".codee/resources/foo.ts", { explicitMention: true })).toBe(false);
    expect(isContextPathAllowed(".codee/resources/foo.ts", {
      explicitMention: true,
      accessConfirmed: true
    })).toBe(true);
  });

  it("bildet fuer Windows-Pfade eine stabile Workspace-ID", () => {
    expect(workspaceScopeId("C:\\Users\\Demo\\Repo\\")).toBe("c:/users/demo/repo");
  });
});
