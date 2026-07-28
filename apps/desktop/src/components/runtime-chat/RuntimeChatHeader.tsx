import React from "react";
import { Button } from "@/components/ui/Button";

export function RuntimeChatHeader({
  title,
  subtitle,
  activityHint,
  selectedProvider,
  availableProviders,
  pendingApprovalCount,
  traceCount,
  showPanels,
  showSlotPanel,
  showDiagnostics,
  compact,
  detached,
  onProviderChange,
  onOpenCapabilities,
  onTogglePanels,
  onToggleSlots,
  onToggleDiagnostics,
  onDetach,
  onClose,
  onCompactConversation,
  onClearConversation,
  canCompactConversation,
  canClearConversation,
  workspaceLabel,
  activeFileLabel,
  contextLabel
}: {
  title: string;
  subtitle: string;
  activityHint: string | null;
  selectedProvider: string;
  availableProviders: string[];
  pendingApprovalCount: number;
  traceCount: number;
  showPanels: boolean;
  showSlotPanel: boolean;
  showDiagnostics: boolean;
  compact: boolean;
  detached: boolean;
  onProviderChange: (provider: string) => void;
  onOpenCapabilities: () => void;
  onTogglePanels: () => void;
  onToggleSlots: () => void;
  onToggleDiagnostics: () => void;
  onDetach: () => void;
  onClose: () => void;
  onCompactConversation: () => void;
  onClearConversation: () => void;
  canCompactConversation: boolean;
  canClearConversation: boolean;
  workspaceLabel: string;
  activeFileLabel: string;
  contextLabel: string;
}) {
  return (
    <>
      <div className="flex items-start gap-2 border-b border-dbzs-border bg-dbzs-panel px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-dbzs-text">{title}</div>
          <div className="truncate text-[10px] text-dbzs-muted">{subtitle}</div>
          {activityHint ? (
            <div className="mt-1 flex items-center gap-1 text-[9px] text-dbzs-cyan">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-dbzs-cyan" />
              <span className="truncate">{activityHint}</span>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <select
            className="rounded border border-dbzs-border bg-dbzs-panelSoft px-1.5 py-0.5 text-[10px] text-dbzs-text"
            onChange={(event) => onProviderChange(event.target.value)}
            title="Provider für die Chat-Anfrage"
            value={selectedProvider}
          >
            {availableProviders.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          {pendingApprovalCount > 0 ? (
            <span className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-1.5 py-0.5 text-[10px] text-dbzs-cyan">
              {pendingApprovalCount}
            </span>
          ) : null}
          <Button
            onClick={onOpenCapabilities}
            title="Preset-Erklärungen, Skills und Modus-Hilfen an einer Stelle"
          >
            Was kann ich hier tun?
          </Button>
          <Button
            active={showPanels}
            onClick={onTogglePanels}
            title="Werkzeuge, Aktivität, Freigaben, Patch-Vorschau und Recherche"
          >
            Werkzeuge &amp; Freigaben
          </Button>
          <Button
            active={showSlotPanel}
            onClick={onToggleSlots}
            title="Modell-Slots verwalten"
          >
            Slots
          </Button>
          {!compact ? (
            <Button
              active={showDiagnostics}
              onClick={onToggleDiagnostics}
              title="Technische Routing-/Token-/Modell-Diagnose und Session-Traces — betrifft nicht den eigentlichen Workflow"
            >
              Diagnose{traceCount > 0 ? ` · ${traceCount}` : ""}
            </Button>
          ) : null}
          {detached ? (
            <Button onClick={onClose} title="Abgedocktes Fenster schließen">
              ×
            </Button>
          ) : (
            <Button variant="primary" onClick={onDetach} title="In eigenem Fenster öffnen">
              ↗
            </Button>
          )}
          <Button
            disabled={!canCompactConversation}
            onClick={onCompactConversation}
            title="Ältere Nachrichten platzsparend zusammenfassen"
          >
            Kompakt
          </Button>
          <Button
            disabled={!canClearConversation}
            onClick={onClearConversation}
            title="Unterhaltung leeren"
          >
            Leeren
          </Button>
        </div>
      </div>

      <div className="border-b border-dbzs-border bg-dbzs-bg/70 px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-dbzs-text">Arbeitskontext</span>
          <span className="text-[9px] text-dbzs-muted">Conversation first · Panels sekundär</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-dbzs-muted">
          <span className="rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-1.5 py-0.5">
            {workspaceLabel}
          </span>
          <span className="rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-1.5 py-0.5">
            {activeFileLabel}
          </span>
          <span className="rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-1.5 py-0.5">
            {contextLabel}
          </span>
        </div>
      </div>
    </>
  );
}
