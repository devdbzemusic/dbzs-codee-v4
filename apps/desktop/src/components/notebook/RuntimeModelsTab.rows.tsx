/*
 * DBZS - Division By Zeros
 * Datei: RuntimeModelsTab.rows.tsx
 * Bereich: Desktop / Runtime Models
 *
 * Zweck:
 *   Rendert die tabellarischen Zeilen fuer startbare Modelle, multimodale
 *   Paare und sichtbare Hilfsartefakte.
 *
 * Warum:
 *   Die Runtime-Models-Oberflaeche soll in kleinere, wartbare UI-Bausteine
 *   zerlegt werden, ohne die bestehende Routing- und Pairing-Logik zu veraendern.
 *
 * Wozu:
 *   Entkoppelt die Zeilenkomponenten von den Sektions-Containern, damit
 *   Rendering, Tests und weitere UI-Splits einfacher bleiben.
 *
 * Input:
 *   Modellindex-Artefakte, Pairing-/Probe-Controller und Runtime-Statusdaten.
 *
 * Output:
 *   Tabellenzeilen fuer die Runtime-Models-Ansichten mit zugehoerigen Aktionen.
 *
 * Eltern:
 *   RuntimeModelsTab.sections.tsx
 *
 * Kinder:
 *   RuntimeModelsTab.helpers.ts
 *   RuntimeModelsTab.pairing.tsx
 *   RuntimeModelsTab.primitives.tsx
 *
 * Hinweise:
 *   Diese Datei bleibt render-orientiert. Ableitungen und Entscheidungslogik
 *   kommen weiterhin aus den Helpern bzw. dem Controller.
 */

import { formatModelSizeBadge, type IndexedModel, type MultimodalPair, type RuntimeStatus } from "@dbzs/shared";
import { isRunnableModel } from "@/utils/modelUtils";
import {
  defaultPairingSelection,
  describeBaseModelSelection,
  describePairingTargetBadge,
  PairingFeedbackDetails,
  PairingProbeButton,
  PairingSelectionControls,
  type PairingUiController
} from "./RuntimeModelsTab.pairing";
import {
  canProbeSupportArtifactPair,
  capabilityTone,
  compatibilityTone,
  describeModelCapabilities,
  describeModelRowStatus,
  describeModelRoutingReadiness,
  describeMultimodalPairAction,
  describeMultimodalPairBaseModel,
  describeMultimodalPairCandidates,
  describeMultimodalPairProjector,
  describeMultimodalPairRouting,
  describeMultimodalPairStatus,
  describeSupportArtifact,
  describeSupportArtifactAction,
  describeSupportArtifactFile,
  formatCapabilityLabel,
  formatCompatibilityLabel,
  formatLauncherLabel,
  formatModelRoleLabel,
  formatMultimodalPairConfidence,
  formatMultimodalPairControlSurface,
  formatMultimodalPairModalities,
  formatMultimodalPairSource,
  formatSupportArtifactControlSurface,
  formatSupportArtifactStatusLabel,
  formatSupportArtifactTypeLabel,
  launcherTone,
  modelRoleTone,
  modelRoutingTone,
  modelRowActionState,
  multimodalCandidateSummaryTone,
  multimodalConfidenceTone,
  multimodalPairActionHint,
  multimodalPairHintTone,
  multimodalPairSourceTone,
  multimodalPairStatusTone,
  shouldManagePairInControlCenter,
  shouldRenderStandaloneMultimodalProbeButton,
  supportArtifactActionHint,
  supportArtifactHintTone,
  supportArtifactStatusTone,
  supportArtifactTypeTone
} from "./RuntimeModelsTab.helpers";
import { HintBox, StatusDotBadge, ToneBadge } from "./RuntimeModelsTab.primitives";

export function StartableModelRow({
  model,
  multimodalPairs,
  status,
  runtimeBusy,
  startModel,
  stopModel
}: {
  model: IndexedModel;
  multimodalPairs: MultimodalPair[];
  status: RuntimeStatus | null;
  runtimeBusy: boolean;
  startModel: (modelId: string) => Promise<void>;
  stopModel: () => Promise<void>;
}) {
  const { canStart, canStop, isActive } = modelRowActionState(model, status, runtimeBusy);
  const rowStatus = describeModelRowStatus(model, status, runtimeBusy);
  const capabilityLabels = describeModelCapabilities(model);
  const routingReadiness = describeModelRoutingReadiness(model, multimodalPairs);

  return (
    <tr className={`border-b border-dbzs-border/50 ${isActive ? "bg-dbzs-cyan/5" : ""}`}>
      <td className="px-2 py-2">
        <StatusDotBadge active={isActive} label={rowStatus.label} tone={rowStatus.tone} />
      </td>
      <td className="max-w-[220px] truncate px-2 py-2 font-medium text-dbzs-text" title={model.name}>
        {model.name}
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={modelRoleTone(model.recommended_use)}>{formatModelRoleLabel(model.recommended_use)}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <div className="flex flex-wrap gap-1">
          {capabilityLabels.map((label) => (
            <ToneBadge key={`${model.id}:cap:${label}`} tone={capabilityTone(label)} uppercase={false}>
              {formatCapabilityLabel(label)}
            </ToneBadge>
          ))}
        </div>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={launcherTone(model.runtime_launcher)}>{formatLauncherLabel(model.runtime_launcher)}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={compatibilityTone(model.compatibility)}>{formatCompatibilityLabel(model.compatibility)}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <div className="flex max-w-[220px] flex-col gap-0.5">
          <ToneBadge fit tone={modelRoutingTone(routingReadiness.label)}>
            {routingReadiness.label}
          </ToneBadge>
          <span className="text-[10px] text-dbzs-muted/80">{routingReadiness.hint}</span>
        </div>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">{model.size_bytes > 0 ? formatModelSizeBadge(model.size_bytes) : "-"}</td>
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
}

export function MultimodalPairRow({
  pair,
  modelsById,
  supportArtifactsById,
  pairingCandidates,
  pairingUi
}: {
  pair: MultimodalPair;
  modelsById: Map<string, IndexedModel>;
  supportArtifactsById: Map<string, IndexedModel>;
  pairingCandidates: IndexedModel[];
  pairingUi: PairingUiController;
}) {
  const baseModel = pair.base_model_id ? modelsById.get(pair.base_model_id) : undefined;
  const projector = supportArtifactsById.get(pair.projector_artifact_id);
  const baseModelDescriptor = describeMultimodalPairBaseModel(pair, baseModel);
  const projectorDescriptor = describeMultimodalPairProjector(pair, projector);
  const pairStatus = describeMultimodalPairStatus(pair);
  const routingDescriptor = describeMultimodalPairRouting(pair);
  const candidateSummary = describeMultimodalPairCandidates(pair, modelsById);
  const selectedBaseModelId = defaultPairingSelection(pair.projector_artifact_id, pair, pairingUi.pairingSelections);
  const selectedBaseModel = describeBaseModelSelection(selectedBaseModelId, modelsById);
  const targetBadge = describePairingTargetBadge(selectedBaseModelId, selectedBaseModel);
  const canPairManually = projector?.artifact_type === "mmproj" && pairingCandidates.length > 0;
  const canProbePair =
    pair.status === "candidate" &&
    pair.routing_allowed !== true &&
    typeof pair.base_model_id === "string" &&
    pair.base_model_id.length > 0;
  const pairActionDescriptor = describeMultimodalPairAction(pair, projector, pairingCandidates);
  const pairActionHint = multimodalPairActionHint(pair, projector, pairingCandidates);
  const controlSurface = formatMultimodalPairControlSurface(canPairManually, canProbePair);
  const showStandaloneProbeButton = shouldRenderStandaloneMultimodalProbeButton(canPairManually, canProbePair);
  const feedbackKey = pair.projector_artifact_id;

  return (
    <tr className="border-b border-dbzs-border/50">
      <td className="px-2 py-2 text-dbzs-text">
        <ToneBadge title={baseModelDescriptor.label} tone={baseModelDescriptor.tone} uppercase={false}>
          {baseModelDescriptor.label}
        </ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-text">
        <ToneBadge title={projectorDescriptor.label} tone={projectorDescriptor.tone} uppercase={false}>
          {projectorDescriptor.label}
        </ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone="info">{formatMultimodalPairModalities(pair)}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={multimodalPairSourceTone(pair.source)}>{formatMultimodalPairSource(pair.source)}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={multimodalConfidenceTone(pair.confidence)}>{formatMultimodalPairConfidence(pair.confidence)}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={multimodalPairStatusTone(pair.status, pair.routing_allowed)}>{pairStatus.label}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={routingDescriptor.tone}>{routingDescriptor.label}</ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <div className="flex flex-col gap-0.5">
          <HintBox tone={multimodalPairHintTone(pair)}>{pairStatus.hint}</HintBox>
          {candidateSummary ? <HintBox tone={multimodalCandidateSummaryTone(pair)}>{candidateSummary}</HintBox> : null}
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col items-end gap-1">
          <div>
            <ToneBadge tone={pairActionDescriptor.tone}>{pairActionDescriptor.label}</ToneBadge>
          </div>
          <div className="max-w-[320px]">
            <HintBox tone={pairActionDescriptor.tone}>{pairActionHint}</HintBox>
          </div>
          <div>
            <ToneBadge tone={controlSurface.tone}>{controlSurface.label}</ToneBadge>
          </div>
          {canPairManually ? (
            <PairingSelectionControls
              align="right"
              canProbePair={canProbePair}
              feedbackKey={feedbackKey}
              pairingCandidates={pairingCandidates}
              pairingUi={pairingUi}
              probeBaseModelId={pair.base_model_id ?? undefined}
              saveSource={pair.source ?? undefined}
              selectedBaseModelId={selectedBaseModelId}
              targetBadge={targetBadge}
            />
          ) : showStandaloneProbeButton ? (
            <PairingProbeButton
              canProbePair={canProbePair}
              feedbackKey={feedbackKey}
              pairingUi={pairingUi}
              probeBaseModelId={pair.base_model_id ?? undefined}
            />
          ) : null}
          {!canPairManually ? <PairingFeedbackDetails align="right" feedbackKey={feedbackKey} pairingUi={pairingUi} /> : null}
        </div>
      </td>
    </tr>
  );
}

export function SupportArtifactRow({
  artifact,
  multimodalPairs,
  modelsById,
  pairingCandidates,
  pairingUi
}: {
  artifact: IndexedModel;
  multimodalPairs: MultimodalPair[];
  modelsById: Map<string, IndexedModel>;
  pairingCandidates: IndexedModel[];
  pairingUi: PairingUiController;
}) {
  const description = describeSupportArtifact(artifact, multimodalPairs);
  const fileDescriptor = describeSupportArtifactFile(artifact);
  const pair = multimodalPairs.find((entry) => entry.projector_artifact_id === artifact.id);
  const selectedBaseModelId =
    pairingUi.pairingSelections[artifact.id] ?? pair?.base_model_id ?? pair?.candidate_base_model_ids[0] ?? "";
  const selectedBaseModel = describeBaseModelSelection(selectedBaseModelId, modelsById);
  const targetBadge = describePairingTargetBadge(selectedBaseModelId, selectedBaseModel);
  const canPairManually = artifact.artifact_type === "mmproj" && pairingCandidates.length > 0;
  const manageInControlCenter = shouldManagePairInControlCenter(artifact, pair);
  const canProbePair = canProbeSupportArtifactPair(artifact, pair);
  const actionDescriptor = describeSupportArtifactAction(artifact, pair, pairingCandidates);
  const actionHint = supportArtifactActionHint(artifact, pair, pairingCandidates);
  const controlSurface = formatSupportArtifactControlSurface(manageInControlCenter, canPairManually);

  return (
    <tr className="border-b border-dbzs-border/50">
      <td className="max-w-[280px] px-2 py-2 text-dbzs-text" title={artifact.path}>
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{fileDescriptor.label}</span>
          <ToneBadge fit tone={fileDescriptor.tone}>Ordner {fileDescriptor.location}</ToneBadge>
        </div>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={supportArtifactTypeTone(artifact.artifact_type)}>
          {formatSupportArtifactTypeLabel(artifact.artifact_type)}
        </ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <ToneBadge tone={supportArtifactStatusTone(description.statusLabel)}>
          {formatSupportArtifactStatusLabel(description.statusLabel)}
        </ToneBadge>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <HintBox tone={supportArtifactHintTone(description.statusLabel)}>{description.hint}</HintBox>
      </td>
      <td className="px-2 py-2 text-dbzs-muted">
        <div className="mb-1">
          <ToneBadge tone={actionDescriptor.tone}>{actionDescriptor.label}</ToneBadge>
        </div>
        <div className="mb-1">
          <HintBox tone={actionDescriptor.tone}>{actionHint}</HintBox>
        </div>
        {manageInControlCenter ? (
          <div className="flex flex-col gap-1">
            <ToneBadge fit tone={controlSurface.tone}>{controlSurface.label}</ToneBadge>
            {selectedBaseModelId ? <ToneBadge fit tone={targetBadge.tone}>{targetBadge.label}</ToneBadge> : null}
          </div>
        ) : canPairManually ? (
          <div className="flex min-w-[280px] flex-col gap-1">
            <ToneBadge fit tone={controlSurface.tone}>{controlSurface.label}</ToneBadge>
            <PairingSelectionControls
              canProbePair={canProbePair}
              feedbackKey={artifact.id}
              pairingCandidates={pairingCandidates}
              pairingUi={pairingUi}
              probeBaseModelId={pair?.base_model_id ?? undefined}
              saveSource={pair?.source ?? undefined}
              selectedBaseModelId={selectedBaseModelId}
              targetBadge={targetBadge}
            />
          </div>
        ) : (
          <span className="text-[10px] text-dbzs-muted">-</span>
        )}
      </td>
    </tr>
  );
}
