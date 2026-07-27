import type { ModelTargetAgent } from "@dbzs/shared";
import {
  getLoadedSkill,
  listLoadedSkills,
  saveEnabledSkillPreferences
} from "@/services/skillsLoader";

export interface RuntimeChatSkill {
  id: string;
  label: string;
  description: string;
  targetAgent: ModelTargetAgent;
  systemPrompt: string;
  version?: string;
  mode?: string;
  riskLevel?: string;
  trusted?: boolean;
}

export const RUNTIME_CHAT_SKILLS: RuntimeChatSkill[] = [];

export function loadEnabledSkillIds(): string[] {
  return listLoadedSkills().filter((skill) => skill.enabled).map((skill) => skill.id);
}

export function saveEnabledSkillIds(ids: string[]): void {
  saveEnabledSkillPreferences(ids);
}

export function buildSkillSystemMessages(skillIds: string[]): string[] {
  return skillIds
    .map((skillId) => getLoadedSkill(skillId)?.systemPrompt)
    .filter((prompt): prompt is string => Boolean(prompt));
}

export function resolveSkillTargetAgent(
  skillIds: string[],
  fallback: ModelTargetAgent
): ModelTargetAgent {
  const active = skillIds
    .map((skillId) => getLoadedSkill(skillId))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  return active.length === 1 ? active[0].targetAgent : fallback;
}

export function listRuntimeChatSkills(): RuntimeChatSkill[] {
  return listLoadedSkills().map((skill) => ({
    id: skill.id,
    label: skill.label,
    description: skill.description,
    targetAgent: skill.targetAgent,
    systemPrompt: skill.systemPrompt,
    version: skill.version,
    mode: skill.mode,
    riskLevel: skill.riskLevel,
    trusted: skill.trusted
  }));
}
