import { useModelLabTabController } from "./ModelLabTab.controller";
import {
  ModelLabHeader,
  ModelLabInspectorPanel,
  ModelLabModelsSection,
  ModelLabSourcesSection
} from "./ModelLabTab.sections";

export function ModelLabTab() {
  const {
    backendOnline,
    sources,
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
    selectedModel
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
              onNewSourcePathChange={setNewSourcePath}
              onScanSource={(sourceId) => void runScan(sourceId)}
              sources={sources}
            />
            <ModelLabModelsSection models={models} onSelect={setSelectedBundleId} selectedBundleId={selectedBundleId} />
          </div>
          <ModelLabInspectorPanel model={selectedModel} />
        </div>
      </div>
    </div>
  );
}
