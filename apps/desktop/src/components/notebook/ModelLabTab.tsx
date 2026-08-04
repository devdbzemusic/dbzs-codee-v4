import { useModelLabTabController } from "./ModelLabTab.controller";
import {
  ModelLabCollectionsSection,
  ModelLabHeader,
  ModelLabHuggingFaceSearchSection,
  ModelLabInspectorPanel,
  ModelLabModelsSection,
  ModelLabReadinessSection,
  ModelLabRoleAssignmentSection,
  ModelLabRoutingSection,
  ModelLabSourcesSection
} from "./ModelLabTab.sections";
import { useModelIndexStore } from "@/stores/modelIndexStore";

export function ModelLabTab() {
  const {
    backendOnline,
    sources,
    sourceCandidates,
    models,
    jobs,
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
    roleAssignments,
    assigningRole,
    assignRole,
    certifyModel,
    certifyingModel,
    settingsFieldConflicts,
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
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
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
              jobs={jobs}
            />
            <ModelLabModelsSection 
              models={models} 
              onSelect={setSelectedBundleId} 
              selectedBundleId={selectedBundleId} 
              onAssignAndEnable={(bundleId) => {
                // FAST_GENERAL_AGENT is the catalog's default fleet role for general
                // chat use (Massnahmenkatalog M-002) — set settings_field so the
                // assignment actually reaches the "Chat"-Rollenmodell dropdown in
                // Settings instead of only recording an internal Model-Lab row.
                void assignRole({
                  bundle_id: bundleId,
                  role: "FAST_GENERAL_AGENT",
                  settings_field: "defaultChatModelId",
                  residency_intent: "idle_evict",
                  enabled: true,
                }).then(() => {
                  // After assigning, reload the global model index so it appears in Codee settings
                  useModelIndexStore.getState().loadModelIndex().catch(console.error);
                });
              }}
              certifyModel={certifyModel}
              certifyingModel={certifyingModel}
            />
            <ModelLabCollectionsSection
              collections={collections}
              creatingCollection={creatingCollection}
              models={models}
              onCreateCollection={(request) => void createCollection(request)}
            />
            <ModelLabReadinessSection readinessMap={readinessMap} />
            <ModelLabRoutingSection routingMap={routingMap} />
            <ModelLabRoleAssignmentSection
              assigningRole={assigningRole}
              models={models}
              onAssignRole={(request) => void assignRole(request)}
              roleAssignments={roleAssignments}
              settingsFieldConflicts={settingsFieldConflicts}
            />
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
