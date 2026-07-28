import { useState } from "react";
import { formatModelSizeBadge, type IndexedModel, type MultimodalPair, type RuntimeStatus } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isRunnableModel } from "@/utils/modelUtils";

export function modelRowActionState(
  model: IndexedModel,
  status: RuntimeStatus | null,
  runtimeBusy: boolean
): { canStart: boolean; canStop: boolean; isActive: boolean } {
  const runnable = isRunnableModel(model);
  const isRunning = status?.state === "running";
  const isActive =
    isRunning &&
    (status?.model_id === model.id ||
      (status?.model_name != null && status.model_name === model.name));

  return {
    isActive,
    canStart: runnable && !runtimeBusy && !isRunning,
    canStop: isActive && !runtimeBusy
  };
}

export function canStopRuntime(status: RuntimeStatus | null, runtimeBusy: boolean): boolean {
  return status?.state === "running" && !runtimeBusy;
}

export function listManualPairingCandidates(models: IndexedModel[]): IndexedModel[] {
  return models.filter((model) => model.artifact_type === "model" && model.format === "gguf");
}

export function describeSupportArtifact(
  artifact: IndexedModel,
  multimodalPairs: MultimodalPair[]
): { statusLabel: string; hint: string } {
  const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
  if (artifact.artifact_type !== "mmproj") {
    return {
      statusLabel: artifact.compatibility,
      hint: "Im Modellindex sichtbar, aber nicht ueber Runtime startbar"
    };
  }
  if (!pair) {
    return {
      statusLabel: "orphan",
      hint: "Kein passendes Basismodell erkannt; Routing bleibt gesperrt"
    };
  }
  if (pair.status === "candidate") {
    if (pair.source === "manual") {
      return {
        statusLabel: "candidate",
        hint: "Manuelle Zuordnung gespeichert; Runtime-Probe und Routing bleiben noch gesperrt"
      };
    }
    if (pair.source === "catalog") {
      return {
        statusLabel: "candidate",
        hint: "Katalog-Zuordnung erkannt, aber noch nicht runtime-verifiziert"
      };
    }
    return {
      statusLabel: "candidate",
      hint: "Same-Folder-Paar erkannt, aber noch nicht runtime-verifiziert"
    };
  }
  if (pair.status === "ambiguous") {
    return {
      statusLabel: "ambiguous",
      hint: "Mehrere Basismodell-Kandidaten erkannt; keine automatische Freigabe"
    };
  }
  if (pair.status === "missing_base") {
    return {
      statusLabel: "missing_base",
      hint: "Projector erkannt, aber kein Basismodell im selben Ordner gefunden"
    };
  }
  return {
    statusLabel: pair.status,
    hint: "Kein eigenstaendig startbares Modell"
  };
}

export function RuntimeModelsTab() {
  const { index, isLoading: indexLoading, error: indexError, loadModelIndex } = useModelIndexStore();
  const { status, isLoading: runtimeBusy, error: runtimeError, startModel, stopModel } = useRuntimeStore();
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const [pairingSelections, setPairingSelections] = useState<Record<string, string>>({});
  const [pairingSaving, setPairingSaving] = useState<Record<string, boolean>>({});
  const [pairingFeedback, setPairingFeedback] = useState<Record<string, string>>({});
  const backendOnline = backendHealth?.status === "ok";
  const models = index?.models ?? [];
  const supportArtifacts = index?.support_artifacts ?? models.filter((model) => model.artifact_type !== "model");
  const multimodalPairs = index?.multimodal_pairs ?? [];
  const startableModels = models.filter((model) => model.artifact_type === "model");
  const pairingCandidates = listManualPairingCandidates(startableModels);
  const isRunning = status?.state === "running";

  const saveManualPairing = async (artifactId: string, baseModelId: string) => {
    setPairingSaving((current) => ({ ...current, [artifactId]: true }));
    setPairingFeedback((current) => ({ ...current, [artifactId]: "" }));
    try {
      await backendClient.saveManualMultimodalPairing({
        base_model_id: baseModelId,
        projector_artifact_id: artifactId,
      });
      await loadModelIndex();
      setPairingFeedback((current) => ({
        ...current,
        [artifactId]: "Manuelle Zuordnung gespeichert."
      }));
    } catch (error) {
      setPairingFeedback((current) => ({
        ...current,
        [artifactId]: error instanceof Error ? error.message : "Manuelle Zuordnung fehlgeschlagen."
      }));
    } finally {
      setPairingSaving((current) => ({ ...current, [artifactId]: false }));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panel px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-dbzs-text">Lokale Modelle</h2>
            <p className="mt-0.5 text-[11px] text-dbzs-muted">
              Backend: {backendOnline ? "aktiv" : "offline"}
              {status?.endpoint ? ` · ${status.endpoint}` : ""}
              {isRunning && status?.model_name ? ` · läuft: ${status.model_name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isRunning ? (
              <button
                className="border border-red-400/50 bg-red-400/10 px-3 py-1 text-xs font-medium text-red-300 disabled:opacity-40"
                disabled={!canStopRuntime(status, runtimeBusy)}
                onClick={() => void stopModel()}
                type="button"
              >
                {runtimeBusy ? "Stoppt ..." : "Runtime stoppen"}
              </button>
            ) : null}
            <button
              className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
              disabled={indexLoading}
              onClick={() => void loadModelIndex()}
              type="button"
            >
              Index aktualisieren
            </button>
          </div>
        </div>
        {index ? (
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-dbzs-muted">
            <span>Gesamt {index.summary.total}</span>
            <span>GGUF {index.summary.gguf_total}</span>
            <span>llama-server {index.summary.llama_server_ready}</span>
            <span>Ollama {index.summary.ollama_ready}</span>
            <span>Hilfsartefakte {index.summary.support_artifact_count ?? supportArtifacts.length}</span>
            <span>MM-Paare {multimodalPairs.length}</span>
          </div>
        ) : null}
        {indexError ? <p className="mt-2 text-xs text-dbzs-red">Modellindex: {indexError}</p> : null}
        {runtimeError ? <p className="mt-2 text-xs text-dbzs-red">{runtimeError}</p> : null}
        {status?.message && status.state !== "running" ? (
          <p className="mt-2 text-xs text-dbzs-muted">{status.message}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!index ? (
          <p className="text-xs text-dbzs-muted">
            {indexLoading ? "Indexiere lokale Modelle ..." : "Noch kein Modellindex geladen."}
          </p>
        ) : startableModels.length === 0 && supportArtifacts.length === 0 ? (
          <p className="text-xs text-dbzs-muted">
            {indexError
              ? "Modellindex konnte nicht geladen werden - siehe Fehlermeldung oben."
              : "Keine Modelle im Index gefunden."}
          </p>
        ) : (
          <div className="space-y-6">
            {startableModels.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">
                  Startbare Modelle
                </h3>
                <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#091017]">
                    <tr className="border-b border-dbzs-border text-dbzs-muted">
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Modell</th>
                      <th className="px-2 py-2 font-medium">Rolle</th>
                      <th className="px-2 py-2 font-medium">Launcher</th>
                      <th className="px-2 py-2 font-medium">Compat</th>
                      <th className="px-2 py-2 font-medium">Groesse</th>
                      <th className="px-2 py-2 text-right font-medium">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {startableModels.map((model) => {
                      const { canStart, canStop, isActive } = modelRowActionState(model, status, runtimeBusy);
                      return (
                        <tr
                          className={`border-b border-dbzs-border/50 ${isActive ? "bg-dbzs-cyan/5" : ""}`}
                          key={model.id}
                        >
                          <td className="px-2 py-2">
                            {isActive ? (
                              <span className="inline-flex items-center gap-1 text-dbzs-cyan">
                                <span className="h-1.5 w-1.5 rounded-full bg-dbzs-cyan" />
                                laeuft
                              </span>
                            ) : (
                              <span className="text-dbzs-muted">-</span>
                            )}
                          </td>
                          <td className="max-w-[220px] truncate px-2 py-2 font-medium text-dbzs-text" title={model.name}>
                            {model.name}
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">{model.recommended_use}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{model.runtime_launcher}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{model.compatibility}</td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            {model.size_bytes > 0 ? formatModelSizeBadge(model.size_bytes) : "-"}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex justify-end gap-1">
                              <button
                                className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
                                disabled={!canStart}
                                onClick={() => void startModel(model.id)}
                                title={isRunnableModel(model) ? "Modell laden" : "Modell nicht startbar"}
                                type="button"
                              >
                                Laden
                              </button>
                              <button
                                className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted disabled:opacity-40"
                                disabled={!canStop}
                                onClick={() => void stopModel()}
                                title="Modell stoppen"
                                type="button"
                              >
                                Stoppen
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {supportArtifacts.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">
                  Hilfsartefakte
                </h3>
                <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
                  <thead className="bg-[#091017]">
                    <tr className="border-b border-dbzs-border text-dbzs-muted">
                      <th className="px-2 py-2 font-medium">Datei</th>
                      <th className="px-2 py-2 font-medium">Typ</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Hinweis</th>
                      <th className="px-2 py-2 font-medium">Zuordnung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supportArtifacts.map((artifact) => {
                      const description = describeSupportArtifact(artifact, multimodalPairs);
                      const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
                      const selectedBaseModelId =
                        pairingSelections[artifact.id] ?? pair?.base_model_id ?? pair?.candidate_base_model_ids[0] ?? "";
                      const canPairManually = artifact.artifact_type === "mmproj" && pairingCandidates.length > 0;
                      return (
                        <tr className="border-b border-dbzs-border/50" key={artifact.id}>
                          <td className="max-w-[280px] truncate px-2 py-2 font-medium text-dbzs-text" title={artifact.path}>
                            {artifact.name}
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">{artifact.artifact_type}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{description.statusLabel}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{description.hint}</td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            {canPairManually ? (
                              <div className="flex min-w-[280px] flex-col gap-1">
                                <div className="flex gap-2">
                                  <select
                                    className="min-w-0 flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-text"
                                    onChange={(event) =>
                                      setPairingSelections((current) => ({
                                        ...current,
                                        [artifact.id]: event.target.value
                                      }))
                                    }
                                    value={selectedBaseModelId}
                                  >
                                    <option value="">Basismodell waehlen</option>
                                    {pairingCandidates.map((model) => (
                                      <option key={model.id} value={model.id}>
                                        {model.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-text disabled:opacity-40"
                                    disabled={!selectedBaseModelId || pairingSaving[artifact.id] === true}
                                    onClick={() => void saveManualPairing(artifact.id, selectedBaseModelId)}
                                    type="button"
                                  >
                                    {pairingSaving[artifact.id] === true
                                      ? "Speichert ..."
                                      : pair?.source === "manual"
                                        ? "Neu zuordnen"
                                        : "Zuordnen"}
                                  </button>
                                </div>
                                {pairingFeedback[artifact.id] ? (
                                  <span className="text-[10px] text-dbzs-muted">{pairingFeedback[artifact.id]}</span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[10px] text-dbzs-muted">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
