import React from "react";
import type { RuntimeStatus } from "@dbzs/shared";
import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";
import { RuntimeChatActivityPanel } from "@/components/RuntimeChatActivityPanel";
import { RuntimeChatApprovals } from "@/components/RuntimeChatApprovals";
import { RuntimeChatPatchPanel } from "@/components/RuntimeChatPatchPanel";
import { RuntimeChatResearchPanel } from "@/components/RuntimeChatResearchPanel";
import { RuntimeChatToolsBar } from "@/components/RuntimeChatToolsBar";
import { RuntimeSlotPanel } from "@/components/RuntimeSlotPanel";
import { RoutingDiagnosticsCard } from "@/components/RoutingDiagnosticsCard";
import { TokenBudgetVisualizer } from "@/components/TokenBudgetVisualizer";
import { RuntimeModelTestPanel } from "@/components/RuntimeModelTestPanel";
import { useEditorStore } from "@/stores/editorStore";

type QueueProposedChanges = ReturnType<typeof useEditorStore.getState>["queueProposedChanges"];

export function RuntimeChatSecondaryPanels({
  compact,
  showPanels,
  showSlotPanel,
  showDiagnostics,
  queueProposedChanges,
  workspaceRoot,
  onStatusNote,
  diagnostics,
  tokenBudget,
  runtimeReady
}: {
  compact: boolean;
  showPanels: boolean;
  showSlotPanel: boolean;
  showDiagnostics: boolean;
  queueProposedChanges: QueueProposedChanges;
  workspaceRoot: string | null;
  onStatusNote: (note: string | null) => void;
  diagnostics: RoutingDiagnostics | null;
  tokenBudget: unknown;
  runtimeReady: boolean;
}) {
  if (!showPanels && !showSlotPanel && !(showDiagnostics && !compact)) {
    return null;
  }

  return (
    <div className="border-b border-dbzs-border bg-dbzs-panel/40 px-2 py-2">
      <div className="mb-2 text-[10px] font-medium text-dbzs-text">Sekundäre Panels & Diagnose</div>
      {showPanels ? (
        <div className="space-y-2">
          <RuntimeChatToolsBar compact={compact} />
          <RuntimeChatActivityPanel />
          <RuntimeChatApprovals
            onStatusNote={onStatusNote}
            queueProposedChanges={queueProposedChanges}
            workspaceRoot={workspaceRoot}
          />
          <RuntimeChatPatchPanel />
          <RuntimeChatResearchPanel />
        </div>
      ) : null}

      {showSlotPanel ? (
        <div className="mt-2">
          <RuntimeSlotPanel compact={false} autoStart={false} />
        </div>
      ) : null}

      {showDiagnostics && !compact ? (
        <div className="mt-2 space-y-2">
          {diagnostics ? (
            <RoutingDiagnosticsCard diagnostics={diagnostics} />
          ) : (
            <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/60 p-2 text-[10px] text-dbzs-muted">
              Noch keine Routing- oder Laufdiagnose vorhanden.
            </div>
          )}
          <TokenBudgetVisualizer budget={tokenBudget as never} />
          <RuntimeModelTestPanel runtimeReady={runtimeReady} />
        </div>
      ) : null}
    </div>
  );
}
