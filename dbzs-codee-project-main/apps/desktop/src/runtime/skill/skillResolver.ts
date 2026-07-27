import type {
  CodeeSkillManifestV1,
  SkillPreconditionResult,
  SkillRegistryEntry,
  SkillResolutionContext,
  SkillResolutionDecision
} from "@/runtime/skill/skillContracts";

const RISKY_LEVELS = new Set(["medium", "high", "critical"]);

function explicitMention(message: string, manifest: CodeeSkillManifestV1): boolean {
  const text = message.toLowerCase();
  const id = manifest.id.toLowerCase();
  const name = manifest.name.toLowerCase();
  return (
    text.includes(`@${id}`) ||
    text.includes(`/skill ${id}`) ||
    text.includes(`skill ${id}`) ||
    text.includes(`skill "${name}"`) ||
    text.includes(`skill „${name}“`)
  );
}

function intentMatches(context: SkillResolutionContext, manifest: CodeeSkillManifestV1): boolean {
  const intent = context.executionIntent.toLowerCase();
  const task = context.activeTaskType?.toLowerCase();
  return manifest.activation.intents.some(
    (candidate) => candidate.toLowerCase() === intent || candidate.toLowerCase() === task
  );
}

function keywordMatches(message: string, manifest: CodeeSkillManifestV1): boolean {
  const text = message.toLowerCase();
  return (manifest.activation.keywords ?? []).some((keyword) =>
    text.includes(keyword.toLowerCase())
  );
}

function requiredPreconditionsPassed(
  manifest: CodeeSkillManifestV1,
  results: SkillPreconditionResult[]
): boolean {
  const byId = new Map(results.map((result) => [result.preconditionId, result]));
  return manifest.preconditions
    .filter((condition) => condition.required)
    .every((condition) => byId.get(condition.id)?.passed === true);
}

export function resolveSkills(
  entries: SkillRegistryEntry[],
  context: SkillResolutionContext,
  preconditions: Record<string, SkillPreconditionResult[]> = {}
): SkillResolutionDecision {
  const selected = new Set<string>();
  const suggested = new Set<string>();
  const rejected: SkillResolutionDecision["rejected"] = [];
  const conflicts: SkillResolutionDecision["conflicts"] = [];
  const enabled = new Set(context.enabledSkillIds);

  for (const entry of entries) {
    const manifest = entry.skill.manifest;
    const explicit = explicitMention(context.userMessage, manifest);
    const matches = intentMatches(context, manifest) || keywordMatches(context.userMessage, manifest);
    if (!explicit && !matches) continue;

    if (!requiredPreconditionsPassed(manifest, preconditions[manifest.id] ?? [])) {
      rejected.push({ skillId: manifest.id, reason: "required_precondition_failed" });
      continue;
    }
    if (context.activeAgent && !manifest.targetAgents.includes(context.activeAgent)) {
      rejected.push({ skillId: manifest.id, reason: "agent_incompatible" });
      continue;
    }
    if (explicit && (entry.trusted || enabled.has(manifest.id))) {
      selected.add(manifest.id);
      continue;
    }
    if (!enabled.has(manifest.id)) {
      suggested.add(manifest.id);
      continue;
    }
    if (
      manifest.mode === "execution" ||
      RISKY_LEVELS.has(manifest.riskLevel) ||
      manifest.activation.explicitOnly
    ) {
      rejected.push({ skillId: manifest.id, reason: "explicit_activation_required" });
      continue;
    }
    if (manifest.activation.autoSuggest) suggested.add(manifest.id);
  }

  const selectedEntries = entries.filter((entry) => selected.has(entry.skill.manifest.id));
  for (let index = 0; index < selectedEntries.length; index += 1) {
    for (let rightIndex = index + 1; rightIndex < selectedEntries.length; rightIndex += 1) {
      const left = selectedEntries[index]!.skill.manifest;
      const right = selectedEntries[rightIndex]!.skill.manifest;
      const isConflict =
        left.compatibility.conflictsWith.includes(right.id) ||
        right.compatibility.conflictsWith.includes(left.id) ||
        !left.compatibility.composesWith.includes(right.id) ||
        !right.compatibility.composesWith.includes(left.id) ||
        !left.targetAgents.some((agent) => right.targetAgents.includes(agent));
      if (isConflict) {
        conflicts.push({ leftSkillId: left.id, rightSkillId: right.id });
        selected.delete(right.id);
        rejected.push({ skillId: right.id, reason: `conflicts_with:${left.id}` });
      }
    }
  }

  return {
    selectedSkillIds: [...selected],
    suggestedSkillIds: [...suggested].filter((id) => !selected.has(id)),
    rejected,
    conflicts
  };
}
