/**
 * DesignTokenPreview — Entwicklungs-Referenz für das Neural Workbench Design System.
 * Rendert alle CSS-Custom-Properties aus tokens.css visuell, damit Designer und
 * Entwickler Abweichungen sofort erkennen.
 *
 * Nur für Entwicklungszwecke — nicht in der Produktion verwenden.
 */

import { RAIL_REGISTRY } from "@/components/workbench/ActivityRail";
import { WorkbenchStatusBadge, type UiStatusTone } from "@/components/workbench/WorkbenchStatusBadge";
import { TabStrip } from "@/components/workbench/primitives/TabStrip";
import { EmptyState } from "@/components/workbench/primitives/EmptyState";
import { IconButton } from "@/components/workbench/primitives/PanelPrimitives";
import { useState } from "react";

const PALETTE_VARS = [
  "--dbzs-bg",
  "--dbzs-panel",
  "--dbzs-panelSoft",
  "--dbzs-border",
  "--dbzs-text",
  "--dbzs-muted",
  "--dbzs-cyan",
  "--dbzs-cyanDim",
  "--dbzs-green",
  "--dbzs-amber",
  "--dbzs-red"
] as const;

const STATUS_TONES: UiStatusTone[] = ["success", "warning", "danger", "running", "neutral", "info"];

const PREVIEW_TABS = [
  { id: "palette",   label: "Palette"   },
  { id: "badges",    label: "Badges"    },
  { id: "rail",      label: "Rail"      },
  { id: "typography",label: "Typography"},
  { id: "motion",    label: "Motion"    }
];

function ColorSwatch({ varName }: { varName: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-8 w-8 rounded border border-dbzs-border"
        style={{ background: `var(${varName})` }}
        title={varName}
      />
      <code className="dbzs-mono-xs text-dbzs-muted">{varName}</code>
    </div>
  );
}

export function DesignTokenPreview() {
  const [activeTab, setActiveTab] = useState("palette");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-dbzs-bg text-dbzs-text">
      <header className="flex shrink-0 items-center gap-3 border-b border-dbzs-border bg-dbzs-panel px-4 py-2">
        <div className="grid h-7 w-7 place-items-center border border-dbzs-cyan/50 bg-dbzs-cyan/10 text-xs font-bold text-dbzs-cyan">D</div>
        <span className="text-sm font-semibold">Neural Workbench — Design Token Preview</span>
        <span className="ml-auto text-xs text-dbzs-muted">Dev Only</span>
      </header>

      <TabStrip tabs={PREVIEW_TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "palette" && (
          <section>
            <h2 className="dbzs-label-caps mb-4 text-dbzs-muted">Farbpalette</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PALETTE_VARS.map((v) => <ColorSwatch key={v} varName={v} />)}
            </div>
          </section>
        )}

        {activeTab === "badges" && (
          <section>
            <h2 className="dbzs-label-caps mb-4 text-dbzs-muted">Status Badges</h2>
            <div className="flex flex-wrap gap-2">
              {STATUS_TONES.map((tone) => (
                <WorkbenchStatusBadge
                  key={tone}
                  label={tone}
                  tone={tone}
                  value={`${tone} Zustand`}
                />
              ))}
            </div>
          </section>
        )}

        {activeTab === "rail" && (
          <section>
            <h2 className="dbzs-label-caps mb-4 text-dbzs-muted">Navigation Registry</h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-dbzs-border text-dbzs-muted">
                  <th className="px-2 py-1 text-left">ID</th>
                  <th className="px-2 py-1 text-left">Label</th>
                  <th className="px-2 py-1 text-left">Glyph</th>
                  <th className="px-2 py-1 text-left">Shortcut</th>
                  <th className="px-2 py-1 text-left">Gruppe</th>
                </tr>
              </thead>
              <tbody>
                {RAIL_REGISTRY.map((entry) => (
                  <tr className="border-b border-dbzs-border/50" key={entry.id}>
                    <td className="px-2 py-1 font-mono">{entry.id}</td>
                    <td className="px-2 py-1">{entry.label}</td>
                    <td className="px-2 py-1 font-mono">{entry.glyph}</td>
                    <td className="px-2 py-1 font-mono">Ctrl+{entry.shortcut}</td>
                    <td className="px-2 py-1 text-dbzs-muted">{entry.group}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === "typography" && (
          <section className="space-y-4">
            <h2 className="dbzs-label-caps text-dbzs-muted">Typografie-Rollen</h2>
            <div className="dbzs-label-caps text-dbzs-muted">dbzs-label-caps — Abschnittstitel</div>
            <div className="dbzs-label-sm text-dbzs-text">dbzs-label-sm — Sekundäre Labels</div>
            <div className="dbzs-body-sm text-dbzs-text">dbzs-body-sm — Sekundärer Fließtext (12px)</div>
            <div className="dbzs-body text-dbzs-text">dbzs-body — Standard-UI-Text (13px)</div>
            <div className="dbzs-heading-panel text-dbzs-text">dbzs-heading-panel — Panel-Überschriften</div>
            <div className="dbzs-mono text-dbzs-muted">dbzs-mono — Monospace Standardgröße</div>
            <div className="dbzs-mono-xs text-dbzs-muted">dbzs-mono-xs — Monospace klein (11px)</div>
          </section>
        )}

        {activeTab === "motion" && (
          <section className="space-y-4">
            <h2 className="dbzs-label-caps text-dbzs-muted">Motion — Erlaubte Animationen</h2>
            <div className="dbzs-animate-fade-in rounded border border-dbzs-border bg-dbzs-panel p-3 text-xs">
              ✅ dbzs-animate-fade-in
            </div>
            <div className="dbzs-animate-slide-in-left rounded border border-dbzs-border bg-dbzs-panel p-3 text-xs">
              ✅ dbzs-animate-slide-in-left
            </div>
            <div className="rounded border border-dbzs-border bg-dbzs-panel p-3 text-xs">
              <span className="dbzs-animate-runtime-pulse inline-block text-dbzs-cyan">
                ✅ dbzs-animate-runtime-pulse (Runtime aktiv)
              </span>
            </div>
            <EmptyState
              title="Kein Inhalt"
              description="Hier würde ein leerer Zustand erscheinen."
              icon={<span>📭</span>}
            />
          </section>
        )}
      </div>
    </div>
  );
}
