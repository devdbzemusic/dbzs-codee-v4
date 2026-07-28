import type {
  IndexedModel,
  MultimodalPair,
  RuntimeProbeFailureCode,
  RuntimeProbeResponse,
  RuntimeStatus
} from "@dbzs/shared";
import { modelRequiresVisionProjector, modelSupportsTextOnly } from "@/services/modelSelectionBroker";
import { isRunnableModel } from "@/utils/modelUtils";
import type { ProbeEvidenceItem, ProbeOutcomeSummary } from "./RuntimeModelsTab.primitives";

function parentDirectoryLabel(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return normalized || "-";
  }
  return segments[segments.length - 2] || normalized;
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

export function describeModelRowStatus(
  model: IndexedModel,
  status: RuntimeStatus | null,
  runtimeBusy: boolean
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  const actionState = modelRowActionState(model, status, runtimeBusy);
  if (actionState.isActive) {
    return { label: "laeuft", tone: "ok" };
  }
  if (actionState.canStart) {
    return { label: "ladbar", tone: "info" };
  }
  return { label: "blockiert", tone: "error" };
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
      hint: "Ordner-Paar erkannt, aber noch nicht runtime-verifiziert"
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
      hint: "Projektor erkannt, aber kein Basismodell im selben Ordner gefunden"
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
      label: "Verifiziert",
      hint: "Routing freigegeben"
    };
  }
  if (pair.status === "candidate") {
    return {
      label: "Kandidat",
      hint: "Runtime-Probe noch offen"
    };
  }
  if (pair.status === "ambiguous") {
    return {
      label: "Mehrdeutig",
      hint: "Mehrdeutige Basismodell-Zuordnung"
    };
  }
  if (pair.status === "missing_base") {
    return {
      label: "Basis fehlt",
      hint: "Basismodell fehlt"
    };
  }
  return {
    label: pair.status.replaceAll("_", " "),
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

export function summarizeMultimodalPairSources(
  pairs: MultimodalPair[]
): Record<"manual" | "catalog" | "sameFolder" | "other", number> {
  const summary = {
    manual: 0,
    catalog: 0,
    sameFolder: 0,
    other: 0
  };

  for (const pair of pairs) {
    if (pair.source === "manual") {
      summary.manual += 1;
    } else if (pair.source === "catalog") {
      summary.catalog += 1;
    } else if (pair.source === "same_folder") {
      summary.sameFolder += 1;
    } else {
      summary.other += 1;
    }
  }

  return summary;
}

export function summarizeMultimodalPairActions(
  pairs: MultimodalPair[]
): Record<"probeReady" | "needsAssignment" | "resolved" | "blocked", number> {
  const summary = {
    probeReady: 0,
    needsAssignment: 0,
    resolved: 0,
    blocked: 0
  };

  for (const pair of pairs) {
    if (pair.routing_allowed) {
      summary.resolved += 1;
      continue;
    }
    if (pair.status === "candidate" && pair.base_model_id) {
      summary.probeReady += 1;
      continue;
    }
    if (
      (pair.status === "ambiguous" && pair.candidate_base_model_ids.length > 0) ||
      (pair.status === "missing_base" && pair.candidate_base_model_ids.length > 0)
    ) {
      summary.needsAssignment += 1;
      continue;
    }
    summary.blocked += 1;
  }

  return summary;
}

export function summarizeSupportArtifacts(
  artifacts: IndexedModel[]
): Record<"mmproj" | "adapter" | "other", number> {
  const summary = {
    mmproj: 0,
    adapter: 0,
    other: 0
  };

  for (const artifact of artifacts) {
    if (artifact.artifact_type === "mmproj") {
      summary.mmproj += 1;
    } else if (artifact.artifact_type === "adapter" || artifact.artifact_type === "lora") {
      summary.adapter += 1;
    } else {
      summary.other += 1;
    }
  }

  return summary;
}

export function summarizeVisibleSupportArtifactStatuses(
  artifacts: IndexedModel[],
  pairs: MultimodalPair[]
): Record<"verified" | "candidate" | "orphan" | "other", number> {
  const summary = {
    verified: 0,
    candidate: 0,
    orphan: 0,
    other: 0
  };

  for (const artifact of artifacts) {
    const description = describeSupportArtifact(artifact, pairs);
    if (description.statusLabel === "verified") {
      summary.verified += 1;
    } else if (description.statusLabel === "candidate") {
      summary.candidate += 1;
    } else if (description.statusLabel === "orphan") {
      summary.orphan += 1;
    } else {
      summary.other += 1;
    }
  }

  return summary;
}

export function summarizeVisibleSupportArtifactActions(
  artifacts: IndexedModel[],
  pairs: MultimodalPair[],
  pairingCandidates: IndexedModel[]
): Record<"probeReady" | "manualAssignment" | "readOnly", number> {
  const summary = {
    probeReady: 0,
    manualAssignment: 0,
    readOnly: 0
  };

  for (const artifact of artifacts) {
    const pair = pairs.find((entry) => entry.projector_artifact_id === artifact.id);
    if (canProbeSupportArtifactPair(artifact, pair)) {
      summary.probeReady += 1;
      continue;
    }

    const canPairManually = artifact.artifact_type === "mmproj" && pairingCandidates.length > 0;
    if (canPairManually) {
      summary.manualAssignment += 1;
      continue;
    }

    summary.readOnly += 1;
  }

  return summary;
}

export function sortVisibleSupportArtifacts(
  artifacts: IndexedModel[],
  pairs: MultimodalPair[],
  pairingCandidates: IndexedModel[]
): IndexedModel[] {
  return [...artifacts].sort((left, right) => {
    const leftPair = pairs.find((entry) => entry.projector_artifact_id === left.id);
    const rightPair = pairs.find((entry) => entry.projector_artifact_id === right.id);
    const leftProbeReady = canProbeSupportArtifactPair(left, leftPair);
    const rightProbeReady = canProbeSupportArtifactPair(right, rightPair);
    if (leftProbeReady !== rightProbeReady) {
      return leftProbeReady ? -1 : 1;
    }

    const leftManual = left.artifact_type === "mmproj" && pairingCandidates.length > 0;
    const rightManual = right.artifact_type === "mmproj" && pairingCandidates.length > 0;
    if (leftManual !== rightManual) {
      return leftManual ? -1 : 1;
    }

    if (left.artifact_type !== right.artifact_type) {
      return left.artifact_type.localeCompare(right.artifact_type);
    }

    return left.name.localeCompare(right.name);
  });
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
  if (source === "same_folder") return "Gleicher Ordner";
  if (source === "manual") return "Manuell";
  if (source === "catalog") return "Katalog";
  return source || "-";
}

export function multimodalPairSourceTone(source: string): "ok" | "warn" | "error" | "info" {
  if (source === "manual" || source === "catalog") {
    return "ok";
  }
  if (source === "same_folder") {
    return "warn";
  }
  return "info";
}

export function multimodalConfidenceTone(confidence: number): "ok" | "warn" | "error" | "info" {
  if (confidence >= 0.9) {
    return "ok";
  }
  if (confidence >= 0.5) {
    return "warn";
  }
  return "error";
}

export function formatSupportArtifactTypeLabel(artifactType: string): string {
  if (artifactType === "mmproj") return "MMProj";
  if (artifactType === "lora") return "LoRA";
  if (artifactType === "adapter") return "Adapter";
  return artifactType;
}

export function supportArtifactTypeTone(artifactType: string): "ok" | "warn" | "error" | "info" {
  if (artifactType === "mmproj") {
    return "warn";
  }
  if (artifactType === "adapter" || artifactType === "lora") {
    return "info";
  }
  return "info";
}

export function multimodalPairHintTone(pair: MultimodalPair): "ok" | "warn" | "error" | "info" {
  if (pair.routing_allowed) {
    return "ok";
  }
  if (pair.status === "candidate") {
    return "warn";
  }
  if (pair.status === "ambiguous" || pair.status === "missing_base") {
    return "error";
  }
  return "info";
}

export function supportArtifactHintTone(statusLabel: string): "ok" | "warn" | "error" | "info" {
  return supportArtifactStatusTone(statusLabel);
}

export function formatSupportArtifactStatusLabel(statusLabel: string): string {
  if (statusLabel === "verified") return "Verifiziert";
  if (statusLabel === "candidate") return "Kandidat";
  if (statusLabel === "orphan") return "Verwaist";
  if (statusLabel === "missing_base") return "Basis fehlt";
  if (statusLabel === "ambiguous") return "Mehrdeutig";
  if (statusLabel === "support_artifact") return "Hilfsartefakt";
  return statusLabel.replaceAll("_", " ");
}

export function multimodalCandidateSummaryTone(pair: MultimodalPair): "ok" | "warn" | "error" | "info" {
  if (pair.routing_allowed) {
    return "ok";
  }
  if (pair.status === "candidate" && pair.candidate_base_model_ids.length > 1) {
    return "warn";
  }
  if (pair.status === "ambiguous" || pair.status === "missing_base") {
    return "error";
  }
  return "info";
}

export function describeMultimodalPairBaseModel(
  pair: MultimodalPair,
  baseModel: IndexedModel | undefined
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (baseModel) {
    return { label: baseModel.name, tone: "ok" };
  }
  if (pair.base_model_id) {
    return { label: pair.base_model_id, tone: "warn" };
  }
  return { label: "Kein Basismodell", tone: "error" };
}

export function describeMultimodalPairProjector(
  pair: MultimodalPair,
  projector: IndexedModel | undefined
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (projector) {
    return { label: projector.name, tone: "ok" };
  }
  if (pair.projector_artifact_id) {
    return { label: pair.projector_artifact_id, tone: "warn" };
  }
  return { label: "Kein Projektor", tone: "error" };
}

export function describeSupportArtifactFile(
  artifact: IndexedModel
): { label: string; location: string; tone: "ok" | "warn" | "error" | "info" } {
  if (artifact.path && artifact.path.length > 0) {
    return {
      label: artifact.name,
      location: parentDirectoryLabel(artifact.path),
      tone: "info"
    };
  }
  return {
    label: artifact.name,
    location: "-",
    tone: "info"
  };
}

export function describeMultimodalPairAction(
  pair: MultimodalPair,
  projector: IndexedModel | undefined,
  pairingCandidates: IndexedModel[]
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (pair.routing_allowed) {
    return { label: "Erledigt", tone: "ok" };
  }
  if (
    pair.status === "candidate" &&
    typeof pair.base_model_id === "string" &&
    pair.base_model_id.length > 0
  ) {
    return { label: "Probe", tone: "ok" };
  }
  if (projector?.artifact_type === "mmproj" && pairingCandidates.length > 0) {
    return { label: "Zuordnen", tone: "warn" };
  }
  if (pair.status === "ambiguous" || pair.status === "missing_base") {
    return { label: "Blockiert", tone: "error" };
  }
  return { label: "Hinweis", tone: "info" };
}

export function multimodalPairActionHint(
  pair: MultimodalPair,
  projector: IndexedModel | undefined,
  pairingCandidates: IndexedModel[]
): string {
  if (pair.routing_allowed) {
    return "Pair ist verifiziert und fuer Routing freigegeben.";
  }
  if (
    pair.status === "candidate" &&
    typeof pair.base_model_id === "string" &&
    pair.base_model_id.length > 0
  ) {
    return "Runtime-Probe kann direkt aus dieser Zeile gestartet werden.";
  }
  if (projector?.artifact_type === "mmproj" && pairingCandidates.length > 0) {
    return "Basismodell auswaehlen und Pairing hier aktualisieren.";
  }
  if (pair.status === "ambiguous" || pair.status === "missing_base") {
    return "Erst Zuordnung oder Basismodell-Lage klaeren, dann erneut pruefen.";
  }
  return "Nur Diagnoseeintrag ohne direkte Runtime-Freigabe.";
}

export function formatMultimodalPairControlSurface(
  canPairManually: boolean,
  canProbePair: boolean
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (canPairManually) {
    return { label: "Inline-Steuerung", tone: "ok" };
  }
  if (canProbePair) {
    return { label: "Probe bereit", tone: "info" };
  }
  return { label: "Nur Status", tone: "info" };
}

export function shouldRenderStandaloneMultimodalProbeButton(
  canPairManually: boolean,
  canProbePair: boolean
): boolean {
  return !canPairManually && canProbePair;
}

export function describeSupportArtifactAction(
  artifact: IndexedModel,
  pair: MultimodalPair | undefined,
  pairingCandidates: IndexedModel[]
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (canProbeSupportArtifactPair(artifact, pair)) {
    return { label: "Probe", tone: "ok" };
  }
  if (shouldManagePairInControlCenter(artifact, pair)) {
    return { label: "MM-Pairing", tone: "info" };
  }
  if (artifact.artifact_type === "mmproj" && pairingCandidates.length > 0) {
    return { label: "Zuordnen", tone: "warn" };
  }
  return { label: "Hinweis", tone: "info" };
}

export function supportArtifactActionHint(
  artifact: IndexedModel,
  pair: MultimodalPair | undefined,
  pairingCandidates: IndexedModel[]
): string {
  if (canProbeSupportArtifactPair(artifact, pair)) {
    return "Runtime-Probe kann direkt aus dieser Zeile gestartet werden.";
  }
  if (shouldManagePairInControlCenter(artifact, pair)) {
    return 'Im Bereich "Multimodale Paare" weiterfuehren.';
  }
  if (artifact.artifact_type === "mmproj" && pairingCandidates.length > 0) {
    return "Basismodell auswaehlen und Zuordnung hier speichern.";
  }
  return "Nur Referenz im Modellindex; keine direkte Runtime-Aktion.";
}

export function formatSupportArtifactControlSurface(
  manageInControlCenter: boolean,
  canPairManually: boolean
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (manageInControlCenter) {
    return { label: "MM-Bereich", tone: "info" };
  }
  if (canPairManually) {
    return { label: "Inline-Steuerung", tone: "ok" };
  }
  return { label: "Nur Anzeige", tone: "info" };
}

export function describeModelCapabilities(model: IndexedModel): string[] {
  const labels: string[] = [];
  if (model.capabilities.includes("chat")) labels.push("chat");
  if (model.capabilities.includes("code")) labels.push("code");
  if (model.capabilities.includes("vision")) labels.push("vision");
  if (model.capabilities.includes("reasoning")) labels.push("reasoning");
  return labels.length > 0 ? labels : ["-"];
}

export function formatCapabilityLabel(label: string): string {
  if (label === "chat") return "Chat";
  if (label === "code") return "Code";
  if (label === "vision") return "Vision";
  if (label === "reasoning") return "Reasoning";
  if (label === "-") return "-";
  return label;
}

export function capabilityTone(label: string): "ok" | "warn" | "error" | "info" {
  if (label === "code" || label === "reasoning") {
    return "ok";
  }
  if (label === "vision") {
    return "warn";
  }
  return "info";
}

export function formatModelRoleLabel(
  recommendedUse: IndexedModel["recommended_use"] | null | undefined
): string {
  if (recommendedUse === "primary_coding") return "Primary Coding";
  if (recommendedUse === "coding_candidate") return "Coding";
  if (recommendedUse === "chat_candidate") return "Chat";
  if (recommendedUse === "vision_candidate") return "Vision";
  if (recommendedUse === "orchestrator") return "Orchestrator";
  if (typeof recommendedUse === "string" && recommendedUse.length > 0) {
    return recommendedUse.replaceAll("_", " ");
  }
  return "-";
}

export function modelRoleTone(
  recommendedUse: IndexedModel["recommended_use"] | null | undefined
): "ok" | "warn" | "error" | "info" {
  if (recommendedUse === "primary_coding" || recommendedUse === "orchestrator") {
    return "ok";
  }
  if (recommendedUse === "vision_candidate") {
    return "warn";
  }
  return "info";
}

export function formatCompatibilityLabel(compatibility: string | null | undefined): string {
  if (compatibility === "llama_server_ready") return "llama-server bereit";
  if (compatibility === "ollama_ready") return "Ollama bereit";
  if (compatibility === "support_artifact") return "Hilfsartefakt";
  if (typeof compatibility === "string" && compatibility.length > 0) {
    return compatibility.replaceAll("_", " ");
  }
  return "-";
}

export function compatibilityTone(compatibility: string | null | undefined): "ok" | "warn" | "error" | "info" {
  if (compatibility === "llama_server_ready" || compatibility === "ollama_ready") {
    return "ok";
  }
  if (compatibility === "support_artifact") {
    return "warn";
  }
  return "info";
}

export function formatLauncherLabel(runtimeLauncher: string | null | undefined): string {
  if (runtimeLauncher === "llama_server") return "llama-server";
  if (runtimeLauncher === "ollama") return "Ollama";
  if (typeof runtimeLauncher === "string" && runtimeLauncher.length > 0) {
    return runtimeLauncher.replaceAll("_", " ");
  }
  return "-";
}

export function launcherTone(runtimeLauncher: string | null | undefined): "ok" | "warn" | "error" | "info" {
  if (runtimeLauncher === "llama_server" || runtimeLauncher === "ollama") {
    return "ok";
  }
  return "info";
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
          hint: "Bildinput bleibt gesperrt, bis ein verifiziertes Projektor-Pair vorliegt"
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
      label: "Vision-Chat",
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

export function modelRoutingTone(label: string): "ok" | "warn" | "error" | "info" {
  if (label === "Vision + Code" || label === "Text + Code") {
    return "ok";
  }
  if (label === "Vision direkt" || label === "Vision-Chat") {
    return "warn";
  }
  if (label === "MM-Pair fehlt") {
    return "error";
  }
  return "info";
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
    } else if (readiness.label === "Vision-Chat") {
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

export function summarizeStartableModelActions(
  models: IndexedModel[],
  status: RuntimeStatus | null,
  runtimeBusy: boolean
): Record<"running" | "loadable" | "blocked", number> {
  const summary = {
    running: 0,
    loadable: 0,
    blocked: 0
  };

  for (const model of models) {
    const actionState = modelRowActionState(model, status, runtimeBusy);
    if (actionState.isActive) {
      summary.running += 1;
    } else if (actionState.canStart) {
      summary.loadable += 1;
    } else {
      summary.blocked += 1;
    }
  }

  return summary;
}

function routingReadinessPriority(label: string): number {
  if (label === "Vision + Code") return 0;
  if (label === "Text + Code") return 1;
  if (label === "Vision direkt") return 2;
  if (label === "Vision-Chat") return 3;
  if (label === "Text") return 4;
  return 5;
}

export function sortStartableModels(
  models: IndexedModel[],
  multimodalPairs: MultimodalPair[],
  status: RuntimeStatus | null
): IndexedModel[] {
  return [...models].sort((left, right) => {
    const leftActive =
      status?.state === "running" &&
      (status.model_id === left.id || (status.model_name != null && status.model_name === left.name));
    const rightActive =
      status?.state === "running" &&
      (status.model_id === right.id || (status.model_name != null && status.model_name === right.name));
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }

    const leftRouting = describeModelRoutingReadiness(left, multimodalPairs);
    const rightRouting = describeModelRoutingReadiness(right, multimodalPairs);
    const routingDelta = routingReadinessPriority(leftRouting.label) - routingReadinessPriority(rightRouting.label);
    if (routingDelta !== 0) {
      return routingDelta;
    }

    const leftRole = left.recommended_use ?? "";
    const rightRole = right.recommended_use ?? "";
    if (leftRole !== rightRole) {
      return leftRole.localeCompare(rightRole);
    }

    return left.name.localeCompare(right.name);
  });
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

export function multimodalPairStatusTone(
  status: MultimodalPair["status"],
  routingAllowed: boolean
): "ok" | "warn" | "error" | "info" {
  if (routingAllowed) {
    return "ok";
  }
  if (status === "candidate") {
    return "warn";
  }
  if (status === "ambiguous" || status === "missing_base") {
    return "error";
  }
  return "info";
}

export function supportArtifactStatusTone(statusLabel: string): "ok" | "warn" | "error" | "info" {
  if (statusLabel === "verified") {
    return "ok";
  }
  if (statusLabel === "candidate") {
    return "warn";
  }
  if (statusLabel === "orphan" || statusLabel === "missing_base" || statusLabel === "ambiguous") {
    return "error";
  }
  return "info";
}

export function describeMultimodalPairRouting(
  pair: MultimodalPair
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (pair.routing_allowed) {
    return { label: "Freigegeben", tone: "ok" };
  }
  if (pair.status === "candidate" && typeof pair.base_model_id === "string" && pair.base_model_id.length > 0) {
    return { label: "Probe ausstehend", tone: "warn" };
  }
  if (pair.status === "ambiguous" || pair.status === "missing_base") {
    return { label: "Blockiert", tone: "error" };
  }
  return { label: "Gesperrt", tone: "info" };
}
