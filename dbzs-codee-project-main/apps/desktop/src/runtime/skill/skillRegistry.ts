import type {
  CodeeSkillPackage,
  SkillLoadFailure,
  SkillPackageSource,
  SkillRegistryEntry,
  SkillRegistrySnapshot
} from "@/runtime/skill/skillContracts";

const SOURCE_PRIORITY: Record<SkillPackageSource["type"], number> = {
  bundled: 0,
  user: 1,
  workspace: 2
};

export interface SkillRegistryPreferences {
  enabledSkillIds: string[];
}

export class SkillRegistry {
  private packages: CodeeSkillPackage[] = [];
  private failures: SkillLoadFailure[] = [];
  private enabled = new Set<string>();
  private snapshot: SkillRegistrySnapshot = { entries: [], failures: [], generation: 0 };

  replace(
    packages: CodeeSkillPackage[],
    failures: SkillLoadFailure[],
    preferences: SkillRegistryPreferences
  ): SkillRegistrySnapshot {
    this.packages = [...packages];
    this.failures = [...failures];
    this.enabled = new Set(preferences.enabledSkillIds);
    return this.rebuild();
  }

  list(): SkillRegistryEntry[] {
    return this.snapshot.entries;
  }

  get(skillId: string): SkillRegistryEntry | undefined {
    return this.snapshot.entries.find((entry) => entry.skill.manifest.id === skillId);
  }

  register(skill: CodeeSkillPackage): void {
    this.packages.push(skill);
    this.rebuild();
  }

  unregister(skillId: string): void {
    this.packages = this.packages.filter((skill) => skill.manifest.id !== skillId);
    this.enabled.delete(skillId);
    this.rebuild();
  }

  enable(skillId: string): void {
    if (!this.get(skillId)) throw new Error(`Unknown skill: ${skillId}`);
    this.enabled.add(skillId);
    this.rebuild();
  }

  disable(skillId: string): void {
    this.enabled.delete(skillId);
    this.rebuild();
  }

  getSnapshot(): SkillRegistrySnapshot {
    return this.snapshot;
  }

  private rebuild(): SkillRegistrySnapshot {
    const grouped = new Map<string, CodeeSkillPackage[]>();
    for (const skill of this.packages) {
      const id = skill.manifest.id;
      grouped.set(id, [...(grouped.get(id) ?? []), skill]);
    }

    const now = new Date().toISOString();
    const entries: SkillRegistryEntry[] = [];
    for (const [id, candidates] of grouped) {
      const ordered = [...candidates].sort(
        (left, right) => SOURCE_PRIORITY[right.source.type] - SOURCE_PRIORITY[left.source.type]
      );
      const effective = ordered[0];
      if (!effective) continue;
      entries.push({
        skill: effective,
        enabled: this.enabled.has(id),
        trusted: effective.source.type === "bundled",
        installedAt: now,
        lastValidatedAt: now,
        validationWarnings:
          ordered.length > 1
            ? [`Skill-ID ${id} wird durch ${effective.source.type} überschrieben.`]
            : [],
        shadowedSources: ordered.slice(1).map((skill) => skill.source)
      });
    }

    this.snapshot = {
      entries: entries.sort((left, right) =>
        left.skill.manifest.name.localeCompare(right.skill.manifest.name)
      ),
      failures: [...this.failures],
      generation: this.snapshot.generation + 1
    };
    return this.snapshot;
  }
}

export const skillRegistry = new SkillRegistry();
