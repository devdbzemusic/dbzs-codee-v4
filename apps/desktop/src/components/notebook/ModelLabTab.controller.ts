import { useCallback, useEffect, useState } from "react";
import type {
  ModelLabModel,
  ModelLabScanJob,
  ModelLabSource,
  ModelLabSourceCreate
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useSettingsStore } from "@/stores/settingsStore";

export function useModelLabTabController() {
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const backendOnline = backendHealth?.status === "ok";

  const [sources, setSources] = useState<ModelLabSource[]>([]);
  const [models, setModels] = useState<ModelLabModel[]>([]);
  const [jobs, setJobs] = useState<ModelLabScanJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSourcePath, setNewSourcePath] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextSources, nextModels, nextJobs] = await Promise.all([
        backendClient.listModelLabSources ? backendClient.listModelLabSources() : Promise.resolve([]),
        backendClient.listModelLabModels ? backendClient.listModelLabModels() : Promise.resolve([]),
        backendClient.listModelLabJobs ? backendClient.listModelLabJobs() : Promise.resolve([])
      ]);
      setSources(nextSources);
      setModels(nextModels);
      setJobs(nextJobs);
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
        await backendClient.runModelLabScan(sourceId ? { source_id: sourceId } : undefined);
        await loadAll();
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : "Scan fehlgeschlagen.");
      } finally {
        setIsScanning(false);
      }
    },
    [loadAll]
  );

  const selectedModel = models.find((model) => model.bundle.bundle_id === selectedBundleId) ?? null;

  return {
    backendOnline,
    sources,
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
    selectedModel
  };
}
