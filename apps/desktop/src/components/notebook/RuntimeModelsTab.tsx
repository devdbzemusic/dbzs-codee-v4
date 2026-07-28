import { useState } from "react";
import {
  formatModelSizeBadge,
  type IndexedModel,
  type MultimodalPair,
  type RuntimeProbeFailureCode,
  type RuntimeProbeResponse,
  type RuntimeStatus
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { modelRequiresVisionProjector, modelSupportsTextOnly } from "@/services/modelSelectionBroker";
import { useModelIndexStore } from "@/stores/modelIndexStore";
import { useRuntimeStore } from "@/stores/runtimeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isRunnableModel } from "@/utils/modelUtils";

type ProbeEvidenceTone = "ok" | "warn" | "error" | "info";

interface ProbeEvidenceItem {
  tone: ProbeEvidenceTone;
  text: string;
}

interface ProbeOutcomeSummary {
  label: string;
  tone: ProbeEvidenceTone;
}

function probeToneClasses(tone: ProbeEvidenceTone): string {
  if (tone === "ok") {
    return "border-dbzs-cyan/30 bg-dbzs-cyan/10 text-dbzs-cyan";
  }
  if (tone === "warn") {
    return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  }
  if (tone === "error") {
    return "border-red-400/30 bg-red-400/10 text-red-300";
  }
  return "border-dbzs-border bg-dbzs-bg text-dbzs-muted";
}

function ProbeEvidencePanel({
  feedback,
  outcome,
  evidence,
  align = "right"
}: {
  feedback: string;
  outcome: ProbeOutcomeSummary;
  evidence: ProbeEvidenceItem[];
  align?: "left" | "right";
}) {
  const alignClass = align === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <div className={`mt-1 flex max-w-[320px] flex-col gap-1 rounded border p-2 ${probeToneClasses(outcome.tone)} ${alignClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] ${probeToneClasses(outcome.tone)}`}>
          {outcome.label}
        </span>
        <span className="text-[10px]">{feedback}</span>
      </div>
      {evidence.length > 0 ? (
        <div className={`flex flex-col gap-1 text-[9px] ${alignClass}`}>
          {evidence.map((item) => (
            <span className={`rounded border px-1.5 py-1 ${probeToneClasses(item.tone)}`} key={`${item.tone}:${item.text}`}>
              {item.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  if (pair.routing_allowed) {
    return {
      statusLabel: "verified",
      hint: "Runtime-Probe erfolgreich; multimodales Routing ist freigegeben"
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

export function canProbeSupportArtifactPair(
  artifact: IndexedModel,
  pair: MultimodalPair | undefined
): boolean {
  return (
    artifact.artifact_type === "mmproj" &&
    pair?.status === "candidate" &&
    pair.routing_allowed !== true &&
    typeof pair.base_model_id === "string" &&
    pair.base_model_id.length > 0
  );
}

export function formatProbeFeedback(response: RuntimeProbeResponse): string {
  const details: string[] = [];
  if (response.endpoint_verified === true) {
    details.push("Endpoint ok");
  } else if (response.endpoint_verified === false) {
    details.push("Endpoint fehlt");
  }
  if (response.models_endpoint_verified === true) {
    details.push("/v1/models ok");
  } else if (response.models_endpoint_verified === false) {
    details.push("/v1/models fehlt");
  }
  if (Array.isArray(response.advertised_models) && response.advertised_models.length > 0) {
    details.push(`Modelle: ${response.advertised_models.join(", ")}`);
  }
  if (response.vision_chat_verified === true) {
    details.push("Bildtest ok");
  } else if (response.mmproj_path && response.vision_chat_verified === false) {
    details.push("Bildtest fehlt");
  }
  return details.length > 0 ? `${response.message} (${details.join(" | ")})` : response.message;
}

export function collectProbeEvidenceItems(response: RuntimeProbeResponse): ProbeEvidenceItem[] {
  const items: ProbeEvidenceItem[] = [];
  if (response.endpoint_verified === true) {
    items.push({ tone: "ok", text: "Basis-Endpoint: ok" });
  } else if (response.endpoint_verified === false) {
    items.push({ tone: "error", text: "Basis-Endpoint: fehlt" });
  }
  if (response.models_endpoint_verified === true) {
    items.push({ tone: "ok", text: "/v1/models: ok" });
  } else if (response.models_endpoint_verified === false) {
    items.push({ tone: "error", text: "/v1/models: fehlt" });
  }
  if (Array.isArray(response.advertised_models) && response.advertised_models.length > 0) {
    items.push({ tone: "info", text: `Gemeldete Modelle: ${response.advertised_models.join(", ")}` });
  }
  if (response.mmproj_path && response.vision_chat_verified === true) {
    items.push({ tone: "ok", text: "Bildtest: ok" });
  } else if (response.mmproj_path && response.vision_chat_verified === false) {
    items.push({ tone: "error", text: "Bildtest: fehlt" });
  }
  if (typeof response.vision_response_preview === "string" && response.vision_response_preview.length > 0) {
    items.push({ tone: "info", text: `Vision-Antwort: ${response.vision_response_preview}` });
  }
  if (typeof response.mmproj_path === "string" && response.mmproj_path.length > 0) {
    items.push({ tone: "info", text: `MMProj: ${response.mmproj_path}` });
  }
  if (typeof response.stderr_tail === "string" && response.stderr_tail.trim().length > 0) {
    items.push({ tone: "error", text: `stderr: ${response.stderr_tail.trim()}` });
  }
  if (typeof response.stdout_tail === "string" && response.stdout_tail.trim().length > 0) {
    items.push({ tone: "warn", text: `stdout: ${response.stdout_tail.trim()}` });
  }
  const failureSummary = describeProbeFailureCodes(response.verification_failures);
  if (failureSummary) {
    items.push({ tone: "error", text: `Fehlgeschlagene Checks: ${failureSummary}` });
  }
  return items;
}

export function collectProbeEvidenceLines(response: RuntimeProbeResponse): string[] {
  return collectProbeEvidenceItems(response).map((item) => item.text);
}

export function describeProbeFailureCodes(
  failureCodes: RuntimeProbeFailureCode[] | undefined
): string {
  if (!Array.isArray(failureCodes) || failureCodes.length === 0) {
    return "";
  }
  const labels: Record<RuntimeProbeFailureCode, string> = {
    allow_start_disabled: "allow_start",
    model_id_missing: "model_id",
    pair_missing: "pairing",
    projector_missing: "projector",
    runtime_start: "runtime_start",
    endpoint: "endpoint",
    models_endpoint: "models_endpoint",
    vision_chat: "vision_chat"
  };
  return failureCodes.map((code) => labels[code] ?? code).join(", ");
}

export function describeProbeOutcome(response: RuntimeProbeResponse): ProbeOutcomeSummary {
  if (response.allowed && (!response.verification_failures || response.verification_failures.length === 0)) {
    return { label: "Probe verifiziert", tone: "ok" };
  }
  if (Array.isArray(response.verification_failures) && response.verification_failures.length > 0) {
    return { label: "Probe blockiert", tone: "error" };
  }
  if (!response.allowed) {
    return { label: "Probe fehlgeschlagen", tone: "error" };
  }
  return { label: "Probe abgeschlossen", tone: "info" };
}

export function describeMultimodalPairStatus(pair: MultimodalPair): { label: string; hint: string } {
  if (pair.routing_allowed) {
    return {
      label: "verified",
      hint: "Routing freigegeben"
    };
  }
  if (pair.status === "candidate") {
    return {
      label: "candidate",
      hint: "Runtime-Probe noch offen"
    };
  }
  if (pair.status === "ambiguous") {
    return {
      label: "ambiguous",
      hint: "Mehrdeutige Basismodell-Zuordnung"
    };
  }
  if (pair.status === "missing_base") {
    return {
      label: "missing_base",
      hint: "Basismodell fehlt"
    };
  }
  return {
    label: pair.status,
    hint: "Nicht freigegeben"
  };
}

export function describeMultimodalPairCandidates(
  pair: MultimodalPair,
  modelsById: Map<string, IndexedModel>
): string {
  if (pair.candidate_base_model_ids.length === 0) {
    return pair.status === "missing_base" ? "Keine Kandidaten erkannt" : "";
  }
  const names = pair.candidate_base_model_ids.map((id) => modelsById.get(id)?.name ?? id);
  return `Kandidaten: ${names.join(", ")}`;
}

export function defaultPairingSelection(
  artifactId: string,
  pair: MultimodalPair,
  pairingSelections: Record<string, string>
): string {
  return pairingSelections[artifactId] ?? pair.base_model_id ?? pair.candidate_base_model_ids[0] ?? "";
}

export function shouldManagePairInControlCenter(
  artifact: IndexedModel,
  pair: MultimodalPair | undefined
): boolean {
  return artifact.artifact_type === "mmproj" && pair != null;
}

export function summarizeMultimodalPairs(pairs: MultimodalPair[]): Record<string, number> {
  const summary: Record<string, number> = {
    total: pairs.length,
    verified: 0,
    candidate: 0,
    ambiguous: 0,
    missing_base: 0
  };
  for (const pair of pairs) {
    if (pair.routing_allowed) {
      summary.verified += 1;
      continue;
    }
    if (pair.status in summary) {
      summary[pair.status] += 1;
    }
  }
  return summary;
}

export function shouldDisplaySupportArtifact(
  artifact: IndexedModel,
  pair: MultimodalPair | undefined
): boolean {
  return !shouldManagePairInControlCenter(artifact, pair);
}

export function formatMultimodalPairConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function formatMultimodalPairModalities(pair: MultimodalPair): string {
  return pair.modalities.length > 0 ? pair.modalities.join(" + ") : "-";
}

export function formatMultimodalPairSource(source: string): string {
  if (source === "same_folder") return "same_folder";
  if (source === "manual") return "manual";
  if (source === "catalog") return "catalog";
  return source || "-";
}

export function describeModelCapabilities(model: IndexedModel): string[] {
  const labels: string[] = [];
  if (model.capabilities.includes("chat")) labels.push("chat");
  if (model.capabilities.includes("code")) labels.push("code");
  if (model.capabilities.includes("vision")) labels.push("vision");
  if (model.capabilities.includes("reasoning")) labels.push("reasoning");
  return labels.length > 0 ? labels : ["-"];
}

export function describeModelRoutingReadiness(
  model: IndexedModel,
  multimodalPairs: MultimodalPair[]
): { label: string; hint: string } {
  const knownPair = multimodalPairs.find((pair) => pair.base_model_id === model.id);
  const verifiedPair = multimodalPairs.find(
    (pair) => pair.base_model_id === model.id && pair.routing_allowed === true
  );

  if (model.capabilities.includes("vision")) {
    if (knownPair || modelRequiresVisionProjector(model.id, [model])) {
      if (!verifiedPair) {
        return {
          label: "MM-Pair fehlt",
          hint: "Bildinput bleibt gesperrt, bis ein verifiziertes Projector-Pair vorliegt"
        };
      }
      if (!model.capabilities.includes("code")) {
        return {
          label: "Vision ohne Code",
          hint: "Bildanalyse moeglich, aber Screenshot-Coding/-Review bleibt am Code-Gate haengen"
        };
      }
      return {
        label: "Vision + Code",
        hint: "Verifiziertes MM-Pair vorhanden; fuer Screenshot-Coding/-Review geeignet"
      };
    }

    if (model.capabilities.includes("code")) {
      return {
        label: "Vision direkt",
        hint: modelSupportsTextOnly(model.id, [model])
          ? "Text-only und Bildturns moeglich; kein MM-Pair erforderlich"
          : "Bildturns moeglich; Text-only nur, wenn der Broker es explizit freigibt"
      };
    }

    return {
      label: "Vision Chat",
      hint: "Bildanalyse moeglich, aber fuer Coding-/Review-Turns fehlt die Code-Faehigkeit"
    };
  }

  if (model.capabilities.includes("code")) {
    return {
      label: "Text + Code",
      hint: "Geeignet fuer textbasierte Coding-, Review- und Debugging-Turns"
    };
  }

  return {
    label: "Text",
    hint: "Nur textbasierte Chat-/Planungsturns; kein Bildrouting"
  };
}

export function summarizeModelRoutingReadiness(
  models: IndexedModel[],
  multimodalPairs: MultimodalPair[]
): Record<
  "text" | "textCode" | "visionDirect" | "visionChat" | "visionBlocked" | "screenshotReady",
  number
> {
  const summary = {
    text: 0,
    textCode: 0,
    visionDirect: 0,
    visionChat: 0,
    visionBlocked: 0,
    screenshotReady: 0
  };

  for (const model of models) {
    const readiness = describeModelRoutingReadiness(model, multimodalPairs);
    if (readiness.label === "Text") {
      summary.text += 1;
    } else if (readiness.label === "Text + Code") {
      summary.textCode += 1;
    } else if (readiness.label === "Vision direkt") {
      summary.visionDirect += 1;
    } else if (readiness.label === "Vision Chat") {
      summary.visionChat += 1;
    } else if (readiness.label === "MM-Pair fehlt") {
      summary.visionBlocked += 1;
    } else if (readiness.label === "Vision + Code") {
      summary.screenshotReady += 1;
    }
  }

  return summary;
}

export function summarizeModelRoles(
  models: IndexedModel[]
): Record<"coding" | "chat" | "vision" | "orchestrator" | "other", number> {
  const summary = {
    coding: 0,
    chat: 0,
    vision: 0,
    orchestrator: 0,
    other: 0
  };

  for (const model of models) {
    if (model.recommended_use === "primary_coding" || model.recommended_use === "coding_candidate") {
      summary.coding += 1;
    } else if (model.recommended_use === "chat_candidate") {
      summary.chat += 1;
    } else if (model.recommended_use === "vision_candidate") {
      summary.vision += 1;
    } else if (model.recommended_use === "orchestrator") {
      summary.orchestrator += 1;
    } else {
      summary.other += 1;
    }
  }

  return summary;
}

export function sortMultimodalPairs(pairs: MultimodalPair[]): MultimodalPair[] {
  const priority = (pair: MultimodalPair): number => {
    if (pair.status === "ambiguous") return 0;
    if (pair.status === "missing_base") return 1;
    if (pair.routing_allowed) return 3;
    if (pair.status === "candidate") return 2;
    return 4;
  };
  return [...pairs].sort((left, right) => {
    const delta = priority(left) - priority(right);
    if (delta !== 0) return delta;
    if (left.routing_allowed !== right.routing_allowed) return left.routing_allowed ? 1 : -1;
    if (left.confidence !== right.confidence) return right.confidence - left.confidence;
    return left.projector_artifact_id.localeCompare(right.projector_artifact_id);
  });
}

export function RuntimeModelsTab() {
  const { index, isLoading: indexLoading, error: indexError, loadModelIndex } = useModelIndexStore();
  const { status, isLoading: runtimeBusy, error: runtimeError, startModel, stopModel } = useRuntimeStore();
  const backendHealth = useSettingsStore((state) => state.backendHealth);
  const [pairingSelections, setPairingSelections] = useState<Record<string, string>>({});
  const [pairingSaving, setPairingSaving] = useState<Record<string, boolean>>({});
  const [pairingProbing, setPairingProbing] = useState<Record<string, boolean>>({});
  const [pairingFeedback, setPairingFeedback] = useState<Record<string, string>>({});
  const [pairingOutcome, setPairingOutcome] = useState<Record<string, ProbeOutcomeSummary>>({});
  const [pairingEvidence, setPairingEvidence] = useState<Record<string, ProbeEvidenceItem[]>>({});
  const backendOnline = backendHealth?.status === "ok";
  const models = index?.models ?? [];
  const supportArtifacts = index?.support_artifacts ?? models.filter((model) => model.artifact_type !== "model");
  const multimodalPairs = index?.multimodal_pairs ?? [];
  const sortedMultimodalPairs = sortMultimodalPairs(multimodalPairs);
  const multimodalPairSummary = summarizeMultimodalPairs(multimodalPairs);
  const visibleSupportArtifacts = supportArtifacts.filter((artifact) => {
    const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
    return shouldDisplaySupportArtifact(artifact, pair);
  });
  const modelsById = new Map(models.map((model) => [model.id, model] as const));
  const supportArtifactsById = new Map(supportArtifacts.map((artifact) => [artifact.id, artifact] as const));
  const startableModels = models.filter((model) => model.artifact_type === "model");
  const pairingCandidates = listManualPairingCandidates(startableModels);
  const modelRoutingSummary = summarizeModelRoutingReadiness(startableModels, multimodalPairs);
  const modelRoleSummary = summarizeModelRoles(startableModels);
  const isRunning = status?.state === "running";

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panel px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-dbzs-text">Lokale Modelle</h2>
            <p className="mt-0.5 text-[11px] text-dbzs-muted">
              Backend: {backendOnline ? "aktiv" : "offline"}
              {status?.endpoint ? ` - ${status.endpoint}` : ""}
              {isRunning && status?.model_name ? ` - laeuft: ${status.model_name}` : ""}
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
            <span>Hilfsartefakte {visibleSupportArtifacts.length}</span>
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
        ) : startableModels.length === 0 && visibleSupportArtifacts.length === 0 ? (
          <p className="text-xs text-dbzs-muted">
            {indexError
              ? "Modellindex konnte nicht geladen werden - siehe Fehlermeldung oben."
              : "Keine Modelle im Index gefunden."}
          </p>
        ) : (
          <div className="space-y-6">
            {startableModels.length > 0 ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">
                    Startbare Modelle
                  </h3>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Coding {modelRoleSummary.coding}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Chat {modelRoleSummary.chat}
                  </span>
                  <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                    Vision {modelRoleSummary.vision}
                  </span>
                  <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                    Orchestrator {modelRoleSummary.orchestrator}
                  </span>
                  {modelRoleSummary.other > 0 ? (
                    <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                      Sonstige {modelRoleSummary.other}
                    </span>
                  ) : null}
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Text {modelRoutingSummary.text}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Text + Code {modelRoutingSummary.textCode}
                  </span>
                  <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                    Vision direkt {modelRoutingSummary.visionDirect}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-[10px] text-dbzs-muted">
                    Vision Chat {modelRoutingSummary.visionChat}
                  </span>
                  <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-300">
                    MM-Pair blockiert {modelRoutingSummary.visionBlocked}
                  </span>
                  <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                    Screenshot-ready {modelRoutingSummary.screenshotReady}
                  </span>
                </div>
                <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#091017]">
                    <tr className="border-b border-dbzs-border text-dbzs-muted">
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Modell</th>
                      <th className="px-2 py-2 font-medium">Rolle</th>
                      <th className="px-2 py-2 font-medium">Capabilities</th>
                      <th className="px-2 py-2 font-medium">Launcher</th>
                      <th className="px-2 py-2 font-medium">Compat</th>
                      <th className="px-2 py-2 font-medium">Routing</th>
                      <th className="px-2 py-2 font-medium">Groesse</th>
                      <th className="px-2 py-2 text-right font-medium">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {startableModels.map((model) => {
                      const { canStart, canStop, isActive } = modelRowActionState(model, status, runtimeBusy);
                      const capabilityLabels = describeModelCapabilities(model);
                      const routingReadiness = describeModelRoutingReadiness(model, multimodalPairs);
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
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="flex flex-wrap gap-1">
                              {capabilityLabels.map((label) => (
                                <span
                                  className="rounded border border-dbzs-border px-1.5 py-0.5 text-[9px]"
                                  key={`${model.id}:cap:${label}`}
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">{model.runtime_launcher}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{model.compatibility}</td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="flex max-w-[220px] flex-col gap-0.5">
                              <span>{routingReadiness.label}</span>
                              <span className="text-[10px] text-dbzs-muted/80">{routingReadiness.hint}</span>
                            </div>
                          </td>
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

            {sortedMultimodalPairs.length > 0 ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">
                    Multimodale Paare
                  </h3>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Gesamt {multimodalPairSummary.total}
                  </span>
                  <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                    Verifiziert {multimodalPairSummary.verified}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Offen {multimodalPairSummary.candidate}
                  </span>
                  <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                    Ambiguous {multimodalPairSummary.ambiguous}
                  </span>
                  <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-300">
                    Missing Base {multimodalPairSummary.missing_base}
                  </span>
                </div>
                <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
                  <thead className="bg-[#091017]">
                    <tr className="border-b border-dbzs-border text-dbzs-muted">
                      <th className="px-2 py-2 font-medium">Basismodell</th>
                      <th className="px-2 py-2 font-medium">Projector</th>
                      <th className="px-2 py-2 font-medium">Modalitaet</th>
                      <th className="px-2 py-2 font-medium">Quelle</th>
                      <th className="px-2 py-2 font-medium">Confidence</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Routing</th>
                      <th className="px-2 py-2 font-medium">Hinweis</th>
                      <th className="px-2 py-2 text-right font-medium">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMultimodalPairs.map((pair) => {
                      const baseModel = pair.base_model_id ? modelsById.get(pair.base_model_id) : undefined;
                      const projector = supportArtifactsById.get(pair.projector_artifact_id);
                      const pairStatus = describeMultimodalPairStatus(pair);
                      const candidateSummary = describeMultimodalPairCandidates(pair, modelsById);
                      const selectedBaseModelId = defaultPairingSelection(
                        pair.projector_artifact_id,
                        pair,
                        pairingSelections
                      );
                      const canPairManually = projector?.artifact_type === "mmproj" && pairingCandidates.length > 0;
                      const canProbePair =
                        pair.status === "candidate" &&
                        pair.routing_allowed !== true &&
                        typeof pair.base_model_id === "string" &&
                        pair.base_model_id.length > 0;
                      const feedbackKey = pair.projector_artifact_id;
                      return (
                        <tr className="border-b border-dbzs-border/50" key={pair.id}>
                          <td className="px-2 py-2 text-dbzs-text">{baseModel?.name ?? pair.base_model_id ?? "-"}</td>
                          <td className="px-2 py-2 text-dbzs-text">{projector?.name ?? pair.projector_artifact_id}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{formatMultimodalPairModalities(pair)}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{formatMultimodalPairSource(pair.source)}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{formatMultimodalPairConfidence(pair.confidence)}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{pairStatus.label}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{pair.routing_allowed ? "freigegeben" : "gesperrt"}</td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="flex flex-col gap-0.5">
                              <span>{pairStatus.hint}</span>
                              {candidateSummary ? (
                                <span className="text-[10px] text-dbzs-muted/80">{candidateSummary}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-col items-end gap-1">
                              {canPairManually ? (
                                <div className="flex max-w-[320px] gap-1">
                                  <select
                                    className="min-w-0 flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-text"
                                    onChange={(event) =>
                                      setPairingSelections((current) => ({
                                        ...current,
                                        [feedbackKey]: event.target.value
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
                                    disabled={!selectedBaseModelId || pairingSaving[feedbackKey] === true}
                                    onClick={() => void saveManualPairing(feedbackKey, selectedBaseModelId)}
                                    type="button"
                                  >
                                    {pairingSaving[feedbackKey] === true
                                      ? "Speichert ..."
                                      : pair.source === "manual"
                                        ? "Neu zuordnen"
                                        : "Zuordnen"}
                                  </button>
                                  <button
                                    className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
                                    disabled={!canProbePair || pairingProbing[feedbackKey] === true}
                                    onClick={() => {
                                      if (pair.base_model_id) {
                                        void probePairing(feedbackKey, pair.base_model_id);
                                      }
                                    }}
                                    type="button"
                                  >
                                    {pairingProbing[feedbackKey] === true ? "Prueft ..." : "Probe"}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
                                  disabled={!canProbePair || pairingProbing[feedbackKey] === true}
                                  onClick={() => {
                                    if (pair.base_model_id) {
                                      void probePairing(feedbackKey, pair.base_model_id);
                                    }
                                  }}
                                  type="button"
                                >
                                  {pairingProbing[feedbackKey] === true ? "Prueft ..." : "Probe"}
                                </button>
                              )}
                              {pairingFeedback[feedbackKey] && pairingOutcome[feedbackKey] ? (
                                <ProbeEvidencePanel
                                  align="right"
                                  evidence={pairingEvidence[feedbackKey] ?? []}
                                  feedback={pairingFeedback[feedbackKey]}
                                  outcome={pairingOutcome[feedbackKey]}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {visibleSupportArtifacts.length > 0 ? (
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
                    {visibleSupportArtifacts.map((artifact) => {
                      const description = describeSupportArtifact(artifact, multimodalPairs);
                      const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
                      const selectedBaseModelId =
                        pairingSelections[artifact.id] ?? pair?.base_model_id ?? pair?.candidate_base_model_ids[0] ?? "";
                      const canPairManually = artifact.artifact_type === "mmproj" && pairingCandidates.length > 0;
                      const manageInControlCenter = shouldManagePairInControlCenter(artifact, pair);
                      const canProbePair = canProbeSupportArtifactPair(artifact, pair);
                      return (
                        <tr className="border-b border-dbzs-border/50" key={artifact.id}>
                          <td className="max-w-[280px] truncate px-2 py-2 font-medium text-dbzs-text" title={artifact.path}>
                            {artifact.name}
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">{artifact.artifact_type}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{description.statusLabel}</td>
                          <td className="px-2 py-2 text-dbzs-muted">{description.hint}</td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            {manageInControlCenter ? (
                              <span className="text-[10px] text-dbzs-muted">
                                Im Bereich "Multimodale Paare" verwalten
                              </span>
                            ) : canPairManually ? (
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
                                  <button
                                    className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
                                    disabled={!canProbePair || pairingProbing[artifact.id] === true}
                                    onClick={() => {
                                      if (pair?.base_model_id) {
                                        void probePairing(artifact.id, pair.base_model_id);
                                      }
                                    }}
                                    type="button"
                                  >
                                    {pairingProbing[artifact.id] === true ? "Prueft ..." : "Probe"}
                                  </button>
                                </div>
                                {pairingFeedback[artifact.id] && pairingOutcome[artifact.id] ? (
                                  <ProbeEvidencePanel
                                    align="left"
                                    evidence={pairingEvidence[artifact.id] ?? []}
                                    feedback={pairingFeedback[artifact.id]}
                                    outcome={pairingOutcome[artifact.id]}
                                  />
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
