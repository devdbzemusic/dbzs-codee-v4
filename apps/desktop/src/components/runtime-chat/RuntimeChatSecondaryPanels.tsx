import React from "react";
import type { RuntimeStatus } from "@dbzs/shared";
import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";
import { RuntimeChatWorkflowPanels } from "@/components/runtime-chat/RuntimeChatWorkflowPanels";
import { RuntimeChatDiagnosticsPanels } from "@/components/runtime-chat/RuntimeChatDiagnosticsPanels";
import { RuntimeSlotPanel } from "@/components/RuntimeSlotPanel";
import { useEditorStore } from "@/stores/editorStore";

type QueueProposedChanges = ReturnType<typeof useEditorStore.getState>["queueProposedChanges"];

/**
 * Thin layout wrapper: arranges the three independently-toggled secondary
 * areas (Werkzeuge & Freigaben / Slots / Diagnose) with clear section
 * headings, instead of the previous single undifferentiated
 * "Sekundäre Panels & Diagnose" heading that mixed decision-critical
 * workflow UI with pure technical diagnostics.
 */
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
      {showPanels ? (
        <div className="mb-2">
          <div className="mb-1 text-[10px] font-medium text-dbzs-text">Werkzeuge & Freigaben</div>
          <RuntimeChatWorkflowPanels
            compact={compact}
            onStatusNote={onStatusNote}
            queueProposedChanges={queueProposedChanges}
            workspaceRoot={workspaceRoot}
          />
        </div>
      ) : null}

      {showSlotPanel ? (
        <div className="mb-2">
          <div className="mb-1 text-[10px] font-medium text-dbzs-text">Modell-Slots</div>
          <RuntimeSlotPanel compact={false} autoStart={false} />
        </div>
      ) : null}

      {showDiagnostics && !compact ? (
        <div>
          <div className="mb-1 text-[10px] font-medium text-dbzs-text">
            Diagnose <span className="font-normal text-dbzs-muted">(technisch, kein Workflow-Schritt)</span>
          </div>
          <RuntimeChatDiagnosticsPanels
            diagnostics={diagnostics}
            runtimeReady={runtimeReady}
            tokenBudget={tokenBudget}
          />
        </div>
      ) : null}
    </div>
  );
}
