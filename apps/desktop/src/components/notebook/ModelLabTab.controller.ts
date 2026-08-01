import { useCallback, useEffect, useState } from "react";
import type {
  ModelLabCollection,
  ModelLabCollectionCreate,
  ModelLabHuggingFaceSearchResult,
  ModelLabModel,
  ModelLabReadinessEntry,
  ModelLabRoutingEntry,
  ModelLabScanJob,
  ModelLabSource,
  ModelLabSourceCandidate,
  ModelLabSourceCreate
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useSettingsStore } from "@/stores/settingsStore";

export function useModelLabTabController() {
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const backendOnline = backendHealth?.status === "ok";

  const [sources, setSources] = useState<ModelLabSource[]>([]);
  const [sourceCandidates, setSourceCandidates] = useState<ModelLabSourceCandidate[]>([]);
  const [models, setModels] = useState<ModelLabModel[]>([]);
  const [jobs, setJobs] = useState<ModelLabScanJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSourcePath, setNewSourcePath] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [collections, setCollections] = useState<ModelLabCollection[]>([]);
  const [routingMap, setRoutingMap] = useState<ModelLabRoutingEntry[]>([]);
  const [readinessMap, setReadinessMap] = useState<ModelLabReadinessEntry[]>([]);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [hfQuery, setHfQuery] = useState("");
  const [hfResults, setHfResults] = useState<ModelLabHuggingFaceSearchResult[]>([]);
  const [hfSearching, setHfSearching] = useState(false);
  const [hfError, setHfError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [
        nextSources,
        nextSourceCandidates,
        nextModels,
        nextJobs,
        nextCollections,
        nextRoutingMap,
        nextReadinessMap
      ] = await Promise.all([
        backendClient.listModelLabSources ? backendClient.listModelLabSources() : Promise.resolve([]),
        backendClient.listModelLabSourceCandidates
          ? backendClient.listModelLabSourceCandidates()
          : Promise.resolve([]),
        backendClient.listModelLabModels ? backendClient.listModelLabModels() : Promise.resolve([]),
        backendClient.listModelLabJobs ? backendClient.listModelLabJobs() : Promise.resolve([]),
        backendClient.listModelLabCollections ? backendClient.listModelLabCollections() : Promise.resolve([]),
        backendClient.listModelRoutingMap ? backendClient.listModelRoutingMap() : Promise.resolve([]),
        backendClient.listModelReadiness ? backendClient.listModelReadiness() : Promise.resolve([])
      ]);
      setSources(nextSources);
      setSourceCandidates(nextSourceCandidates);
      setModels(nextModels);
      setJobs(nextJobs);
      setCollections(nextCollections);
      setRoutingMap(nextRoutingMap);
      setReadinessMap(nextReadinessMap);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Model Lab konnte nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const addSource = useCallback(
    async (request: ModelLabSourceCreate) => {
      if (!backendClient.createModelLabSource) {
        setError("createModelLabSource ist nicht verfuegbar.");
        return;
      }
      setAddingSource(true);
      setError(null);
      try {
        await backendClient.createModelLabSource(request);
        setNewSourcePath("");
        await loadAll();
      } catch (addError) {
        setError(addError instanceof Error ? addError.message : "Modellquelle konnte nicht angelegt werden.");
      } finally {
        setAddingSource(false);
      }
    },
    [loadAll]
  );

  const runScan = useCallback(
    async (sourceId?: string) => {
      if (!backendClient.runModelLabScan) {
        setError("runModelLabScan ist nicht verfuegbar.");
        return;
      }
      setIsScanning(true);
      setError(null);
      try {
        await backendClient.runModelLabScan(sourceId ? { source_id: sourceId } : { all_sources: true });
        await loadAll();
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : "Scan fehlgeschlagen.");
      } finally {
        setIsScanning(false);
      }
    },
    [loadAll]
  );

  const createCollection = useCallback(
    async (request: ModelLabCollectionCreate) => {
      if (!backendClient.createModelLabCollection) {
        setError("createModelLabCollection ist nicht verfuegbar.");
        return;
      }
      setCreatingCollection(true);
      setError(null);
      try {
        await backendClient.createModelLabCollection(request);
        await loadAll();
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : "Collection konnte nicht angelegt werden.");
      } finally {
        setCreatingCollection(false);
      }
    },
    [loadAll]
  );

  const addToCollection = useCallback(
    async (collectionId: string, bundleId: string) => {
      if (!backendClient.addModelLabCollectionMember) {
        setError("addModelLabCollectionMember ist nicht verfuegbar.");
        return;
      }
      setError(null);
      try {
        await backendClient.addModelLabCollectionMember(collectionId, bundleId);
        await loadAll();
      } catch (addError) {
        setError(addError instanceof Error ? addError.message : "Modell konnte nicht zugeordnet werden.");
      }
    },
    [loadAll]
  );

  const removeFromCollection = useCallback(
    async (collectionId: string, bundleId: string) => {
      if (!backendClient.removeModelLabCollectionMember) {
        setError("removeModelLabCollectionMember ist nicht verfuegbar.");
        return;
      }
      setError(null);
      try {
        await backendClient.removeModelLabCollectionMember(collectionId, bundleId);
        await loadAll();
      } catch (removeError) {
        setError(removeError instanceof Error ? removeError.message : "Modell konnte nicht entfernt werden.");
      }
    },
    [loadAll]
  );

  const searchHuggingFace = useCallback(async (query: string) => {
    if (!backendClient.searchModelLabHuggingFace) {
      setHfError("searchModelLabHuggingFace ist nicht verfuegbar.");
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setHfResults([]);
      return;
    }
    setHfSearching(true);
    setHfError(null);
    try {
      const results = await backendClient.searchModelLabHuggingFace(trimmed);
      setHfResults(results);
    } catch (searchError) {
      setHfError(searchError instanceof Error ? searchError.message : "HuggingFace-Suche fehlgeschlagen.");
      setHfResults([]);
    } finally {
      setHfSearching(false);
    }
  }, []);

  const selectedModel = models.find((model) => model.bundle.bundle_id === selectedBundleId) ?? null;

  return {
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
  };
}
