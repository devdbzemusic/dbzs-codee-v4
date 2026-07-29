import { useRuntimeModelsTabController } from "./RuntimeModelsTab.controller";
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
