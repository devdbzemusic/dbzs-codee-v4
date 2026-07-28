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
  canStopRuntime,
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
import { HintBox, StatusDotBadge, SummaryBadge, ToneBadge } from "./RuntimeModelsTab.primitives";

export function RuntimeModelsHeader({
  backendOnline,
  status,
  runtimeBusy,
  indexLoading,
  index,
  visibleSupportArtifactCount,
  multimodalPairCount,
  runtimeError,
  indexError,
  loadModelIndex,
  stopModel
}: {
  backendOnline: boolean;
  status: RuntimeStatus | null;
  runtimeBusy: boolean;
  indexLoading: boolean;
  index:
    | {
        summary: {
          total: number;
          gguf_total: number;
          llama_server_ready: number;
          ollama_ready: number;
        };
      }
    | null
    | undefined;
  visibleSupportArtifactCount: number;
  multimodalPairCount: number;
  runtimeError: string | null;
  indexError: string | null;
  loadModelIndex: () => Promise<void>;
  stopModel: () => Promise<void>;
}) {
  const isRunning = status?.state === "running";

  return (
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SummaryBadge tone="info">Gesamt {index.summary.total}</SummaryBadge>
          <SummaryBadge tone="info">GGUF {index.summary.gguf_total}</SummaryBadge>
          <SummaryBadge tone="ok">llama-server {index.summary.llama_server_ready}</SummaryBadge>
          <SummaryBadge tone="ok">Ollama {index.summary.ollama_ready}</SummaryBadge>
          <SummaryBadge tone="info">Hilfsartefakte {visibleSupportArtifactCount}</SummaryBadge>
          <SummaryBadge tone="info">MM-Paare {multimodalPairCount}</SummaryBadge>
        </div>
      ) : null}
      {indexError ? <p className="mt-2 text-xs text-dbzs-red">Modellindex: {indexError}</p> : null}
      {runtimeError ? <p className="mt-2 text-xs text-dbzs-red">{runtimeError}</p> : null}
      {status?.message && status.state !== "running" ? (
        <p className="mt-2 text-xs text-dbzs-muted">{status.message}</p>
      ) : null}
    </div>
  );
}

export function RuntimeModelsEmptyState({
  indexLoading,
  indexError,
  hasAnyEntries
}: {
  indexLoading: boolean;
  indexError: string | null;
  hasAnyEntries: boolean;
}) {
  if (indexLoading || !hasAnyEntries) {
    return (
      <p className="text-xs text-dbzs-muted">
        {indexLoading ? "Indexiere lokale Modelle ..." : "Noch kein Modellindex geladen."}
      </p>
    );
  }

  return (
    <p className="text-xs text-dbzs-muted">
      {indexError
        ? "Modellindex konnte nicht geladen werden - siehe Fehlermeldung oben."
        : "Keine Modelle im Index gefunden."}
    </p>
  );
}

function StartableModelRow({
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

function MultimodalPairRow({
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

function SupportArtifactRow({
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

export function StartableModelsSection({
  sortedStartableModels,
  modelRoleSummary,
  startableModelActionSummary,
  modelRoutingSummary,
  multimodalPairs,
  status,
  runtimeBusy,
  startModel,
  stopModel
}: {
  sortedStartableModels: IndexedModel[];
  modelRoleSummary: Record<"coding" | "chat" | "vision" | "orchestrator" | "other", number>;
  startableModelActionSummary: Record<"running" | "loadable" | "blocked", number>;
  modelRoutingSummary: Record<
    "text" | "textCode" | "visionDirect" | "visionChat" | "visionBlocked" | "screenshotReady",
    number
  >;
  multimodalPairs: MultimodalPair[];
  status: RuntimeStatus | null;
  runtimeBusy: boolean;
  startModel: (modelId: string) => Promise<void>;
  stopModel: () => Promise<void>;
}) {
  if (sortedStartableModels.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">Startbare Modelle</h3>
        <SummaryBadge tone="info">Coding-Modelle {modelRoleSummary.coding}</SummaryBadge>
        <SummaryBadge tone="info">Chat-Modelle {modelRoleSummary.chat}</SummaryBadge>
        <SummaryBadge tone="warn">Vision-Modelle {modelRoleSummary.vision}</SummaryBadge>
        <SummaryBadge tone="ok">Orchestrator {modelRoleSummary.orchestrator}</SummaryBadge>
        {modelRoleSummary.other > 0 ? <SummaryBadge tone="info">Sonstige {modelRoleSummary.other}</SummaryBadge> : null}
        {startableModelActionSummary.running > 0 ? (
          <SummaryBadge tone="ok">Laufend {startableModelActionSummary.running}</SummaryBadge>
        ) : null}
        <SummaryBadge tone="ok">Ladbar {startableModelActionSummary.loadable}</SummaryBadge>
        {startableModelActionSummary.blocked > 0 ? (
          <SummaryBadge tone="error">Blockiert {startableModelActionSummary.blocked}</SummaryBadge>
        ) : null}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SummaryBadge tone="info">Text {modelRoutingSummary.text}</SummaryBadge>
        <SummaryBadge tone="info">Text + Code {modelRoutingSummary.textCode}</SummaryBadge>
        <SummaryBadge tone="warn">Vision direkt {modelRoutingSummary.visionDirect}</SummaryBadge>
        <SummaryBadge tone="info">Vision-Chat {modelRoutingSummary.visionChat}</SummaryBadge>
        <SummaryBadge tone="error">MM-Pair blockiert {modelRoutingSummary.visionBlocked}</SummaryBadge>
        <SummaryBadge tone="ok">Screenshot-bereit {modelRoutingSummary.screenshotReady}</SummaryBadge>
      </div>
      <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-[#091017]">
          <tr className="border-b border-dbzs-border text-dbzs-muted">
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Modell</th>
            <th className="px-2 py-2 font-medium">Rolle</th>
            <th className="px-2 py-2 font-medium">Faehigkeiten</th>
            <th className="px-2 py-2 font-medium">Runtime</th>
            <th className="px-2 py-2 font-medium">Kompat</th>
            <th className="px-2 py-2 font-medium">Routing</th>
            <th className="px-2 py-2 font-medium">Groesse</th>
            <th className="px-2 py-2 text-right font-medium">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {sortedStartableModels.map((model) => (
            <StartableModelRow
              key={model.id}
              model={model}
              multimodalPairs={multimodalPairs}
              runtimeBusy={runtimeBusy}
              startModel={startModel}
              status={status}
              stopModel={stopModel}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MultimodalPairsSection({
  sortedMultimodalPairs,
  multimodalPairSummary,
  multimodalPairSourceSummary,
  multimodalPairActionSummary,
  modelsById,
  supportArtifactsById,
  pairingCandidates,
  pairingUi
}: {
  sortedMultimodalPairs: MultimodalPair[];
  multimodalPairSummary: Record<string, number>;
  multimodalPairSourceSummary: Record<"manual" | "catalog" | "sameFolder" | "other", number>;
  multimodalPairActionSummary: Record<"probeReady" | "needsAssignment" | "resolved" | "blocked", number>;
  modelsById: Map<string, IndexedModel>;
  supportArtifactsById: Map<string, IndexedModel>;
  pairingCandidates: IndexedModel[];
  pairingUi: PairingUiController;
}) {
  if (sortedMultimodalPairs.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">Multimodale Paare</h3>
        <SummaryBadge tone="info">Gesamt {multimodalPairSummary.total}</SummaryBadge>
        <SummaryBadge tone="ok">Verifiziert {multimodalPairSummary.verified}</SummaryBadge>
        <SummaryBadge tone="info">Offen {multimodalPairSummary.candidate}</SummaryBadge>
        <SummaryBadge tone="info">Manuell {multimodalPairSourceSummary.manual}</SummaryBadge>
        <SummaryBadge tone="info">Katalog {multimodalPairSourceSummary.catalog}</SummaryBadge>
        <SummaryBadge tone="info">Gleicher Ordner {multimodalPairSourceSummary.sameFolder}</SummaryBadge>
        {multimodalPairSourceSummary.other > 0 ? (
          <SummaryBadge tone="info">Sonstige {multimodalPairSourceSummary.other}</SummaryBadge>
        ) : null}
        <SummaryBadge tone="ok">Probe bereit {multimodalPairActionSummary.probeReady}</SummaryBadge>
        <SummaryBadge tone="warn">Zuordnung noetig {multimodalPairActionSummary.needsAssignment}</SummaryBadge>
        <SummaryBadge tone="info">Erledigt {multimodalPairActionSummary.resolved}</SummaryBadge>
        {multimodalPairActionSummary.blocked > 0 ? (
          <SummaryBadge tone="error">Blockiert {multimodalPairActionSummary.blocked}</SummaryBadge>
        ) : null}
        <SummaryBadge tone="warn">Mehrdeutig {multimodalPairSummary.ambiguous}</SummaryBadge>
        <SummaryBadge tone="error">Basis fehlt {multimodalPairSummary.missing_base}</SummaryBadge>
      </div>
      <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-[#091017]">
          <tr className="border-b border-dbzs-border text-dbzs-muted">
            <th className="px-2 py-2 font-medium">Basismodell</th>
            <th className="px-2 py-2 font-medium">Projektor</th>
            <th className="px-2 py-2 font-medium">Modalitaet</th>
            <th className="px-2 py-2 font-medium">Quelle</th>
            <th className="px-2 py-2 font-medium">Sicherheit</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Routing</th>
            <th className="px-2 py-2 font-medium">Hinweis</th>
            <th className="px-2 py-2 text-right font-medium">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {sortedMultimodalPairs.map((pair) => (
            <MultimodalPairRow
              key={pair.id}
              modelsById={modelsById}
              pair={pair}
              pairingCandidates={pairingCandidates}
              pairingUi={pairingUi}
              supportArtifactsById={supportArtifactsById}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SupportArtifactsSection({
  sortedVisibleSupportArtifacts,
  supportArtifactSummary,
  supportArtifactActionSummary,
  supportArtifactStatusSummary,
  multimodalPairs,
  modelsById,
  pairingCandidates,
  pairingUi
}: {
  sortedVisibleSupportArtifacts: IndexedModel[];
  supportArtifactSummary: Record<"mmproj" | "adapter" | "other", number>;
  supportArtifactActionSummary: Record<"probeReady" | "manualAssignment" | "readOnly", number>;
  supportArtifactStatusSummary: Record<"verified" | "candidate" | "orphan" | "other", number>;
  multimodalPairs: MultimodalPair[];
  modelsById: Map<string, IndexedModel>;
  pairingCandidates: IndexedModel[];
  pairingUi: PairingUiController;
}) {
  if (sortedVisibleSupportArtifacts.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">Hilfsartefakte</h3>
        <SummaryBadge tone="info">MMProj {supportArtifactSummary.mmproj}</SummaryBadge>
        <SummaryBadge tone="info">Adapter/LoRA {supportArtifactSummary.adapter}</SummaryBadge>
        {supportArtifactSummary.other > 0 ? <SummaryBadge tone="info">Sonstige {supportArtifactSummary.other}</SummaryBadge> : null}
        <SummaryBadge tone="ok">Probe bereit {supportArtifactActionSummary.probeReady}</SummaryBadge>
        <SummaryBadge tone="warn">Manuelle Zuordnung {supportArtifactActionSummary.manualAssignment}</SummaryBadge>
        {supportArtifactStatusSummary.verified > 0 ? (
          <SummaryBadge tone="ok">Verifiziert {supportArtifactStatusSummary.verified}</SummaryBadge>
        ) : null}
        {supportArtifactStatusSummary.candidate > 0 ? (
          <SummaryBadge tone="warn">Kandidat {supportArtifactStatusSummary.candidate}</SummaryBadge>
        ) : null}
        {supportArtifactStatusSummary.orphan > 0 ? (
          <SummaryBadge tone="error">Verwaist {supportArtifactStatusSummary.orphan}</SummaryBadge>
        ) : null}
        {supportArtifactActionSummary.readOnly > 0 ? (
          <SummaryBadge tone="info">Nur Hinweis {supportArtifactActionSummary.readOnly}</SummaryBadge>
        ) : null}
        {supportArtifactStatusSummary.other > 0 ? (
          <SummaryBadge tone="info">Sonstige Status {supportArtifactStatusSummary.other}</SummaryBadge>
        ) : null}
      </div>
      <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-[#091017]">
          <tr className="border-b border-dbzs-border text-dbzs-muted">
            <th className="px-2 py-2 font-medium">Datei</th>
            <th className="px-2 py-2 font-medium">Typ</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Hinweis</th>
            <th className="px-2 py-2 font-medium">Zuordnung</th>
          </tr>
        </thead>
        <tbody>
          {sortedVisibleSupportArtifacts.map((artifact) => (
            <SupportArtifactRow
              key={artifact.id}
              artifact={artifact}
              modelsById={modelsById}
              multimodalPairs={multimodalPairs}
              pairingCandidates={pairingCandidates}
              pairingUi={pairingUi}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
