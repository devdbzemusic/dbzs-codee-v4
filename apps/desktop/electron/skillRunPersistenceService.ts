/*
 * DBZS – Division By Zeros
 * Datei: skillRunPersistenceService.ts
 * Bereich: Electron / Skill Runtime
 *
 * Zweck:
 *   Persistiert Skill Runs und kontrollierte Artefakte atomar im Workspace.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ActiveSkillCapsule,
  CodeeSkillManifestV1,
  SkillArtifactReference,
  SkillArtifactWriteRequest,
  SkillRun,
  SkillRunValidation
} from "../src/runtime/skill/skillContracts";
import { writeFileAtomic } from "./atomicFileWrite";
import { resolveCanonicalWorkspacePath } from "./workspacePathGuard";

const ARTIFACT_LIMIT_BYTES = 256 * 1024;
const SECRET_PATTERN = /(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s"',}]+)/gi;

function redact(value: string): string {
  return value.replace(SECRET_PATTERN, "$1=[redacted]");
}

function safeRunId(runId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/.test(runId)) {
    throw new Error("[SKILL_RUN_INVALID] Invalid skill run id.");
  }
  return runId;
}

function safeArtifactPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*\.(md|json)$/i.test(normalized)
  ) {
    throw new Error("[SKILL_ARTIFACT_PATH_INVALID] Unsafe artifact path.");
  }
  return normalized;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await writeFileAtomic(filePath, redact(content));
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export class SkillRunPersistenceService {
  private async root(workspaceRoot: string, skillRunId: string): Promise<string> {
    return resolveCanonicalWorkspacePath(
      workspaceRoot,
      path.join(workspaceRoot, ".codee", "skill-runs", safeRunId(skillRunId)),
      { allowMissing: true }
    );
  }

  async save(
    workspaceRoot: string,
    run: SkillRun,
    manifest: CodeeSkillManifestV1,
    capsules: ActiveSkillCapsule[],
    instructions: string,
    validation?: SkillRunValidation
  ): Promise<void> {
    const root = await this.root(workspaceRoot, run.id);
    await atomicJson(path.join(root, "skill-run.json"), run);
    await atomicJson(path.join(root, "manifest.snapshot.json"), manifest);
    await atomicJson(path.join(root, "capsule.json"), capsules);
    await atomicJson(path.join(root, "preconditions.json"), run.preconditions);
    await atomicJson(path.join(root, "artifacts.json"), run.artifacts);
    await atomicWrite(path.join(root, "SKILL_REFERENCE.md"), instructions);
    if (validation) await atomicJson(path.join(root, "validation.json"), validation);
    await atomicWrite(
      path.join(root, "SKILL_RESULT.md"),
      [
        `# Skill Result — ${run.skillId}`,
        "",
        `Status: ${run.status}`,
        `Artefakte: ${run.artifacts.length}`,
        `Erfolgssignale: ${validation?.successSignalsMet.length ?? 0}`,
        `Fehlende Signale: ${validation?.successSignalsMissing.length ?? 0}`,
        ""
      ].join("\n")
    );
  }

  async read(workspaceRoot: string, skillRunId: string): Promise<SkillRun | null> {
    try {
      const root = await this.root(workspaceRoot, skillRunId);
      return JSON.parse(await fs.readFile(path.join(root, "skill-run.json"), "utf8")) as SkillRun;
    } catch {
      return null;
    }
  }

  async list(workspaceRoot: string): Promise<SkillRun[]> {
    const parent = await resolveCanonicalWorkspacePath(
      workspaceRoot,
      path.join(workspaceRoot, ".codee", "skill-runs"),
      { allowMissing: true }
    );
    const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
    const runs = await Promise.all(
      entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => this.read(workspaceRoot, entry.name))
    );
    return runs.filter((run): run is SkillRun => Boolean(run));
  }

  async writeArtifact(
    workspaceRoot: string,
    request: SkillArtifactWriteRequest
  ): Promise<SkillArtifactReference> {
    if (Buffer.byteLength(request.content, "utf8") > ARTIFACT_LIMIT_BYTES) {
      throw new Error("[SKILL_ARTIFACT_TOO_LARGE] Artifact exceeds 256 KB.");
    }
    const run = await this.read(workspaceRoot, request.skillRunId);
    if (!run || !run.artifactWriteApproved || !["running", "validating"].includes(run.status)) {
      throw new Error("[SKILL_ARTIFACT_NOT_APPROVED] Active approved skill run required.");
    }
    const relativePath = safeArtifactPath(request.relativePath);
    if (
      (request.mediaType === "application/json" && !relativePath.endsWith(".json")) ||
      (request.mediaType === "text/markdown" && !relativePath.endsWith(".md"))
    ) {
      throw new Error("[SKILL_ARTIFACT_MEDIA_MISMATCH] Extension does not match media type.");
    }
    if (request.mediaType === "application/json") JSON.parse(request.content);
    const root = await this.root(workspaceRoot, request.skillRunId);
    const artifactsRoot = path.join(root, "artifacts");
    const target = await resolveCanonicalWorkspacePath(
      artifactsRoot,
      path.join(artifactsRoot, relativePath),
      { allowMissing: true }
    ).catch(async () => {
      await fs.mkdir(artifactsRoot, { recursive: true });
      return resolveCanonicalWorkspacePath(artifactsRoot, path.join(artifactsRoot, relativePath), {
        allowMissing: true
      });
    });
    await atomicWrite(target, request.content);
    const reference: SkillArtifactReference = {
      relativePath,
      mediaType: request.mediaType,
      bytes: Buffer.byteLength(request.content, "utf8"),
      createdAt: new Date().toISOString()
    };
    run.artifacts = [
      ...run.artifacts.filter((artifact) => artifact.relativePath !== relativePath),
      reference
    ];
    run.metrics.skill_artifact_count = run.artifacts.length;
    await atomicJson(path.join(root, "skill-run.json"), run);
    await atomicJson(path.join(root, "artifacts.json"), run.artifacts);
    return reference;
  }

  async approveArtifactWrites(workspaceRoot: string, skillRunId: string): Promise<SkillRun> {
    const run = await this.read(workspaceRoot, skillRunId);
    if (!run || !["running", "awaiting_user"].includes(run.status)) {
      throw new Error("[SKILL_RUN_INVALID] Running skill run required.");
    }
    run.artifactWriteApproved = true;
    if (run.status === "awaiting_user") run.status = "running";
    const root = await this.root(workspaceRoot, skillRunId);
    await atomicJson(path.join(root, "skill-run.json"), run);
    return run;
  }

  async setStatus(
    workspaceRoot: string,
    skillRunId: string,
    status: "awaiting_user" | "cancelled"
  ): Promise<SkillRun> {
    const run = await this.read(workspaceRoot, skillRunId);
    if (!run || ["completed", "completed_with_warnings", "failed"].includes(run.status)) {
      throw new Error("[SKILL_RUN_INVALID] Resumable skill run required.");
    }
    run.status = status;
    run.finishedAt = status === "cancelled" ? new Date().toISOString() : undefined;
    run.events.push({
      type: status === "cancelled" ? "skill.run.failed" : "skill.run.started",
      timestamp: new Date().toISOString(),
      detail: status
    });
    const root = await this.root(workspaceRoot, skillRunId);
    await atomicJson(path.join(root, "skill-run.json"), run);
    return run;
  }
}
