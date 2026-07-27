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

  it("enthaelt die erweiterten Verzeichnis-Ausschluesse", () => {
    expect(DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES).toEqual(expect.arrayContaining([
      "out",
      ".cache",
      "playwright-report",
      "test-results"
    ]));
    expect(isContextPathAllowed(".cache/foo.json")).toBe(false);
    expect(isContextPathAllowed("playwright-report/index.html")).toBe(false);
    expect(isContextPathAllowed("test-results/run.json")).toBe(false);
    expect(isContextPathAllowed("out/bundle.js")).toBe(false);
  });

  it("schliesst Dateien nach Glob-Mustern aus (.log, .env)", () => {
    expect(isContextPathAllowed("logs/app.log")).toBe(false);
    expect(isContextPathAllowed(".env")).toBe(false);
    expect(isContextPathAllowed(".env.local")).toBe(false);
    expect(isContextPathAllowed(".env.production")).toBe(false);
  });

  it("laesst Dateien zu, die nur aehnlich aussehen wie ausgeschlossene Muster", () => {
    expect(isContextPathAllowed("src/envelope.txt")).toBe(true);
    expect(isContextPathAllowed("logs/foo.log.bak")).toBe(true);
  });
});
