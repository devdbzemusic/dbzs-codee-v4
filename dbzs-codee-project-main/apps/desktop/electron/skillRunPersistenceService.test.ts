import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActiveSkillCapsule,
  CodeeSkillManifestV1,
  SkillRun
} from "../src/runtime/skill/skillContracts";
import { SkillRunPersistenceService } from "./skillRunPersistenceService";

const roots: string[] = [];

function workspace(): string {
  const value = mkdtempSync(path.join(os.tmpdir(), "dbzs-skill-run-"));
  roots.push(value);
  return value;
}

const manifest = {
  schemaVersion: "1.0",
  id: "mvp-builder",
  kind: "skill",
  name: "MVP Builder",
  version: "1.0.0",
  description: "MVP",
  mode: "planning",
  targetAgents: ["planner"],
  activation: { intents: [] },
  preconditions: [],
  effects: [],
  domains: [],
  cost: "low",
  latency: "fast",
  riskLevel: "low",
  sideEffects: [],
  idempotent: true,
  permissions: {
    allowedTools: ["write_skill_artifact"],
    requiredTools: ["write_skill_artifact"],
    mayReadFiles: false,
    mayWriteFiles: false,
    mayRunCommands: false,
    mayInstallDependencies: false,
    mayUseNetwork: false
  },
  compatibility: { requires: [], conflictsWith: [], composesWith: [], enables: [] },
  successSignals: [],
  failureSignals: [],
  observability: { logs: [], metrics: [] }
} satisfies CodeeSkillManifestV1;

function run(): SkillRun {
  return {
    id: "skill-test-run",
    skillId: "mvp-builder",
    skillVersion: "1.0.0",
    runId: "chat-run",
    status: "running",
    selectedAgent: "planner",
    activatedAt: new Date().toISOString(),
    preconditions: [],
    artifacts: [],
    events: [],
    metrics: {},
    artifactWriteApproved: false
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SkillRunPersistenceService", () => {
  it("persists, resumes and writes only approved run artifacts", async () => {
    const root = workspace();
    const service = new SkillRunPersistenceService();
    const skillRun = run();
    await service.save(root, skillRun, manifest, [] as ActiveSkillCapsule[], "# Skill");
    expect((await service.list(root))[0]?.id).toBe(skillRun.id);
    await expect(service.writeArtifact(root, {
      skillRunId: skillRun.id,
      relativePath: "MVP_SCOPE.md",
      content: "# Scope",
      mediaType: "text/markdown"
    })).rejects.toThrow(/NOT_APPROVED/);
    await service.approveArtifactWrites(root, skillRun.id);
    const artifact = await service.writeArtifact(root, {
      skillRunId: skillRun.id,
      relativePath: "MVP_SCOPE.md",
      content: "# Scope",
      mediaType: "text/markdown"
    });
    expect(artifact.relativePath).toBe("MVP_SCOPE.md");
    expect((await service.read(root, skillRun.id))?.artifacts).toHaveLength(1);
  });

  it("blocks traversal and invalid JSON", async () => {
    const root = workspace();
    const service = new SkillRunPersistenceService();
    const skillRun = run();
    skillRun.artifactWriteApproved = true;
    await service.save(root, skillRun, manifest, [], "# Skill");
    await expect(service.writeArtifact(root, {
      skillRunId: skillRun.id,
      relativePath: "../escape.md",
      content: "x",
      mediaType: "text/markdown"
    })).rejects.toThrow(/PATH_INVALID/);
    await expect(service.writeArtifact(root, {
      skillRunId: skillRun.id,
      relativePath: "bad.json",
      content: "{",
      mediaType: "application/json"
    })).rejects.toThrow();
  });
});
