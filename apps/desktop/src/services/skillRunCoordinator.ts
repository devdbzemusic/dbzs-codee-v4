import { workspaceScopeId, type ModelTargetAgent } from "@dbzs/shared";
import type { AgentToolProfile } from "@/runtime/agent/agentToolProfile";
import { allowedToolsForProfile } from "@/runtime/agent/agentToolProfile";
import {
  buildSkillCapsule,
  intersectSkillTools
} from "@/runtime/skill/skillCapsule";
import type {
  ActiveSkillRuntimeContext,
  CodeeSkillPackage,
  SkillPreconditionResult,
  SkillRun,
  SkillRunValidation,
  SkillToolName
} from "@/runtime/skill/skillContracts";
import { evaluateSkillPreconditions } from "@/runtime/skill/skillPreconditions";
import { resolveSkills } from "@/runtime/skill/skillResolver";
import {
  getSkillPackage,
  getSkillRegistrySnapshot
} from "@/services/skillsLoader";
import { getRuntimeKernel } from "@/services/runtimeKernelService";

async function emitSkillEvents(run: SkillRun, fromIndex = 0): Promise<void> {
  for (const event of run.events.slice(fromIndex)) {
    await getRuntimeKernel().events.emit("skill-runtime", event.type, {
      skillRunId: run.id,
      skillId: run.skillId,
      detail: event.detail
    });
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `skill-${crypto.randomUUID()}`;
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

async function pathExists(workspaceRoot: string, relativePath: string): Promise<boolean> {
  try {
    const normalized = relativePath.replace(/^[/\\]+/, "");
    const separator = workspaceRoot.endsWith("/") || workspaceRoot.endsWith("\\") ? "" : "/";
    return Boolean(await window.dbzs.readProjectFile?.(`${workspaceRoot}${separator}${normalized}`));
  } catch {
    return false;
  }
}

export async function prepareSkillRuntime(input: {
  userMessage: string;
  executionIntent: string;
  workspaceRoot?: string;
  activeFile?: string;
  activeTaskType?: string;
  targetAgent: ModelTargetAgent;
  enabledSkillIds: string[];
  profile: AgentToolProfile;
  toolsEnabled: boolean;
  runtimeRunId: string;
}): Promise<ActiveSkillRuntimeContext | null> {
  const snapshot = getSkillRegistrySnapshot();
  const preconditions: Record<string, SkillPreconditionResult[]> = {};
  for (const entry of snapshot.entries) {
    preconditions[entry.skill.manifest.id] = await evaluateSkillPreconditions(
      entry.skill.manifest.preconditions,
      {
        userMessage: input.userMessage,
        workspaceRoot: input.workspaceRoot,
        pathExists
      }
    );
  }
  const decision = resolveSkills(snapshot.entries, {
    userMessage: input.userMessage,
    executionIntent: input.executionIntent,
    workspaceRoot: input.workspaceRoot,
    activeFile: input.activeFile,
    activeTaskType: input.activeTaskType,
    enabledSkillIds: input.enabledSkillIds
  }, preconditions);
  const packages = decision.selectedSkillIds
    .map(getSkillPackage)
    .filter((skill): skill is CodeeSkillPackage => Boolean(skill));
  if (packages.length === 0) return null;

  const commonAgent = packages[0].manifest.targetAgents.find((agent) =>
    packages.every((skill) => skill.manifest.targetAgents.includes(agent))
  );
  if (!commonAgent) return null;
  const capsules = packages.map((skill) => buildSkillCapsule(skill, commonAgent));
  const skillTools = intersectSkillTools(capsules);
  const effectiveAllowedTools = input.toolsEnabled
    ? allowedToolsForProfile(input.profile)
      .filter((tool) => skillTools.includes(tool as SkillToolName)) as SkillToolName[]
    : [];
  const requiredTools = [...new Set(capsules.flatMap((capsule) => capsule.requiredTools))];
  const missing = requiredTools.filter((tool) => !effectiveAllowedTools.includes(tool));
  const now = new Date().toISOString();
  const resumable = input.workspaceRoot
    ? (await window.dbzs.listSkillRuns?.(input.workspaceRoot))
      ?.filter((candidate) =>
        candidate.skillId === packages[0].manifest.id &&
        candidate.status === "awaiting_user"
      )
      .sort((left, right) => right.activatedAt.localeCompare(left.activatedAt))[0]
    : undefined;
  const run: SkillRun = resumable ? {
    ...resumable,
    status: missing.length > 0 ? "blocked" : "running",
    finishedAt: missing.length > 0 ? now : undefined,
    events: [
      ...resumable.events,
      { type: "skill.run.started", timestamp: now, detail: "resumed" }
    ]
  } : {
    id: createId(),
    skillId: packages[0].manifest.id,
    skillVersion: packages[0].manifest.version,
    workspaceId: input.workspaceRoot ? workspaceScopeId(input.workspaceRoot) : undefined,
    runId: input.runtimeRunId,
    goal: input.userMessage,
    status: missing.length > 0 ? "blocked" : "running",
    selectedAgent: commonAgent,
    activatedAt: now,
    finishedAt: missing.length > 0 ? now : undefined,
    preconditions: packages.flatMap((skill) => preconditions[skill.manifest.id] ?? []),
    artifacts: [],
    events: [
      { type: "skill.resolution.started", timestamp: now },
      { type: "skill.resolution.completed", timestamp: now },
      { type: "skill.preconditions.started", timestamp: now },
      { type: "skill.preconditions.completed", timestamp: now },
      {
        type: missing.length > 0 ? "skill.run.failed" : "skill.run.started",
        timestamp: now,
        detail: missing.length > 0 ? `Missing tools: ${missing.join(", ")}` : undefined
      }
    ],
    metrics: {
      skill_artifact_count: 0,
      skill_success_signal_count: 0,
      skill_failure_signal_count: 0,
      skill_tool_call_count: 0,
      skill_policy_violation_count: 0
    },
    artifactWriteApproved: false
  };
  if (input.workspaceRoot && window.dbzs.saveSkillRun) {
    await window.dbzs.saveSkillRun(
      input.workspaceRoot,
      run,
      packages[0].manifest,
      capsules,
      packages[0].instructions
    );
  }
  await emitSkillEvents(run, resumable?.events.length ?? 0);
  if (missing.length > 0) throw new Error(`[SKILL_REQUIRED_TOOL_MISSING] ${missing.join(", ")}`);
  return { run, capsules, effectiveAllowedTools, requiredTools };
}

async function readArtifact(
  workspaceRoot: string,
  skillRunId: string,
  fileName: string
): Promise<string | null> {
  try {
    const root = workspaceRoot.replace(/[\\/]+$/, "");
    return (await window.dbzs.readProjectFile?.(
      `${root}/.codee/skill-runs/${skillRunId}/artifacts/${fileName}`
    ))?.content ?? null;
  } catch {
    return null;
  }
}

export async function validateAndFinishSkillRun(
  workspaceRoot: string,
  context: ActiveSkillRuntimeContext,
  failed = false
): Promise<SkillRun> {
  const persisted = (await window.dbzs.listSkillRuns?.(workspaceRoot))
    ?.find((run) => run.id === context.run.id) ?? context.run;
  const packageValue = getSkillPackage(persisted.skillId);
  if (!packageValue) return persisted;
  const met: string[] = [];
  const missing: string[] = [];
  const failures: string[] = [];
  let requiredArtifactsPresent = true;

  if (persisted.skillId === "mvp-builder") {
    const names = ["MVP_SCOPE.md", "FEATURE_MATRIX.json", "VALIDATION_PLAN.md", "ASSUMPTIONS.json"];
    const contents = await Promise.all(names.map((name) => readArtifact(workspaceRoot, persisted.id, name)));
    requiredArtifactsPresent = contents.every(Boolean);
    const combined = contents.filter(Boolean).join("\n").toLowerCase();
    const checks: Array<[string, RegExp]> = [
      ["riskiest_assumption", /riskant|riskiest|assumption|annahme/],
      ["mvp_pattern", /concierge|wizard|landing|single-feature|piecemeal/],
      ["feature_priorities", /\bp0\b[\s\S]*\bp1\b[\s\S]*\bp2\b[\s\S]*(out.of.scope|außerhalb)/],
      ["validation_metrics", /metrik|metric|messbar/],
      ["success_criteria", /erfolgskriter|success criter/]
    ];
    for (const [id, pattern] of checks) (pattern.test(combined) ? met : missing).push(id);
    if (!/metrik|metric|messbar/.test(combined)) failures.push("missing_metrics");
    if (!/riskant|riskiest|assumption|annahme/.test(combined)) failures.push("missing_assumption");
  } else {
    missing.push(
      ...packageValue.manifest.successSignals
        .filter((signal) => signal.required)
        .map((signal) => signal.id)
    );
  }

  const validation: SkillRunValidation = {
    preconditionsPassed: persisted.preconditions
      .every((result) => result.passed || !packageValue.manifest.preconditions
        .find((condition) => condition.id === result.preconditionId)?.required),
    requiredArtifactsPresent,
    successSignalsMet: met,
    successSignalsMissing: missing,
    failureSignalsDetected: failures,
    outcome: failed
      ? "failed"
      : requiredArtifactsPresent && missing.length === 0 && failures.length === 0
        ? "completed"
        : "completed_with_warnings"
  };
  persisted.validation = validation;
  persisted.status = validation.outcome;
  persisted.finishedAt = new Date().toISOString();
  persisted.events.push({
    type: "skill.validation.completed",
    timestamp: persisted.finishedAt
  }, {
    type: validation.outcome === "failed" ? "skill.run.failed" : "skill.run.completed",
    timestamp: persisted.finishedAt
  });
  persisted.metrics.skill_success_signal_count = met.length;
  persisted.metrics.skill_failure_signal_count = failures.length;
  await window.dbzs.saveSkillRun?.(
    workspaceRoot,
    persisted,
    packageValue.manifest,
    context.capsules,
    packageValue.instructions,
    validation
  );
  await emitSkillEvents(persisted, Math.max(0, persisted.events.length - 2));
  return persisted;
}
