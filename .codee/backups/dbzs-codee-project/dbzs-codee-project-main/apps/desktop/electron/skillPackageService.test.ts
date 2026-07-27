import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillPackageService } from "./skillPackageService";

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writePackage(root: string, id = "fixture"): string {
  const directory = path.join(root, id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "manifest.yaml"), `
schemaVersion: "1.0"
id: ${id}
kind: skill
name: Fixture
version: 1.0.0
description: Test skill
mode: advisory
targetAgents: [runtime_chat]
activation: { intents: [test], keywords: [fixture], explicitOnly: false, autoSuggest: true }
preconditions: []
effects: [test]
domains: [test]
cost: low
latency: fast
riskLevel: low
sideEffects: []
idempotent: true
permissions:
  allowedTools: []
  requiredTools: []
  mayReadFiles: false
  mayWriteFiles: false
  mayRunCommands: false
  mayInstallDependencies: false
  mayUseNetwork: false
compatibility: { requires: [], conflictsWith: [], composesWith: [], enables: [] }
successSignals: []
failureSignals: []
observability: { logs: [], metrics: [] }
`, "utf8");
  writeFileSync(path.join(directory, "SKILL.md"), "# Fixture", "utf8");
  writeFileSync(path.join(directory, "README.md"), "# Readme", "utf8");
  writeFileSync(path.join(directory, "evil.js"), "throw new Error('must not run')", "utf8");
  return directory;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SkillPackageService", () => {
  it("loads user skills and ignores executable extras", async () => {
    const userRoot = tempRoot("dbzs-user-skills-");
    writePackage(userRoot);
    const result = await new SkillPackageService(userRoot).reload();
    expect(result.packages.map((skill) => skill.manifest.id)).toEqual(["fixture"]);
    expect(result.failures).toEqual([]);
  });

  it("imports only allowed files and rejects duplicate IDs and ZIP input", async () => {
    const sourceRoot = tempRoot("dbzs-skill-source-");
    const source = writePackage(sourceRoot);
    const userRoot = tempRoot("dbzs-user-skills-");
    const service = new SkillPackageService(userRoot);
    await expect(service.importDirectory(source)).resolves.toMatchObject({
      manifest: { id: "fixture" }
    });
    await expect(service.importDirectory(source)).rejects.toThrow(/already exists/);
    await expect(service.importDirectory(path.join(sourceRoot, "fixture.zip"))).rejects.toThrow(/ZIP/);
    const reloaded = await service.reload();
    expect(reloaded.packages[0]?.instructions).toBe("# Fixture");
  });

  it("isolates invalid packages", async () => {
    const userRoot = tempRoot("dbzs-user-skills-");
    writePackage(userRoot, "valid");
    mkdirSync(path.join(userRoot, "broken"));
    writeFileSync(path.join(userRoot, "broken", "SKILL.md"), "# broken", "utf8");
    const result = await new SkillPackageService(userRoot).reload();
    expect(result.packages).toHaveLength(1);
    expect(result.failures[0]?.code).toBe("manifest_missing");
  });
});
