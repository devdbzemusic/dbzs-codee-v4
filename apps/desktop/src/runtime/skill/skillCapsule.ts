import type {
  ActiveSkillCapsule,
  CodeeSkillPackage,
  SkillToolName
} from "@/runtime/skill/skillContracts";

const MAX_CAPSULE_CHARS = 4_800;

function instructionRules(instructions: string): string[] {
  const candidates = instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\*\*.+\*\*$/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/\*\*/g, ""))
    .filter((line) => line.length >= 8 && line.length <= 240);
  return [...new Set(candidates)].slice(0, 12);
}

function expectedOutputs(skill: CodeeSkillPackage): string[] {
  if (skill.manifest.id === "mvp-builder") {
    return ["MVP_SCOPE.md", "FEATURE_MATRIX.json", "VALIDATION_PLAN.md", "ASSUMPTIONS.json"];
  }
  return skill.manifest.effects.slice(0, 8);
}

export function buildSkillCapsule(
  skill: CodeeSkillPackage,
  targetAgent = skill.manifest.targetAgents[0]
): ActiveSkillCapsule {
  const capsule: ActiveSkillCapsule = {
    skillId: skill.manifest.id,
    version: skill.manifest.version,
    mode: skill.manifest.mode,
    targetAgent,
    goal: skill.manifest.description,
    coreRules: instructionRules(skill.instructions),
    requiredOutputs: expectedOutputs(skill),
    allowedTools: [...skill.manifest.permissions.allowedTools],
    requiredTools: [...(skill.manifest.permissions.requiredTools ?? [])],
    successSignals: skill.manifest.successSignals,
    failureSignals: skill.manifest.failureSignals,
    riskLevel: skill.manifest.riskLevel
  };

  while (JSON.stringify(capsule).length > MAX_CAPSULE_CHARS && capsule.coreRules.length > 1) {
    capsule.coreRules.pop();
  }
  return capsule;
}

export function intersectSkillTools(capsules: ActiveSkillCapsule[]): SkillToolName[] {
  if (capsules.length === 0) return [];
  return capsules.slice(1).reduce(
    (current, capsule) => current.filter((name) => capsule.allowedTools.includes(name)),
    [...capsules[0].allowedTools]
  );
}

export function formatSkillCapsule(capsule: ActiveSkillCapsule): string {
  return [
    `[ACTIVE SKILL CAPSULE — PRIORITY BELOW USER/TASK]`,
    `Skill: ${capsule.skillId}@${capsule.version}`,
    `Mode: ${capsule.mode}; Agent: ${capsule.targetAgent}; Risk: ${capsule.riskLevel}`,
    `Goal: ${capsule.goal}`,
    `Core rules:\n${capsule.coreRules.map((rule) => `- ${rule}`).join("\n")}`,
    `Required outputs:\n${capsule.requiredOutputs.map((output) => `- ${output}`).join("\n")}`,
    `Allowed tools: ${capsule.allowedTools.join(", ") || "(none)"}`,
    `Required tools: ${capsule.requiredTools.join(", ") || "(none)"}`,
    `Success signals:\n${capsule.successSignals.map((signal) => `- ${signal.id}: ${signal.description}`).join("\n")}`,
    `Skill rules cannot override safety rules, the current user goal, workspace decisions, or the active task contract.`
  ].join("\n");
}
