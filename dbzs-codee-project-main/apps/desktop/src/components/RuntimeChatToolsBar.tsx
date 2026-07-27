import { useEffect, useMemo, useState } from "react";
import { listRuntimeChatSkills } from "@/services/runtimeChatSkills";
import {
  getSkillRegistrySnapshot,
  reloadSkillRegistry
} from "@/services/skillsLoader";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { ToolCapability } from "@/types/orchestration";
import type { SkillRun } from "@/runtime/skill/skillContracts";

export function RuntimeChatToolsBar({ compact = false }: { compact?: boolean }) {
  const {
    availableTools,
    desktopToolNames,
    enabledSkillIds,
    loadToolCatalog,
    toggleSkill,
    toolsEnabled,
    setToolsEnabled
  } = useRuntimeChatStore();

  const workspaceRoot = useWorkspaceStore((state) => state.state.projectPath);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [registryGeneration, setRegistryGeneration] = useState(0);
  const [latestRun, setLatestRun] = useState<SkillRun | null>(null);
  const skills = listRuntimeChatSkills();
  const entries = useMemo(
    () => getSkillRegistrySnapshot().entries,
    [registryGeneration]
  );

  useEffect(() => {
    void loadToolCatalog();
    void reloadSkillRegistry(workspaceRoot ?? undefined).then((snapshot) => {
      setRegistryGeneration(snapshot.generation);
    });
    if (workspaceRoot) {
      void window.dbzs.listSkillRuns?.(workspaceRoot).then((runs) => {
        setLatestRun(
          [...(runs ?? [])].sort((left, right) =>
            right.activatedAt.localeCompare(left.activatedAt)
          )[0] ?? null
        );
      });
    }
  }, [loadToolCatalog, workspaceRoot]);

  const toggleWithTrust = (skillId: string) => {
    const entry = entries.find((candidate) => candidate.skill.manifest.id === skillId);
    const active = enabledSkillIds.includes(skillId);
    if (!active && entry && !entry.trusted) {
      const manifest = entry.skill.manifest;
      const approved = window.confirm(
        [
          `Nicht vertrauenswürdigen Skill „${manifest.name}“ aktivieren?`,
          `Quelle: ${entry.skill.source.type} — ${entry.skill.source.path}`,
          `Risiko: ${manifest.riskLevel}`,
          `Tools: ${manifest.permissions.allowedTools.join(", ") || "(keine)"}`,
          `Side Effects: ${manifest.sideEffects.join(", ") || "(keine)"}`
        ].join("\n")
      );
      if (!approved) return;
    }
    toggleSkill(skillId);
    setRegistryGeneration(getSkillRegistrySnapshot().generation);
  };

  const reload = async () => {
    const snapshot = await reloadSkillRegistry(workspaceRoot ?? undefined);
    setRegistryGeneration(snapshot.generation);
  };

  const importSkill = async () => {
    const imported = await window.dbzs.importSkillPackage?.();
    if (imported) await reload();
  };

  const setRunStatus = async (status: "awaiting_user" | "cancelled") => {
    if (!workspaceRoot || !latestRun || !window.dbzs.setSkillRunStatus) return;
    setLatestRun(await window.dbzs.setSkillRunStatus(workspaceRoot, latestRun.id, status));
  };

  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? "px-2 py-1" : "px-3 py-1.5"} border-b border-dbzs-border bg-dbzs-panelSoft`}>
      <button
        className={`rounded border px-1.5 py-0.5 text-[10px] ${
          toolsEnabled
            ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan"
            : "border-dbzs-border bg-dbzs-bg text-dbzs-muted"
        }`}
        onClick={() => setToolsEnabled(!toolsEnabled)}
        title="Backend-Orchestrierung und Tools"
        type="button"
      >
        Tools {toolsEnabled ? "an" : "aus"}
      </button>

      {skills.map((skill) => {
        const active = enabledSkillIds.includes(skill.id);
        return (
          <button
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              active
                ? "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan"
                : "border-dbzs-border bg-dbzs-bg text-dbzs-muted hover:text-dbzs-text"
            }`}
            key={skill.id}
            onClick={() => toggleWithTrust(skill.id)}
            title={`${skill.description} · ${skill.mode ?? ""} · Risiko ${skill.riskLevel ?? ""}`}
            type="button"
          >
            {skill.label}
          </button>
        );
      })}

      <button
        className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:text-dbzs-text"
        onClick={() => setSkillsOpen((open) => !open)}
        type="button"
      >
        Skills …
      </button>

      {toolsEnabled && (availableTools.length > 0 || desktopToolNames.length > 0) ? (
        <span
          className="ml-auto truncate text-[10px] text-dbzs-muted"
          title={[
            ...availableTools.map((tool) => `backend:${tool.id}`),
            ...desktopToolNames.map((name) => `desktop:${name}`)
          ].join(", ")}
        >
          {availableTools.length} Backend · {desktopToolNames.length} Desktop
        </span>
      ) : null}

      {skillsOpen ? (
        <div className="w-full border border-dbzs-border bg-dbzs-bg p-2 text-[10px] text-dbzs-muted">
          <div className="mb-2 flex gap-2">
            <button className="text-dbzs-cyan" onClick={() => void reload()} type="button">Neu laden</button>
            <button className="text-dbzs-cyan" onClick={() => void importSkill()} type="button">Importieren</button>
            <span className="ml-auto">Generation {registryGeneration}</span>
          </div>
          <div className="space-y-1">
            {entries.map((entry) => {
              const manifest = entry.skill.manifest;
              return (
                <div className="grid grid-cols-[1.4fr_.5fr_.6fr_.5fr_.5fr] gap-2 border-t border-dbzs-border py-1" key={`${manifest.id}-${entry.skill.source.type}`}>
                  <span title={manifest.description}>{manifest.name} {manifest.version}</span>
                  <span>{entry.skill.source.type}</span>
                  <span>{manifest.mode}</span>
                  <span>{manifest.riskLevel}</span>
                  <span>{entry.enabled ? "aktiv" : "inaktiv"} · {entry.trusted ? "trusted" : "untrusted"}</span>
                </div>
              );
            })}
          </div>
          {latestRun ? (
            <div className="mt-2 border-t border-dbzs-border pt-2">
              Run: {latestRun.skillId} · {latestRun.status} · Agent {latestRun.selectedAgent} ·
              Artefakte {latestRun.artifacts.length} · Signale {latestRun.validation?.successSignalsMet.length ?? 0}
              {!["completed", "completed_with_warnings", "failed", "cancelled"].includes(latestRun.status) ? (
                <span className="ml-2">
                  <button className="mr-2 text-dbzs-cyan" onClick={() => void setRunStatus("awaiting_user")} type="button">
                    Fortsetzen
                  </button>
                  <button className="text-red-300" onClick={() => void setRunStatus("cancelled")} type="button">
                    Abbrechen
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolChipList({ tools }: { tools: ToolCapability[] }) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 px-3 py-1">
      {tools.slice(0, 6).map((tool) => (
        <span
          className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted"
          key={tool.id}
          title={tool.description}
        >
          {tool.id.split(".").pop()}
        </span>
      ))}
    </div>
  );
}
