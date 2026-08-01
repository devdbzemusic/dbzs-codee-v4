import { useModelLabTabController } from "./ModelLabTab.controller";
import {
  ModelLabCollectionsSection,
  ModelLabHeader,
  ModelLabHuggingFaceSearchSection,
  ModelLabInspectorPanel,
  ModelLabModelsSection,
  ModelLabReadinessSection,
  ModelLabRoutingSection,
  ModelLabSourcesSection
} from "./ModelLabTab.sections";

export function ModelLabTab() {
  const {
    backendOnline,
    sources,
    sourceCandidates,
    models,
    isLoading,
    isScanning,
    error,
    newSourcePath,
    setNewSourcePath,
    addingSource,
    addSource,
    runScan,
    loadAll,
    selectedBundleId,
    setSelectedBundleId,
    selectedModel,
    collections,
    routingMap,
    readinessMap,
    creatingCollection,
    createCollection,
    addToCollection,
    removeFromCollection,
    hfQuery,
    setHfQuery,
    hfResults,
    hfSearching,
    hfError,
    searchHuggingFace
  } = useModelLabTabController();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ModelLabHeader
        backendOnline={backendOnline}
        error={error}
        isLoading={isLoading}
        isScanning={isScanning}
        modelCount={models.length}
        onRefresh={() => void loadAll()}
        onScanAll={() => void runScan()}
        sourceCount={sources.length}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <ModelLabSourcesSection
              addingSource={addingSource}
              isScanning={isScanning}
              newSourcePath={newSourcePath}
              onAddSource={() => void addSource({ path: newSourcePath.trim() })}
              onAddSuggestedSource={(path) => void addSource({ path })}
              onNewSourcePathChange={setNewSourcePath}
              onScanSource={(sourceId) => void runScan(sourceId)}
              sourceCandidates={sourceCandidates}
              sources={sources}
            />
            <ModelLabModelsSection models={models} onSelect={setSelectedBundleId} selectedBundleId={selectedBundleId} />
            <ModelLabCollectionsSection
              collections={collections}
              creatingCollection={creatingCollection}
              models={models}
              onCreateCollection={(request) => void createCollection(request)}
            />
            <ModelLabReadinessSection readinessMap={readinessMap} />
            <ModelLabRoutingSection routingMap={routingMap} />
            <ModelLabHuggingFaceSearchSection
              error={hfError}
              onQueryChange={setHfQuery}
              onSearch={() => void searchHuggingFace(hfQuery)}
              query={hfQuery}
              results={hfResults}
              searching={hfSearching}
            />
          </div>
          <ModelLabInspectorPanel
            collections={collections}
            model={selectedModel}
            onAddToCollection={
              selectedBundleId ? (collectionId) => void addToCollection(collectionId, selectedBundleId) : undefined
            }
            onRemoveFromCollection={
              selectedBundleId
                ? (collectionId) => void removeFromCollection(collectionId, selectedBundleId)
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
