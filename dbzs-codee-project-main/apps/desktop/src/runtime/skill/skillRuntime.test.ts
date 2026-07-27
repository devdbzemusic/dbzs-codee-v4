import { describe, expect, it } from "vitest";
import { buildSkillCapsule, intersectSkillTools } from "./skillCapsule";
import type {
  CodeeSkillManifestV1,
  CodeeSkillPackage,
  SkillPreconditionResult
} from "./skillContracts";
import { createSkillPackage, parseSkillManifest, SkillPackageError } from "./skillManifest";
import { SkillRegistry } from "./skillRegistry";
import { resolveSkills } from "./skillResolver";

const MANIFEST = `
schemaVersion: "1.0"
id: mvp-builder
kind: skill
name: MVP Builder
version: 1.0.0
description: MVP planning
mode: planning
targetAgents: [planner]
activation: { intents: [product_planning], keywords: [mvp], explicitOnly: false, autoSuggest: true }
preconditions: [{ id: idea, description: Product idea, required: true, evaluator: has_product_idea }]
effects: [mvp_scope]
domains: [product]
cost: low
latency: fast
riskLevel: low
sideEffects: [creates_skill_artifacts]
idempotent: true
permissions:
  allowedTools: [ask_user, write_skill_artifact]
  requiredTools: [write_skill_artifact]
  mayReadFiles: false
  mayWriteFiles: false
  mayRunCommands: false
  mayInstallDependencies: false
  mayUseNetwork: false
compatibility: { requires: [], conflictsWith: [], composesWith: [], enables: [] }
successSignals: [{ id: scope, description: Scope exists, required: true }]
failureSignals: [{ id: missing, description: Scope missing }]
observability: { logs: [done], metrics: [artifact_count] }
`;

function packageFrom(source: CodeeSkillPackage["source"] = { type: "bundled", path: "fixture" }) {
  return createSkillPackage({
    manifestRaw: MANIFEST,
    instructions: "# MVP\n\n- Identify the riskiest assumption.\n- Define measurable success criteria.",
    readme: "# Readme",
    source
  });
}

describe("Skill Runtime V1", () => {
  it("parses a strict V1 manifest", () => {
    expect(parseSkillManifest(MANIFEST).id).toBe("mvp-builder");
  });

  it("rejects missing and unsupported schema versions", () => {
    expect(() => parseSkillManifest(MANIFEST.replace('schemaVersion: "1.0"\n', "")))
      .toThrow(SkillPackageError);
    expect(() => parseSkillManifest(MANIFEST.replace('"1.0"', '"2.0"')))
      .toThrow(/Unsupported skill schema/);
  });

  it("rejects unknown fields, aliases and oversized manifests", () => {
    expect(() => parseSkillManifest(`${MANIFEST}\nunknownCritical: true\n`)).toThrow(/Unrecognized key/);
    expect(() => parseSkillManifest(MANIFEST.replace("effects: [mvp_scope]", "effects: &e [mvp_scope]\ndomains: *e").replace("domains: [product]\n", "")))
      .toThrow(/aliases and anchors/);
    expect(() => parseSkillManifest(`${MANIFEST}\n#${"x".repeat(70_000)}`)).toThrow(/64 KB/);
  });

  it("uses workspace > user > bundled and exposes overrides", () => {
    const registry = new SkillRegistry();
    const snapshot = registry.replace([
      packageFrom(),
      packageFrom({ type: "user", path: "user" }),
      packageFrom({ type: "workspace", path: "workspace" })
    ], [], { enabledSkillIds: ["mvp-builder"] });
    expect(snapshot.entries[0]?.skill.source.type).toBe("workspace");
    expect(snapshot.entries[0]?.shadowedSources).toHaveLength(2);
    expect(snapshot.entries[0]?.enabled).toBe(true);
  });

  it("suggests matching low-risk skills and selects explicit trusted mentions", () => {
    const registry = new SkillRegistry();
    registry.replace([packageFrom()], [], { enabledSkillIds: [] });
    const passed: SkillPreconditionResult[] = [{
      preconditionId: "idea",
      passed: true,
      message: "ok",
      checkedAt: new Date().toISOString()
    }];
    const suggested = resolveSkills(registry.list(), {
      userMessage: "Wir planen ein MVP",
      executionIntent: "product_planning",
      enabledSkillIds: []
    }, { "mvp-builder": passed });
    expect(suggested.suggestedSkillIds).toContain("mvp-builder");
    const selected = resolveSkills(registry.list(), {
      userMessage: "Nutze Skill mvp-builder",
      executionIntent: "normal_chat",
      enabledSkillIds: []
    }, { "mvp-builder": passed });
    expect(selected.selectedSkillIds).toEqual(["mvp-builder"]);
  });

  it("builds a bounded capsule and intersects tool policies", () => {
    const first = buildSkillCapsule(packageFrom());
    const secondManifest: CodeeSkillManifestV1 = {
      ...packageFrom().manifest,
      id: "second",
      permissions: {
        ...packageFrom().manifest.permissions,
        allowedTools: ["ask_user"]
      }
    };
    const second = buildSkillCapsule({ ...packageFrom(), manifest: secondManifest });
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(4_800);
    expect(intersectSkillTools([first, second])).toEqual(["ask_user"]);
    expect(first.requiredOutputs).toContain("MVP_SCOPE.md");
  });
});
