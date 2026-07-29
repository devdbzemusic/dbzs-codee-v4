import { Button, RiskBadge, SectionCard } from "@/components/ui";
import type { RuntimeChatPresetId } from "@/stores/commandPaletteStore";
import type { RuntimeChatSkill } from "@/services/runtimeChatSkills";

interface RuntimeChatCapabilitiesOverlayProps {
  open: boolean;
  presetEntries: Array<{
    id: RuntimeChatPresetId;
    label: string;
    description: string;
  }>;
  skills: RuntimeChatSkill[];
  onClose: () => void;
  onSelectPreset: (preset: RuntimeChatPresetId) => void;
}

const CHAT_MODE_EXPLANATIONS = [
  { label: "Automatisch", description: "Gut für normale Aufgaben. Codee wählt selbst, wie viel Agentik nötig ist." },
  { label: "Als Agent", description: "Nützlich für echte Umsetzungsarbeit mit längeren Ausführungs- oder Reparaturschritten." }
];

const TOOL_PROFILE_EXPLANATIONS = [
  { label: "Ask", description: "Nur vorsichtige Hilfen und Rückfragen, kaum direkte Ausführung." },
  { label: "Agent", description: "Standard für produktive Arbeit mit sicheren Tools und klaren Freigaben." },
  { label: "Full", description: "Maximale Werkzeugfreiheit. Nur sinnvoll, wenn du bewusst tiefer eingreifen willst." }
];

export function RuntimeChatCapabilitiesOverlay({
  open,
  presetEntries,
  skills,
  onClose,
  onSelectPreset
}: RuntimeChatCapabilitiesOverlayProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/60 px-3 py-4">
      <div className="max-h-full w-full max-w-4xl overflow-y-auto rounded-lg border border-dbzs-border bg-[#091017] p-3 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-dbzs-text">Was kann ich hier tun?</h2>
            <p className="mt-1 text-[11px] leading-5 text-dbzs-muted">
              Diese Ansicht bündelt Presets, Skills und die wichtigsten Modus-Erklärungen an einer Stelle.
            </p>
          </div>
          <Button onClick={onClose}>Schließen</Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <SectionCard
            title="Schnellstarts"
            description="Die Presets füllen keine geheimen Magie-Prompts ein, sondern starten nachvollziehbare Standardaufgaben."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {presetEntries.map((preset) => (
                <button
                  className="rounded border border-dbzs-border bg-dbzs-panelSoft/60 p-2 text-left transition-colors hover:border-dbzs-cyan/40 hover:bg-dbzs-cyan/5"
                  key={preset.id}
                  onClick={() => onSelectPreset(preset.id)}
                  type="button"
                >
                  <div className="text-[11px] font-medium text-dbzs-text">{preset.label}</div>
                  <div className="mt-1 text-[10px] leading-4 text-dbzs-muted">{preset.description}</div>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Modi und Werkzeugrechte"
            description="Damit die Begriffe im Composer selbsterklärend bleiben."
          >
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-dbzs-muted">
                  Gesprächsmodus
                </div>
                <div className="space-y-2">
                  {CHAT_MODE_EXPLANATIONS.map((item) => (
                    <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5" key={item.label}>
                      <div className="text-[11px] font-medium text-dbzs-text">{item.label}</div>
                      <div className="mt-0.5 text-[10px] leading-4 text-dbzs-muted">{item.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-dbzs-muted">
                  Werkzeugrechte
                </div>
                <div className="space-y-2">
                  {TOOL_PROFILE_EXPLANATIONS.map((item) => (
                    <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5" key={item.label}>
                      <div className="text-[11px] font-medium text-dbzs-text">{item.label}</div>
                      <div className="mt-0.5 text-[10px] leading-4 text-dbzs-muted">{item.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5 text-[10px] leading-4 text-dbzs-muted">
                <span className="font-medium text-dbzs-text">Kontext-Checkbox:</span> Wenn aktiv, darf Codee aktuelle Datei,
                Workspace und gefundene Mentions mitdenken. Wenn aus, bleibt die Anfrage bewusst knapper.
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="mt-3">
          <SectionCard
            title="Aktivierbare Skills"
            description="Skills erweitern das Verhalten des Chats. Sie bleiben getrennt von den Presets, weil sie dauerhaftes Verhalten und nicht nur eine einzelne Anfrage beeinflussen."
          >
            {skills.length === 0 ? (
              <div className="text-[10px] text-dbzs-muted">Aktuell keine Skills geladen.</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {skills.map((skill) => (
                  <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 p-2" key={skill.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-dbzs-text">{skill.label}</div>
                        <div className="mt-0.5 text-[10px] text-dbzs-muted">{skill.targetAgent}</div>
                      </div>
                      <RiskBadge label={skill.riskLevel ?? "medium"} />
                    </div>
                    <div className="mt-2 text-[10px] leading-4 text-dbzs-muted">{skill.description}</div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
