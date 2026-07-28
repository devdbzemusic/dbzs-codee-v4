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

function statusBadgeClasses(tone: "ok" | "warn" | "error" | "info"): string {
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

function hintToneClasses(tone: "ok" | "warn" | "error" | "info"): string {
  if (tone === "ok") {
    return "border-dbzs-cyan/20 bg-dbzs-cyan/5 text-dbzs-cyan";
  }
  if (tone === "warn") {
    return "border-amber-400/20 bg-amber-400/5 text-amber-200";
  }
  if (tone === "error") {
    return "border-red-400/20 bg-red-400/5 text-red-200";
  }
  return "border-dbzs-border/70 bg-dbzs-bg text-dbzs-muted";
}

function parentDirectoryLabel(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return normalized || "-";
  }
  return segments[segments.length - 2] || normalized;
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
      label: "Verified",
      hint: "Routing freigegeben"
    };
  }
  if (pair.status === "candidate") {
    return {
      label: "Candidate",
      hint: "Runtime-Probe noch offen"
    };
  }
  if (pair.status === "ambiguous") {
    return {
      label: "Ambiguous",
      hint: "Mehrdeutige Basismodell-Zuordnung"
    };
  }
  if (pair.status === "missing_base") {
    return {
      label: "Missing Base",
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
  if (source === "same_folder") return "Same Folder";
  if (source === "manual") return "Manual";
  if (source === "catalog") return "Catalog";
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
  if (statusLabel === "verified") return "Verified";
  if (statusLabel === "candidate") return "Candidate";
  if (statusLabel === "orphan") return "Orphan";
  if (statusLabel === "missing_base") return "Missing Base";
  if (statusLabel === "ambiguous") return "Ambiguous";
  if (statusLabel === "support_artifact") return "Support Artifact";
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
  return { label: "Kein Projector", tone: "error" };
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
  if (compatibility === "llama_server_ready") return "llama-server ready";
  if (compatibility === "ollama_ready") return "Ollama ready";
  if (compatibility === "support_artifact") return "Support artifact";
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

export function modelRoutingTone(label: string): "ok" | "warn" | "error" | "info" {
  if (label === "Vision + Code" || label === "Text + Code") {
    return "ok";
  }
  if (label === "Vision direkt" || label === "Vision Chat") {
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
  if (label === "Vision Chat") return 3;
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

export function multimodalPairStatusTone(status: MultimodalPair["status"], routingAllowed: boolean): "ok" | "warn" | "error" | "info" {
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
                  {startableModelActionSummary.running > 0 ? (
                    <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                      Laufend {startableModelActionSummary.running}
                    </span>
                  ) : null}
                  <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                    Ladbar {startableModelActionSummary.loadable}
                  </span>
                  {startableModelActionSummary.blocked > 0 ? (
                    <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-300">
                      Blockiert {startableModelActionSummary.blocked}
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
                    {sortedStartableModels.map((model) => {
                      const { canStart, canStop, isActive } = modelRowActionState(model, status, runtimeBusy);
                      const rowStatus = describeModelRowStatus(model, status, runtimeBusy);
                      const capabilityLabels = describeModelCapabilities(model);
                      const routingReadiness = describeModelRoutingReadiness(model, multimodalPairs);
                      return (
                        <tr
                          className={`border-b border-dbzs-border/50 ${isActive ? "bg-dbzs-cyan/5" : ""}`}
                          key={model.id}
                        >
                          <td className="px-2 py-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(rowStatus.tone)}`}
                            >
                              {isActive ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
                              {rowStatus.label}
                            </span>
                          </td>
                          <td className="max-w-[220px] truncate px-2 py-2 font-medium text-dbzs-text" title={model.name}>
                            {model.name}
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(modelRoleTone(model.recommended_use))}`}
                            >
                              {formatModelRoleLabel(model.recommended_use)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="flex flex-wrap gap-1">
                              {capabilityLabels.map((label) => (
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[9px] ${statusBadgeClasses(capabilityTone(label))}`}
                                  key={`${model.id}:cap:${label}`}
                                >
                                  {formatCapabilityLabel(label)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(launcherTone(model.runtime_launcher))}`}
                            >
                              {formatLauncherLabel(model.runtime_launcher)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(compatibilityTone(model.compatibility))}`}
                            >
                              {formatCompatibilityLabel(model.compatibility)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="flex max-w-[220px] flex-col gap-0.5">
                              <span
                                className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(modelRoutingTone(routingReadiness.label))}`}
                              >
                                {routingReadiness.label}
                              </span>
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
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Manual {multimodalPairSourceSummary.manual}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Catalog {multimodalPairSourceSummary.catalog}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Same Folder {multimodalPairSourceSummary.sameFolder}
                  </span>
                  {multimodalPairSourceSummary.other > 0 ? (
                    <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                      Sonstige {multimodalPairSourceSummary.other}
                    </span>
                  ) : null}
                  <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                    Probe bereit {multimodalPairActionSummary.probeReady}
                  </span>
                  <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                    Zuordnung noetig {multimodalPairActionSummary.needsAssignment}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Erledigt {multimodalPairActionSummary.resolved}
                  </span>
                  {multimodalPairActionSummary.blocked > 0 ? (
                    <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-300">
                      Blockiert {multimodalPairActionSummary.blocked}
                    </span>
                  ) : null}
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
                      const baseModelDescriptor = describeMultimodalPairBaseModel(pair, baseModel);
                      const projectorDescriptor = describeMultimodalPairProjector(pair, projector);
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
                      const pairActionDescriptor = describeMultimodalPairAction(pair, projector, pairingCandidates);
                      const pairActionHint = multimodalPairActionHint(pair, projector, pairingCandidates);
                      const feedbackKey = pair.projector_artifact_id;
                      return (
                        <tr className="border-b border-dbzs-border/50" key={pair.id}>
                          <td className="px-2 py-2 text-dbzs-text">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] ${statusBadgeClasses(baseModelDescriptor.tone)}`}
                              title={baseModelDescriptor.label}
                            >
                              {baseModelDescriptor.label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-text">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] ${statusBadgeClasses(projectorDescriptor.tone)}`}
                              title={projectorDescriptor.label}
                            >
                              {projectorDescriptor.label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span className="inline-flex rounded border border-dbzs-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]">
                              {formatMultimodalPairModalities(pair)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(multimodalPairSourceTone(pair.source))}`}
                            >
                              {formatMultimodalPairSource(pair.source)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(multimodalConfidenceTone(pair.confidence))}`}
                            >
                              {formatMultimodalPairConfidence(pair.confidence)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(multimodalPairStatusTone(pair.status, pair.routing_allowed))}`}
                            >
                              {pairStatus.label}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(pair.routing_allowed ? "ok" : "error")}`}
                            >
                              {pair.routing_allowed ? "freigegeben" : "gesperrt"}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="flex flex-col gap-0.5">
                              <span
                                className={`rounded border px-1.5 py-1 text-[10px] ${hintToneClasses(multimodalPairHintTone(pair))}`}
                              >
                                {pairStatus.hint}
                              </span>
                              {candidateSummary ? (
                                <span
                                  className={`rounded border px-1.5 py-1 text-[10px] ${hintToneClasses(multimodalCandidateSummaryTone(pair))}`}
                                >
                                  {candidateSummary}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-col items-end gap-1">
                              <div>
                                <span
                                  className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(pairActionDescriptor.tone)}`}
                                >
                                  {pairActionDescriptor.label}
                                </span>
                              </div>
                              <div className="max-w-[320px]">
                                <span
                                  className={`rounded border px-1.5 py-1 text-[10px] ${hintToneClasses(pairActionDescriptor.tone)}`}
                                >
                                  {pairActionHint}
                                </span>
                              </div>
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

            {sortedVisibleSupportArtifacts.length > 0 ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">
                    Hilfsartefakte
                  </h3>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    MMProj {supportArtifactSummary.mmproj}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Adapter/LoRA {supportArtifactSummary.adapter}
                  </span>
                  {supportArtifactSummary.other > 0 ? (
                    <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                      Sonstige {supportArtifactSummary.other}
                    </span>
                  ) : null}
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Probe bereit {supportArtifactActionSummary.probeReady}
                  </span>
                  <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                    Manuelle Zuordnung {supportArtifactActionSummary.manualAssignment}
                  </span>
                  {supportArtifactStatusSummary.verified > 0 ? (
                    <span className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-0.5 text-[10px] text-dbzs-cyan">
                      Verifiziert {supportArtifactStatusSummary.verified}
                    </span>
                  ) : null}
                  {supportArtifactStatusSummary.candidate > 0 ? (
                    <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                      Candidate {supportArtifactStatusSummary.candidate}
                    </span>
                  ) : null}
                  {supportArtifactStatusSummary.orphan > 0 ? (
                    <span className="border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-300">
                      Orphan {supportArtifactStatusSummary.orphan}
                    </span>
                  ) : null}
                  {supportArtifactActionSummary.readOnly > 0 ? (
                    <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                      Nur Hinweis {supportArtifactActionSummary.readOnly}
                    </span>
                  ) : null}
                  {supportArtifactStatusSummary.other > 0 ? (
                    <span className="border border-dbzs-border px-2 py-0.5 text-[10px] text-dbzs-muted">
                      Sonstige Status {supportArtifactStatusSummary.other}
                    </span>
                  ) : null}
                </div>
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
                    {sortedVisibleSupportArtifacts.map((artifact) => {
                      const description = describeSupportArtifact(artifact, multimodalPairs);
                      const fileDescriptor = describeSupportArtifactFile(artifact);
                      const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
                      const selectedBaseModelId =
                        pairingSelections[artifact.id] ?? pair?.base_model_id ?? pair?.candidate_base_model_ids[0] ?? "";
                      const canPairManually = artifact.artifact_type === "mmproj" && pairingCandidates.length > 0;
                      const manageInControlCenter = shouldManagePairInControlCenter(artifact, pair);
                      const canProbePair = canProbeSupportArtifactPair(artifact, pair);
                      const actionDescriptor = describeSupportArtifactAction(artifact, pair, pairingCandidates);
                      const actionHint = supportArtifactActionHint(artifact, pair, pairingCandidates);
                      return (
                        <tr className="border-b border-dbzs-border/50" key={artifact.id}>
                          <td className="max-w-[280px] px-2 py-2 text-dbzs-text" title={artifact.path}>
                            <div className="flex flex-col gap-0.5">
                              <span className="truncate font-medium">{fileDescriptor.label}</span>
                              <span
                                className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(fileDescriptor.tone)}`}
                              >
                                Ordner {fileDescriptor.location}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(supportArtifactTypeTone(artifact.artifact_type))}`}
                            >
                              {formatSupportArtifactTypeLabel(artifact.artifact_type)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(supportArtifactStatusTone(description.statusLabel))}`}
                            >
                              {formatSupportArtifactStatusLabel(description.statusLabel)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <span
                              className={`rounded border px-1.5 py-1 text-[10px] ${hintToneClasses(supportArtifactHintTone(description.statusLabel))}`}
                            >
                              {description.hint}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-dbzs-muted">
                            <div className="mb-1">
                              <span
                                className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${statusBadgeClasses(actionDescriptor.tone)}`}
                              >
                                {actionDescriptor.label}
                              </span>
                            </div>
                            <div className="mb-1">
                              <span
                                className={`rounded border px-1.5 py-1 text-[10px] ${hintToneClasses(actionDescriptor.tone)}`}
                              >
                                {actionHint}
                              </span>
                            </div>
                            {manageInControlCenter ? (
                              <span className="text-[10px] text-dbzs-muted">Im Bereich "Multimodale Paare" verwalten</span>
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
