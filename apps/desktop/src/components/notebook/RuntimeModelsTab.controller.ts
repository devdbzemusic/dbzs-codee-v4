import { useEffect, useState } from "react";
import type { RuntimeSlotStatus } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { getAllSlotHealthStates, type SlotHealthState } from "@/services/runtimeProcessSupervisor";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { PairingUiController } from "./RuntimeModelsTab.pairing";
import type { ProbeEvidenceItem, ProbeOutcomeSummary } from "./RuntimeModelsTab.primitives";
import {
  collectDiagnosticsIssues,
  collectProbeEvidenceItems,
  describeProbeOutcome,
  formatProbeFeedback,
  listManualPairingCandidates,
  shouldDisplaySupportArtifact,
  sortMultimodalPairs,
  sortStartableModels,
  sortVisibleSupportArtifacts,
  summarizeModelRoles,
  summarizeModelRoutingReadiness,
  summarizeMultimodalPairActions,
  summarizeMultimodalPairSources,
  summarizeMultimodalPairs,
  summarizeStartableModelActions,
  summarizeSupportArtifacts,
  summarizeVisibleSupportArtifactActions,
  summarizeVisibleSupportArtifactStatuses
} from "./RuntimeModelsTab.helpers";

export function useRuntimeModelsTabController() {
  const { index, isLoading: indexLoading, error: indexError, loadModelIndex } = useModelIndexStore();
  const { status, isLoading: runtimeBusy, error: runtimeError, startModel, stopModel } = useRuntimeStore();
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const [pairingSelections, setPairingSelections] = useState<Record<string, string>>({});
  const [pairingSaving, setPairingSaving] = useState<Record<string, boolean>>({});
  const [pairingProbing, setPairingProbing] = useState<Record<string, boolean>>({});
  const [pairingFeedback, setPairingFeedback] = useState<Record<string, string>>({});
  const [pairingOutcome, setPairingOutcome] = useState<Record<string, ProbeOutcomeSummary>>({});
  const [pairingEvidence, setPairingEvidence] = useState<Record<string, ProbeEvidenceItem[]>>({});
  const [tuningInProgress, setTuningInProgress] = useState<Record<string, boolean>>({});
  const [tuningFeedback, setTuningFeedback] = useState<Record<string, string>>({});
  const [slotStatuses, setSlotStatuses] = useState<RuntimeSlotStatus[]>([]);
  const [slotHealthStates, setSlotHealthStates] = useState<SlotHealthState[]>([]);
  const backendOnline = backendHealth?.status === "ok";
  const models = index?.models ?? [];
  const supportArtifacts = index?.support_artifacts ?? models.filter((model) => model.artifact_type !== "model");
  const multimodalPairs = index?.multimodal_pairs ?? [];
  const sortedMultimodalPairs = sortMultimodalPairs(multimodalPairs);
  const multimodalPairSummary = summarizeMultimodalPairs(multimodalPairs);
  const multimodalPairSourceSummary = summarizeMultimodalPairSources(multimodalPairs);
  const multimodalPairActionSummary = summarizeMultimodalPairActions(multimodalPairs);
  const visibleSupportArtifacts = supportArtifacts.filter((artifact) => {
    const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
    return shouldDisplaySupportArtifact(artifact, pair);
  });
  const modelsById = new Map(models.map((model) => [model.id, model] as const));
  const supportArtifactsById = new Map(supportArtifacts.map((artifact) => [artifact.id, artifact] as const));
  const startableModels = models.filter((model) => model.artifact_type === "model");
  const sortedStartableModels = sortStartableModels(startableModels, multimodalPairs, status);
  const pairingCandidates = listManualPairingCandidates(startableModels);
  const sortedVisibleSupportArtifacts = sortVisibleSupportArtifacts(
    visibleSupportArtifacts,
    multimodalPairs,
    pairingCandidates
  );
  const supportArtifactSummary = summarizeSupportArtifacts(sortedVisibleSupportArtifacts);
  const supportArtifactActionSummary = summarizeVisibleSupportArtifactActions(
    sortedVisibleSupportArtifacts,
    multimodalPairs,
    pairingCandidates
  );
  const supportArtifactStatusSummary = summarizeVisibleSupportArtifactStatuses(
    sortedVisibleSupportArtifacts,
    multimodalPairs
  );
  const modelRoutingSummary = summarizeModelRoutingReadiness(sortedStartableModels, multimodalPairs);
  const modelRoleSummary = summarizeModelRoles(sortedStartableModels);
  const startableModelActionSummary = summarizeStartableModelActions(
    sortedStartableModels,
    status,
    runtimeBusy
  );
  const diagnosticsIssues = collectDiagnosticsIssues(
    sortedStartableModels,
    multimodalPairs,
    sortedVisibleSupportArtifacts
  );

  useEffect(() => {
    let cancelled = false;

    const loadSlotOperations = async () => {
      const statuses = await runtimeSlotManager.getAllSlotsStatus().catch(() => []);
      if (cancelled) {
        return;
      }
      setSlotStatuses(statuses);
      setSlotHealthStates(getAllSlotHealthStates());
    };

    void loadSlotOperations();
    const interval = window.setInterval(() => {
      void loadSlotOperations();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const onSelectionChange = (artifactId: string, value: string) => {
    setPairingSelections((current) => ({
      ...current,
      [artifactId]: value
    }));
  };

  const resetPairingProbeUi = (artifactId: string) => {
    setPairingFeedback((current) => ({ ...current, [artifactId]: "" }));
    setPairingOutcome((current) => {
      const next = { ...current };
      delete next[artifactId];
      return next;
    });
    setPairingEvidence((current) => ({ ...current, [artifactId]: [] }));
  };

  const saveManualPairing = async (artifactId: string, baseModelId: string) => {
    setPairingSaving((current) => ({ ...current, [artifactId]: true }));
    resetPairingProbeUi(artifactId);
    try {
      await backendClient.saveManualMultimodalPairing({
        base_model_id: baseModelId,
        projector_artifact_id: artifactId
      });
      await loadModelIndex();
      setPairingFeedback((current) => ({
        ...current,
        [artifactId]: "Manuelle Zuordnung gespeichert."
      }));
      setPairingOutcome((current) => ({
        ...current,
        [artifactId]: { label: "Zuordnung aktualisiert", tone: "info" }
      }));
      setPairingEvidence((current) => ({
        ...current,
        [artifactId]: [{ tone: "info", text: `Basismodell: ${baseModelId}` }]
      }));
    } catch (error) {
      setPairingFeedback((current) => ({
        ...current,
        [artifactId]: error instanceof Error ? error.message : "Manuelle Zuordnung fehlgeschlagen."
      }));
      setPairingOutcome((current) => ({
        ...current,
        [artifactId]: { label: "Zuordnung fehlgeschlagen", tone: "error" }
      }));
    } finally {
      setPairingSaving((current) => ({ ...current, [artifactId]: false }));
    }
  };

  const probePairing = async (artifactId: string, baseModelId: string) => {
    setPairingProbing((current) => ({ ...current, [artifactId]: true }));
    resetPairingProbeUi(artifactId);
    try {
      const response = await backendClient.probeRuntimeModel({
        allow_start: true,
        model_id: baseModelId,
        projector_artifact_id: artifactId
      });
      if (response.allowed) {
        await loadModelIndex();
      }
      setPairingFeedback((current) => ({
        ...current,
        [artifactId]: formatProbeFeedback(response)
      }));
      setPairingOutcome((current) => ({
        ...current,
        [artifactId]: describeProbeOutcome(response)
      }));
      setPairingEvidence((current) => ({
        ...current,
        [artifactId]: collectProbeEvidenceItems(response)
      }));
    } catch (error) {
      setPairingFeedback((current) => ({
        ...current,
        [artifactId]: error instanceof Error ? error.message : "Probe fehlgeschlagen."
      }));
      setPairingOutcome((current) => ({
        ...current,
        [artifactId]: { label: "Probe fehlgeschlagen", tone: "error" }
      }));
      setPairingEvidence((current) => ({ ...current, [artifactId]: [] }));
    } finally {
      setPairingProbing((current) => ({ ...current, [artifactId]: false }));
    }
  };

  const autoTuneModel = async (modelId: string) => {
    if (!backendClient.probeRuntimeModel) {
      setTuningFeedback((current) => ({ ...current, [modelId]: "Auto-Tuning ist nicht verfuegbar." }));
      return;
    }
    setTuningInProgress((current) => ({ ...current, [modelId]: true }));
    setTuningFeedback((current) => ({ ...current, [modelId]: "" }));
    try {
      const response = await backendClient.probeRuntimeModel({ allow_start: true, model_id: modelId });
      if (response.allowed) {
        await loadModelIndex();
        setTuningFeedback((current) => ({ ...current, [modelId]: "Tuning abgeschlossen - Modell wurde getestet." }));
      } else {
        setTuningFeedback((current) => ({ ...current, [modelId]: response.message || "Tuning nicht moeglich." }));
      }
    } catch (error) {
      setTuningFeedback((current) => ({
        ...current,
        [modelId]: error instanceof Error ? error.message : "Auto-Tuning fehlgeschlagen."
      }));
    } finally {
      setTuningInProgress((current) => ({ ...current, [modelId]: false }));
    }
  };

  const pairingUi: PairingUiController = {
    pairingSelections,
    onSelectionChange,
    pairingSaving,
    pairingProbing,
    pairingFeedback,
    pairingOutcome,
    pairingEvidence,
    saveManualPairing,
    probePairing
  };

  return {
    autoTuneModel,
    backendOnline,
    diagnosticsIssues,
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
    slotHealthStates,
    slotStatuses,
    modelRoleSummary,
    modelRoutingSummary,
    tuningFeedback,
    tuningInProgress,
    visibleSupportArtifacts
  };
}
