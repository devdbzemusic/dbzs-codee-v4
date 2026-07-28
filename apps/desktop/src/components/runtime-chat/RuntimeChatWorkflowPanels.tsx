import { RuntimeChatActivityPanel } from "@/components/RuntimeChatActivityPanel";
import { RuntimeChatApprovals } from "@/components/RuntimeChatApprovals";
import { RuntimeChatPatchPanel } from "@/components/RuntimeChatPatchPanel";
import { RuntimeChatResearchPanel } from "@/components/RuntimeChatResearchPanel";
import { RuntimeChatToolsBar } from "@/components/RuntimeChatToolsBar";
import { useEditorStore } from "@/stores/editorStore";

type QueueProposedChanges = ReturnType<typeof useEditorStore.getState>["queueProposedChanges"];

/**
 * Decision-critical / workflow surfaces: tools, current activity, pending
 * approvals, the patch review panel, and web research. Deliberately kept
 * separate from RuntimeChatDiagnosticsPanels — this is where a user needs to
 * look to actually move a task forward, not to debug the runtime.
 */
export function RuntimeChatWorkflowPanels({
  compact,
  queueProposedChanges,
  workspaceRoot,
  onStatusNote
}: {
  compact: boolean;
  queueProposedChanges: QueueProposedChanges;
  workspaceRoot: string | null;
  onStatusNote: (note: string | null) => void;
}) {
  return (
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
  );
}
