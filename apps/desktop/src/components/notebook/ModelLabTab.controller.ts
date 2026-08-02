import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ModelLabCertificationRequest,
  ModelLabCollection,
  ModelLabCollectionCreate,
  ModelLabHuggingFaceSearchResult,
  ModelLabModel,
  ModelLabReadinessEntry,
  ModelLabRoleAssignment,
  ModelLabRoleAssignmentRequest,
  ModelLabRoutingEntry,
  ModelLabScanJob,
  ModelLabSource,
  ModelLabSourceCandidate,
  ModelLabSourceCreate
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useSettingsStore } from "@/stores/settingsStore";

export function findSettingsFieldConflicts(assignments: ModelLabRoleAssignment[]): Set<string> {
  const bundlesByField = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!assignment.settings_field || !assignment.enabled) {
      continue;
    }
    const bundles = bundlesByField.get(assignment.settings_field) ?? new Set<string>();
    bundles.add(assignment.bundle_id);
    bundlesByField.set(assignment.settings_field, bundles);
  }
  const conflicting = new Set<string>();
  for (const bundles of bundlesByField.values()) {
    if (bundles.size > 1) {
      for (const bundleId of bundles) {
        conflicting.add(bundleId);
      }
    }
  }
  return conflicting;
}

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
  const [roleAssignments, setRoleAssignments] = useState<ModelLabRoleAssignment[]>([]);
  const [assigningRole, setAssigningRole] = useState(false);
  const [certifyingModel, setCertifyingModel] = useState(false);
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
        nextReadinessMap,
        nextRoleAssignments
      ] = await Promise.all([
        backendClient.listModelLabSources ? backendClient.listModelLabSources() : Promise.resolve([]),
        backendClient.listModelLabSourceCandidates
          ? backendClient.listModelLabSourceCandidates()
          : Promise.resolve([]),
        backendClient.listModelLabModels ? backendClient.listModelLabModels() : Promise.resolve([]),
        backendClient.listModelLabJobs ? backendClient.listModelLabJobs() : Promise.resolve([]),
        backendClient.listModelLabCollections ? backendClient.listModelLabCollections() : Promise.resolve([]),
        backendClient.listModelRoutingMap ? backendClient.listModelRoutingMap() : Promise.resolve([]),
        backendClient.listModelReadiness ? backendClient.listModelReadiness() : Promise.resolve([]),
        backendClient.listModelRoleAssignments ? backendClient.listModelRoleAssignments() : Promise.resolve([])
      ]);
      setSources(nextSources);
      setSourceCandidates(nextSourceCandidates);
      setModels(nextModels);
      setJobs(nextJobs);
      setCollections(nextCollections);
      setRoutingMap(nextRoutingMap);
      setReadinessMap(nextReadinessMap);
      setRoleAssignments(nextRoleAssignments);
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

  const assignRole = useCallback(
    async (request: ModelLabRoleAssignmentRequest) => {
      if (!backendClient.assignModelRole) {
        setError("assignModelRole ist nicht verfuegbar.");
        return;
      }
      setAssigningRole(true);
      setError(null);
      try {
        await backendClient.assignModelRole(request);
        await loadAll();
      } catch (assignError) {
        setError(assignError instanceof Error ? assignError.message : "Rollenzuordnung fehlgeschlagen.");
      } finally {
        setAssigningRole(false);
      }
    },
    [loadAll]
  );

  const certifyModel = useCallback(
    async (request: ModelLabCertificationRequest) => {
      if (!backendClient.certifyModel) {
        setError("certifyModel ist nicht verfuegbar.");
        return;
      }
      setCertifyingModel(true);
      setError(null);
      try {
        await backendClient.certifyModel(request);
        await loadAll();
      } catch (certifyError) {
        setError(certifyError instanceof Error ? certifyError.message : "Zertifizierung fehlgeschlagen.");
      } finally {
        setCertifyingModel(false);
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
  const settingsFieldConflicts = useMemo(() => findSettingsFieldConflicts(roleAssignments), [roleAssignments]);

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
    roleAssignments,
    assigningRole,
    assignRole,
    certifyingModel,
    certifyModel,
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
  };
}
