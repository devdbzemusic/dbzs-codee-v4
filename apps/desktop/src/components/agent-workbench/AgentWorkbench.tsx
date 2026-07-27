import { useEffect } from "react";
import { AgentActivityStream } from "@/components/agent-workbench/AgentActivityStream";
import { AgentFollowUpComposer } from "@/components/agent-workbench/AgentFollowUpComposer";
import { AgentOutputDock } from "@/components/agent-workbench/AgentOutputDock";
import { AgentPlanChecklist } from "@/components/agent-workbench/AgentPlanChecklist";
import { AgentReviewDock } from "@/components/agent-workbench/AgentReviewDock";
import { AgentRunHeader } from "@/components/agent-workbench/AgentRunHeader";
import { AgentRunList } from "@/components/agent-workbench/AgentRunList";
import { AgentStatusBar } from "@/components/agent-workbench/AgentStatusBar";
import { useAgentWorkbenchStore } from "@/stores/agentWorkbenchStore";
import { useNotebookStore } from "@/stores/notebookStore";

export type AgentWorkbenchProps = {
  workspaceRoot: string | null;
  workspaceName: string | null;
  onOpenFile?: (filePath: string) => void;
};

export function AgentWorkbench({ workspaceRoot, workspaceName, onOpenFile }: AgentWorkbenchProps) {
  const focusEditorTab = useNotebookStore((state) => state.focusEditorTab);

  const runs = useAgentWorkbenchStore((state) => state.runs);
  const selectedRunId = useAgentWorkbenchStore((state) => state.selectedRunId);
  const selectedRun = useAgentWorkbenchStore((state) => state.selectedRun);
  const steps = useAgentWorkbenchStore((state) => state.steps);
  const events = useAgentWorkbenchStore((state) => state.events);
  const pendingReviews = useAgentWorkbenchStore((state) => state.pendingReviews);
  const workspaceChangeFiles = useAgentWorkbenchStore((state) => state.workspaceChangeFiles);
  const selectedReviewGateId = useAgentWorkbenchStore((state) => state.selectedReviewGateId);
  const activityFilter = useAgentWorkbenchStore((state) => state.activityFilter);
  const outputTab = useAgentWorkbenchStore((state) => state.outputTab);
  const sseConnected = useAgentWorkbenchStore((state) => state.sseConnected);
  const hostExecutorStatus = useAgentWorkbenchStore((state) => state.hostExecutorStatus);
  const isLoadingRuns = useAgentWorkbenchStore((state) => state.isLoadingRuns);
  const isMutating = useAgentWorkbenchStore((state) => state.isMutating);
  const error = useAgentWorkbenchStore((state) => state.error);
  const newRunGoal = useAgentWorkbenchStore((state) => state.newRunGoal);
  const lastCommandSummary = useAgentWorkbenchStore((state) => state.lastCommandSummary);
  const loadRuns = useAgentWorkbenchStore((state) => state.loadRuns);
  const selectRun = useAgentWorkbenchStore((state) => state.selectRun);
  const createRun = useAgentWorkbenchStore((state) => state.createRun);
  const startSelectedRun = useAgentWorkbenchStore((state) => state.startSelectedRun);
  const pauseSelectedRun = useAgentWorkbenchStore((state) => state.pauseSelectedRun);
  const resumeSelectedRun = useAgentWorkbenchStore((state) => state.resumeSelectedRun);
  const acceptResumeBaselineForSelectedRun = useAgentWorkbenchStore(
    (state) => state.acceptResumeBaselineForSelectedRun
  );
  const acceptWorkspaceChangesForSelectedRun = useAgentWorkbenchStore(
    (state) => state.acceptWorkspaceChangesForSelectedRun
  );
  const cancelSelectedRun = useAgentWorkbenchStore((state) => state.cancelSelectedRun);
  const submitFollowUp = useAgentWorkbenchStore((state) => state.submitFollowUp);
  const setActivityFilter = useAgentWorkbenchStore((state) => state.setActivityFilter);
  const setOutputTab = useAgentWorkbenchStore((state) => state.setOutputTab);
  const setNewRunGoal = useAgentWorkbenchStore((state) => state.setNewRunGoal);
  const approveReview = useAgentWorkbenchStore((state) => state.approveReview);
  const rejectReview = useAgentWorkbenchStore((state) => state.rejectReview);
  const selectReviewGate = useAgentWorkbenchStore((state) => state.selectReviewGate);
  const startHostExecutor = useAgentWorkbenchStore((state) => state.startHostExecutor);
  const stopHostExecutor = useAgentWorkbenchStore((state) => state.stopHostExecutor);
  const disconnectStream = useAgentWorkbenchStore((state) => state.disconnectStream);

  useEffect(() => {
    void loadRuns();
    startHostExecutor(workspaceRoot);
    return () => {
      stopHostExecutor();
      disconnectStream();
    };
  }, [disconnectStream, loadRuns, startHostExecutor, stopHostExecutor, workspaceRoot]);

  useEffect(() => {
    startHostExecutor(workspaceRoot);
  }, [startHostExecutor, workspaceRoot]);

  const currentStep =
    steps.find((step) => step.id === selectedRun?.currentStepId) ??
    steps.find((step) => step.status === "active") ??
    null;

  const warningCount = events.filter((event) => event.severity === "warning").length;
  const errorCount = events.filter((event) => event.severity === "error").length;

  const handleCreateRun = () => {
    if (!workspaceRoot) {
      return;
    }
    void createRun({
      goal: newRunGoal.trim(),
      workspaceRoot,
      workspaceName: workspaceName ?? undefined
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#091017]">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <AgentRunList
          isLoading={isLoadingRuns}
          isMutating={isMutating}
          newRunGoal={newRunGoal}
          onCreateRun={handleCreateRun}
          onNewRunGoalChange={setNewRunGoal}
          onRefresh={() => void loadRuns()}
          onSelectRun={(runId) => void selectRun(runId)}
          runs={runs}
          selectedRunId={selectedRunId}
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          {!workspaceRoot ? (
            <section className="border border-dbzs-amber/40 bg-dbzs-amber/10 p-4 text-sm text-dbzs-amber">
              Bitte zuerst einen Workspace öffnen, um Agent Runs zu starten.
            </section>
          ) : null}

          <AgentRunHeader
            currentStepTitle={currentStep?.title ?? null}
            isMutating={isMutating}
            onAcceptResumeBaseline={() => void acceptResumeBaselineForSelectedRun()}
            onAcceptWorkspaceChanges={() => void acceptWorkspaceChangesForSelectedRun()}
            onOpenEditor={focusEditorTab}
            onPause={() => void pauseSelectedRun()}
            onResume={() => void resumeSelectedRun()}
            onStop={() => void cancelSelectedRun()}
            run={selectedRun}
            workspaceChangeFiles={workspaceChangeFiles}
          />

          <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
              <AgentPlanChecklist currentStepId={selectedRun?.currentStepId ?? null} steps={steps} />
              <AgentFollowUpComposer
                disabled={!selectedRunId}
                isMutating={isMutating}
                onSubmit={(text) => void submitFollowUp(text)}
              />
              <AgentReviewDock
                isMutating={isMutating}
                onApprove={(gateId, comment) => void approveReview(gateId, comment)}
                onOpenFile={onOpenFile}
                onReject={(gateId, reason) => void rejectReview(gateId, reason)}
                onSelectGate={selectReviewGate}
                reviews={pendingReviews}
                selectedGateId={selectedReviewGateId}
              />
            </div>

            <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
              <AgentActivityStream
                events={events}
                filter={activityFilter}
                onFilterChange={setActivityFilter}
                onOpenFile={onOpenFile}
              />
              <AgentOutputDock activeTab={outputTab} events={events} onTabChange={setOutputTab} />
            </div>
          </div>

          {selectedRun &&
          ["ready", "created", "planning", "waiting_plan_review"].includes(selectedRun.status) ? (
            <div className="flex gap-2">
              <button
                className="border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-3 py-1 text-xs text-dbzs-cyan disabled:opacity-40"
                disabled={isMutating}
                onClick={() => void startSelectedRun()}
                type="button"
              >
                Run starten
              </button>
            </div>
          ) : null}

          {error ? <p className="text-xs text-dbzs-red">{error}</p> : null}
        </div>
      </div>

      <AgentStatusBar
        errorCount={errorCount}
        hostExecutorStatus={hostExecutorStatus}
        lastCommandSummary={lastCommandSummary}
        modelLabel={selectedRun?.modelId ?? null}
        run={selectedRun}
        sseConnected={sseConnected}
        steps={steps}
        warningCount={warningCount}
        workspaceName={workspaceName}
      />
    </div>
  );
}
