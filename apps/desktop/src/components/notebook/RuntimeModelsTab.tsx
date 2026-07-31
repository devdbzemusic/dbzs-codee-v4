import { useRuntimeModelsTabController } from "./RuntimeModelsTab.controller";
import { useNotebookStore } from "@/stores/notebookStore";
import {
  MultimodalPairsSection,
  RuntimeModelsEmptyState,
  RuntimeModelsHeader,
  StartableModelsSection,
  SupportArtifactsSection
} from "./RuntimeModelsTab.sections";

export {
  defaultPairingSelection,
  describeBaseModelSelection,
  describePairingTargetBadge,
  formatPairingProbeButtonLabel,
  formatPairingSaveButtonLabel
} from "./RuntimeModelsTab.pairing";
export * from "./RuntimeModelsTab.helpers";

export function RuntimeModelsTab() {
  const runtimeFocusSlotId = useNotebookStore((state) => state.runtimeFocusSlotId);
  const clearRuntimeSlotFocus = useNotebookStore((state) => state.clearRuntimeSlotFocus);
  const {
    backendOnline,
    index,
    indexError,
    indexLoading,
    loadModelIndex,
    modelsById,
    multimodalPairActionSummary,
    multimodalPairSourceSummary,
    multimodalPairSummary,
    multimodalPairs,
    pairingCandidates,
    pairingUi,
    runtimeBusy,
    runtimeError,
    sortedMultimodalPairs,
    sortedStartableModels,
    sortedVisibleSupportArtifacts,
    startModel,
    startableModelActionSummary,
    startableModels,
    status,
    stopModel,
    supportArtifactActionSummary,
    supportArtifactStatusSummary,
    supportArtifactSummary,
    supportArtifactsById,
    modelRoleSummary,
    modelRoutingSummary,
    visibleSupportArtifacts
  } = useRuntimeModelsTabController();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <RuntimeModelsHeader
        backendOnline={backendOnline}
        index={index}
        indexError={indexError}
        indexLoading={indexLoading}
        loadModelIndex={loadModelIndex}
        multimodalPairCount={multimodalPairs.length}
        runtimeBusy={runtimeBusy}
        runtimeError={runtimeError}
        status={status}
        stopModel={stopModel}
        visibleSupportArtifactCount={visibleSupportArtifacts.length}
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {runtimeFocusSlotId ? (
          <div className="mb-4 rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-3 py-2 text-xs text-dbzs-text">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-dbzs-cyan">Modell-Auswahl fuer Slot {runtimeFocusSlotId}</span>
                <p className="mt-0.5 text-[11px] text-dbzs-muted">
                  Waehle hier ein passendes Rollenmodell fuer diesen Slot. Es erfolgt kein stiller Modellwechsel.
                </p>
              </div>
              <button
                className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text"
                onClick={clearRuntimeSlotFocus}
                type="button"
              >
                Fokus entfernen
              </button>
            </div>
          </div>
        ) : null}
        {!index ? (
          <RuntimeModelsEmptyState hasAnyEntries={false} indexError={indexError} indexLoading={indexLoading} />
        ) : startableModels.length === 0 && visibleSupportArtifacts.length === 0 ? (
          <RuntimeModelsEmptyState hasAnyEntries={true} indexError={indexError} indexLoading={false} />
        ) : (
          <div className="space-y-6">
            <StartableModelsSection
              modelRoleSummary={modelRoleSummary}
              modelRoutingSummary={modelRoutingSummary}
              multimodalPairs={multimodalPairs}
              runtimeBusy={runtimeBusy}
              sortedStartableModels={sortedStartableModels}
              startModel={startModel}
              startableModelActionSummary={startableModelActionSummary}
              status={status}
              stopModel={stopModel}
            />
            <MultimodalPairsSection
              modelsById={modelsById}
              multimodalPairActionSummary={multimodalPairActionSummary}
              multimodalPairSourceSummary={multimodalPairSourceSummary}
              multimodalPairSummary={multimodalPairSummary}
              pairingCandidates={pairingCandidates}
              pairingUi={pairingUi}
              sortedMultimodalPairs={sortedMultimodalPairs}
              supportArtifactsById={supportArtifactsById}
            />
            <SupportArtifactsSection
              modelsById={modelsById}
              multimodalPairs={multimodalPairs}
              pairingCandidates={pairingCandidates}
              pairingUi={pairingUi}
              sortedVisibleSupportArtifacts={sortedVisibleSupportArtifacts}
              supportArtifactActionSummary={supportArtifactActionSummary}
              supportArtifactStatusSummary={supportArtifactStatusSummary}
              supportArtifactSummary={supportArtifactSummary}
            />
          </div>
        )}
      </div>
    </div>
  );
}
