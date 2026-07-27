import type { ModelTargetAgent } from "@dbzs/shared";
import { buildSkillCapsule, formatSkillCapsule } from "@/runtime/skill/skillCapsule";
import type {
  CodeeSkillPackage,
  SkillLoadFailure,
  SkillRegistrySnapshot
} from "@/runtime/skill/skillContracts";
import {
  createSkillPackage,
  SkillPackageError
} from "@/runtime/skill/skillManifest";
import { skillRegistry } from "@/runtime/skill/skillRegistry";

const MANIFEST_MODULES = import.meta.glob("../skills/**/manifest.yaml", {
  query: "?raw", import: "default", eager: true
}) as Record<string, string>;
const INSTRUCTION_MODULES = import.meta.glob("../skills/**/SKILL.md", {
  query: "?raw", import: "default", eager: true
}) as Record<string, string>;
const README_MODULES = import.meta.glob("../skills/**/README.md", {
  query: "?raw", import: "default", eager: true
}) as Record<string, string>;

const ENABLED_KEY = "dbzs-skill-runtime-enabled-v1";

export interface LoadedSkill {
  id: string;
  label: string;
  description: string;
  targetAgent: ModelTargetAgent;
  systemPrompt: string;
  sourcePath: string;
  allowedTools?: string[];
  version: string;
  mode: CodeeSkillPackage["manifest"]["mode"];
  riskLevel: CodeeSkillPackage["manifest"]["riskLevel"];
  trusted: boolean;
  enabled: boolean;
}

function siblingPath(manifestPath: string, fileName: string): string {
  return manifestPath.replace(/manifest\.yaml$/, fileName);
}

function loadEnabledPreferences(): string[] {
  if (typeof localStorage === "undefined") return ["workspace"];
  try {
    const parsed = JSON.parse(localStorage.getItem(ENABLED_KEY) ?? "[\"workspace\"]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : ["workspace"];
  } catch {
    return ["workspace"];
  }
}

export function saveEnabledSkillPreferences(ids: string[]): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(ENABLED_KEY, JSON.stringify(ids));
}

function loadBundledPackages(): { packages: CodeeSkillPackage[]; failures: SkillLoadFailure[] } {
  const packages: CodeeSkillPackage[] = [];
  const failures: SkillLoadFailure[] = [];
  for (const [manifestPath, manifestRaw] of Object.entries(MANIFEST_MODULES)) {
    const source = { type: "bundled" as const, path: manifestPath };
    try {
      const instructions = INSTRUCTION_MODULES[siblingPath(manifestPath, "SKILL.md")];
      if (instructions == null) throw new SkillPackageError("instructions_missing", "SKILL.md is missing.");
      packages.push(createSkillPackage({
        manifestRaw,
        instructions,
        readme: README_MODULES[siblingPath(manifestPath, "README.md")],
        source
      }));
    } catch (error) {
      failures.push({
        code: error instanceof SkillPackageError ? error.code : "manifest_invalid",
        source,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { packages, failures };
}

const bundled = loadBundledPackages();
skillRegistry.replace(bundled.packages, bundled.failures, {
  enabledSkillIds: loadEnabledPreferences()
});

export async function reloadSkillRegistry(workspaceRoot?: string): Promise<SkillRegistrySnapshot> {
  let external: Awaited<ReturnType<NonNullable<typeof window.dbzs.reloadSkillPackages>>> = {
    packages: [],
    failures: []
  };
  if (typeof window !== "undefined" && window.dbzs?.reloadSkillPackages) {
    external = await window.dbzs.reloadSkillPackages(workspaceRoot);
  }
  return skillRegistry.replace(
    [...bundled.packages, ...external.packages],
    [...bundled.failures, ...external.failures],
    { enabledSkillIds: loadEnabledPreferences() }
  );
}

export function listLoadedSkills(): LoadedSkill[] {
  return skillRegistry.list().map((entry) => {
    const capsule = buildSkillCapsule(entry.skill);
    return {
      id: entry.skill.manifest.id,
      label: entry.skill.manifest.name,
      description: entry.skill.manifest.description,
      targetAgent: capsule.targetAgent,
      systemPrompt: formatSkillCapsule(capsule),
      sourcePath: entry.skill.source.path,
      allowedTools: entry.skill.manifest.permissions.allowedTools,
      version: entry.skill.manifest.version,
      mode: entry.skill.manifest.mode,
      riskLevel: entry.skill.manifest.riskLevel,
      trusted: entry.trusted,
      enabled: entry.enabled
    };
  });
}

export function getLoadedSkill(skillId: string): LoadedSkill | undefined {
  return listLoadedSkills().find((skill) => skill.id === skillId);
}

export function getSkillPackage(skillId: string): CodeeSkillPackage | undefined {
  return skillRegistry.get(skillId)?.skill;
}

export function setSkillEnabled(skillId: string, enabled: boolean): void {
  if (enabled) skillRegistry.enable(skillId);
  else skillRegistry.disable(skillId);
  saveEnabledSkillPreferences(
    skillRegistry.list().filter((entry) => entry.enabled).map((entry) => entry.skill.manifest.id)
  );
}

export function getSkillRegistrySnapshot(): SkillRegistrySnapshot {
  return skillRegistry.getSnapshot();
}
