import type { IndexedModel, MultimodalPair, RuntimeStatus } from "@dbzs/shared";
import type { PairingUiController } from "./RuntimeModelsTab.pairing";
import { canStopRuntime } from "./RuntimeModelsTab.helpers";
import { StartableModelRow, MultimodalPairRow, SupportArtifactRow } from "./RuntimeModelsTab.rows";
import { SummaryBadge } from "./RuntimeModelsTab.primitives";

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

export function StartableModelsSection({
  sortedStartableModels,
  modelRoleSummary,
  startableModelActionSummary,
  modelRoutingSummary,
  multimodalPairs,
  status,
  runtimeBusy,
  startModel,
  stopModel,
  autoTuneModel,
  tuningInProgress,
  tuningFeedback
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
  autoTuneModel: (modelId: string) => Promise<void>;
  tuningInProgress: Record<string, boolean>;
  tuningFeedback: Record<string, string>;
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
              autoTuneModel={autoTuneModel}
              key={model.id}
              model={model}
              multimodalPairs={multimodalPairs}
              runtimeBusy={runtimeBusy}
              startModel={startModel}
              status={status}
              stopModel={stopModel}
              tuningFeedback={tuningFeedback[model.id]}
              tuningInProgress={tuningInProgress[model.id] === true}
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
