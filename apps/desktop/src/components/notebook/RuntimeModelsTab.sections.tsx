import { useMemo, useState, type ReactNode } from "react";
import type { IndexedModel, MultimodalPair, RuntimeSlotStatus, RuntimeStatus } from "@dbzs/shared";
import type { SlotHealthState } from "@/services/runtimeProcessSupervisor";
import type { PairingUiController } from "./RuntimeModelsTab.pairing";
import { canStopRuntime, summarizeDiagnosticsIssues, type DiagnosticsIssue } from "./RuntimeModelsTab.helpers";
import { StartableModelRow, MultimodalPairRow, SupportArtifactRow } from "./RuntimeModelsTab.rows";
import { SummaryBadge, ToneBadge } from "./RuntimeModelsTab.primitives";

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function runtimeTone(state: RuntimeSlotStatus["state"] | RuntimeStatus["state"] | null | undefined) {
  if (state === "running") return "ok" as const;
  if (state === "error") return "error" as const;
  if (state === "starting") return "warn" as const;
  return "info" as const;
}

function OpsSection({
  title,
  source,
  summary,
  defaultOpen = true,
  children
}: {
  title: string;
  source: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded border border-dbzs-border bg-dbzs-panel/60">
      <button
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-dbzs-muted">{title}</h3>
            <ToneBadge fit tone="info" uppercase={false}>
              Quelle: {source}
            </ToneBadge>
          </div>
          {summary ? <div className="mt-2 flex flex-wrap items-center gap-2">{summary}</div> : null}
        </div>
        <span className="shrink-0 text-xs text-dbzs-muted">{open ? "Einklappen" : "Aufklappen"}</span>
      </button>
      {open ? <div className="border-t border-dbzs-border/70 px-4 py-3">{children}</div> : null}
    </section>
  );
}

function RuntimeOperationCards({
  slotStatuses,
  slotHealthStates
}: {
  slotStatuses: RuntimeSlotStatus[];
  slotHealthStates: SlotHealthState[];
}) {
  const statusBySlot = new Map(slotStatuses.map((slot) => [slot.slot_id, slot] as const));
  const runningCount = slotStatuses.filter((slot) => slot.state === "running").length;
  const readyCount = slotStatuses.filter((slot) => slot.chat_ready).length;
  const blockedCount = slotStatuses.filter((slot) => slot.state === "error").length;
  const budgetCount = slotHealthStates.filter((slot) => slot.budgetExhausted).length;

  return (
    <div className="grid gap-3 xl:grid-cols-4">
      <div className="rounded border border-dbzs-border bg-dbzs-bg/70 p-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dbzs-muted">Slot Overview</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <SummaryBadge tone="ok">Bereit {readyCount}</SummaryBadge>
          <SummaryBadge tone="info">Laufend {runningCount}</SummaryBadge>
          {blockedCount > 0 ? <SummaryBadge tone="error">Stoerung {blockedCount}</SummaryBadge> : null}
        </div>
      </div>
      <div className="rounded border border-dbzs-border bg-dbzs-bg/70 p-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dbzs-muted">Resource Budgets</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <SummaryBadge tone="info">VRAM bekannt {slotStatuses.filter((slot) => slot.vram_total_bytes).length}</SummaryBadge>
          <SummaryBadge tone="info">GPU-Layer bekannt {slotStatuses.filter((slot) => slot.gpu_layers !== null).length}</SummaryBadge>
        </div>
      </div>
      <div className="rounded border border-dbzs-border bg-dbzs-bg/70 p-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dbzs-muted">Process Health</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <SummaryBadge tone="ok">PID bekannt {slotStatuses.filter((slot) => slot.pid).length}</SummaryBadge>
          <SummaryBadge tone="warn">
            Requests aktiv {slotStatuses.filter((slot) => (slot.active_requests ?? 0) > 0).length}
          </SummaryBadge>
        </div>
      </div>
      <div className="rounded border border-dbzs-border bg-dbzs-bg/70 p-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dbzs-muted">Restart Budget</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <SummaryBadge tone={budgetCount > 0 ? "error" : "ok"}>Erschoepft {budgetCount}</SummaryBadge>
          <SummaryBadge tone="info">
            Versuche {slotHealthStates.reduce((sum, slot) => sum + slot.restartAttempts, 0)}
          </SummaryBadge>
        </div>
      </div>
      <OpsSection
        defaultOpen
        source="Runtime Slot API + runtimeProcessSupervisor"
        summary={
          <>
            <SummaryBadge tone="info">Slots {slotStatuses.length}</SummaryBadge>
            <SummaryBadge tone="ok">Bereit {readyCount}</SummaryBadge>
            {blockedCount > 0 ? <SummaryBadge tone="error">Blockiert {blockedCount}</SummaryBadge> : null}
          </>
        }
        title="Runtime Operations"
      >
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[11px]">
            <thead className="bg-dbzs-bg">
              <tr className="border-b border-dbzs-border text-dbzs-muted">
                <th className="px-2 py-2 font-medium">Slot</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Running Model</th>
                <th className="px-2 py-2 font-medium">Readiness</th>
                <th className="px-2 py-2 font-medium">Resource Budget</th>
                <th className="px-2 py-2 font-medium">Process Health</th>
                <th className="px-2 py-2 font-medium">Restart Budget</th>
                <th className="px-2 py-2 font-medium">Blockergrund</th>
              </tr>
            </thead>
            <tbody>
              {slotHealthStates.map((health) => {
                const slot = statusBySlot.get(health.slotId);
                const state = slot?.state ?? "stopped";
                const blockedReason =
                  slot?.error_message || slot?.message || (health.budgetExhausted ? "Restart-Budget erschoepft." : "-");
                return (
                  <tr className="border-b border-dbzs-border/50" key={health.slotId}>
                    <td className="px-2 py-2 font-medium text-dbzs-text">{health.slotId}</td>
                    <td className="px-2 py-2">
                      <ToneBadge fit tone={runtimeTone(state)}>
                        {state}
                      </ToneBadge>
                    </td>
                    <td className="px-2 py-2 text-dbzs-text">{slot?.model_name ?? slot?.model_id ?? "-"}</td>
                    <td className="px-2 py-2 text-dbzs-muted">
                      {slot?.chat_ready ? "chat_ready" : "nicht bereit"}
                      {slot?.residency_state ? ` · ${slot.residency_state}` : ""}
                    </td>
                    <td className="px-2 py-2 text-dbzs-muted">
                      GPU {slot?.gpu_layers ?? "-"} · ctx {slot?.context_size ?? "-"} · {formatBytes(slot?.vram_used_bytes)}
                      /{formatBytes(slot?.vram_total_bytes)}
                    </td>
                    <td className="px-2 py-2 text-dbzs-muted">
                      PID {slot?.pid ?? "-"} · req {slot?.active_requests ?? 0}
                    </td>
                    <td className="px-2 py-2 text-dbzs-muted">
                      {health.restartAttempts}/3
                      {health.lastRestartAt ? ` · zuletzt ${formatDateTime(new Date(health.lastRestartAt).toISOString())}` : ""}
                    </td>
                    <td className="px-2 py-2 text-dbzs-muted">{blockedReason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </OpsSection>
    </div>
  );
}

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
      {status?.message && status.state !== "running" ? <p className="mt-2 text-xs text-dbzs-muted">{status.message}</p> : null}
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
      {indexError ? "Modellindex konnte nicht geladen werden - siehe Fehlermeldung oben." : "Keine Modelle im Index gefunden."}
    </p>
  );
}

export function DiagnosticsSection({ issues }: { issues: DiagnosticsIssue[] }) {
  if (issues.length === 0) {
    return null;
  }

  const { errors, warnings } = summarizeDiagnosticsIssues(issues);

  return (
    <OpsSection
      defaultOpen
      source="Modellindex + Pairing-Status"
      summary={
        <>
          {errors > 0 ? <SummaryBadge tone="error">Blockiert {errors}</SummaryBadge> : null}
          {warnings > 0 ? <SummaryBadge tone="warn">Hinweise {warnings}</SummaryBadge> : null}
        </>
      }
      title="Diagnose"
    >
      <ul className="space-y-1">
        {issues.map((issue) => (
          <li className="flex items-start gap-2 border border-dbzs-border/50 bg-dbzs-bg/60 px-2 py-1.5 text-[11px]" key={issue.id}>
            <ToneBadge fit tone={issue.severity === "error" ? "error" : "warn"}>
              {issue.area}
            </ToneBadge>
            <div className="min-w-0">
              <div className="truncate font-medium text-dbzs-text" title={issue.title}>
                {issue.title}
              </div>
              <div className="text-dbzs-muted">{issue.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </OpsSection>
  );
}

export function RuntimeOperationsSection({
  slotStatuses,
  slotHealthStates
}: {
  slotStatuses: RuntimeSlotStatus[];
  slotHealthStates: SlotHealthState[];
}) {
  if (slotHealthStates.length === 0 && slotStatuses.length === 0) {
    return null;
  }
  return <RuntimeOperationCards slotHealthStates={slotHealthStates} slotStatuses={slotStatuses} />;
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
  modelRoutingSummary: Record<"text" | "textCode" | "visionDirect" | "visionChat" | "visionBlocked" | "screenshotReady", number>;
  multimodalPairs: MultimodalPair[];
  status: RuntimeStatus | null;
  runtimeBusy: boolean;
  startModel: (modelId: string, profile?: string) => Promise<void>;
  stopModel: () => Promise<void>;
  autoTuneModel: (modelId: string) => Promise<void>;
  tuningInProgress: Record<string, boolean>;
  tuningFeedback: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "loadable" | "blocked" | "running" | "vision">("all");
  const [sortBy, setSortBy] = useState<"default" | "name" | "size">("default");

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const next = sortedStartableModels.filter((model) => {
      if (normalizedQuery && !`${model.name} ${model.id} ${model.recommended_use}`.toLowerCase().includes(normalizedQuery)) {
        return false;
      }
      const modelState = status?.state === "running" && (status.model_id === model.id || status.model_name === model.name) ? "running" : null;
      if (filter === "running") return modelState === "running";
      if (filter === "vision") return model.capabilities.includes("vision");
      if (filter === "loadable") return model.compatibility === "llama_server_ready";
      if (filter === "blocked") return model.compatibility !== "llama_server_ready";
      return true;
    });
    if (sortBy === "name") {
      next.sort((left, right) => left.name.localeCompare(right.name));
    } else if (sortBy === "size") {
      next.sort((left, right) => right.size_bytes - left.size_bytes);
    }
    return next;
  }, [filter, query, sortBy, sortedStartableModels, status]);

  if (sortedStartableModels.length === 0) {
    return null;
  }

  return (
    <OpsSection
      defaultOpen
      source="ModelIndex + RuntimeStatus"
      summary={
        <>
          <SummaryBadge tone="info">Coding-Modelle {modelRoleSummary.coding}</SummaryBadge>
          <SummaryBadge tone="info">Chat-Modelle {modelRoleSummary.chat}</SummaryBadge>
          <SummaryBadge tone="warn">Vision-Modelle {modelRoleSummary.vision}</SummaryBadge>
          <SummaryBadge tone="ok">Ladbar {startableModelActionSummary.loadable}</SummaryBadge>
          {startableModelActionSummary.blocked > 0 ? <SummaryBadge tone="error">Blockiert {startableModelActionSummary.blocked}</SummaryBadge> : null}
          <SummaryBadge tone="info">Text {modelRoutingSummary.text}</SummaryBadge>
          <SummaryBadge tone="ok">Screenshot-bereit {modelRoutingSummary.screenshotReady}</SummaryBadge>
        </>
      }
      title="Startable Models"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="min-w-[220px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nach Modell, ID oder Rolle filtern"
          type="text"
          value={query}
        />
        <select className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setFilter(event.target.value as typeof filter)} value={filter}>
          <option value="all">Alle</option>
          <option value="loadable">Ladbar</option>
          <option value="blocked">Blockiert</option>
          <option value="running">Laufend</option>
          <option value="vision">Vision</option>
        </select>
        <select className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setSortBy(event.target.value as typeof sortBy)} value={sortBy}>
          <option value="default">Standardsortierung</option>
          <option value="name">Name</option>
          <option value="size">Groesse</option>
        </select>
        <ToneBadge fit tone="info" uppercase={false}>
          Sichtbar: {filteredModels.length}
        </ToneBadge>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
          <thead className="bg-dbzs-bg">
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
            {filteredModels.map((model) => (
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
    </OpsSection>
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
    <OpsSection
      defaultOpen={false}
      source="ModelIndex.multimodal_pairs"
      summary={
        <>
          <SummaryBadge tone="info">Gesamt {multimodalPairSummary.total}</SummaryBadge>
          <SummaryBadge tone="ok">Verifiziert {multimodalPairSummary.verified}</SummaryBadge>
          <SummaryBadge tone="warn">Zuordnung noetig {multimodalPairActionSummary.needsAssignment}</SummaryBadge>
          {multimodalPairSummary.missing_base > 0 ? <SummaryBadge tone="error">Basis fehlt {multimodalPairSummary.missing_base}</SummaryBadge> : null}
        </>
      }
      title="Fleet Routing / Multimodal Pairs"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <SummaryBadge tone="info">Manuell {multimodalPairSourceSummary.manual}</SummaryBadge>
        <SummaryBadge tone="info">Katalog {multimodalPairSourceSummary.catalog}</SummaryBadge>
        <SummaryBadge tone="info">Gleicher Ordner {multimodalPairSourceSummary.sameFolder}</SummaryBadge>
        <SummaryBadge tone="ok">Probe bereit {multimodalPairActionSummary.probeReady}</SummaryBadge>
        <SummaryBadge tone="info">Erledigt {multimodalPairActionSummary.resolved}</SummaryBadge>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
          <thead className="bg-dbzs-bg">
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
    </OpsSection>
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
    <OpsSection
      defaultOpen={false}
      source="ModelIndex.support_artifacts"
      summary={
        <>
          <SummaryBadge tone="info">MMProj {supportArtifactSummary.mmproj}</SummaryBadge>
          <SummaryBadge tone="info">Adapter/LoRA {supportArtifactSummary.adapter}</SummaryBadge>
          {supportArtifactStatusSummary.verified > 0 ? <SummaryBadge tone="ok">Verifiziert {supportArtifactStatusSummary.verified}</SummaryBadge> : null}
          {supportArtifactStatusSummary.orphan > 0 ? <SummaryBadge tone="error">Verwaist {supportArtifactStatusSummary.orphan}</SummaryBadge> : null}
        </>
      }
      title="Support Artifacts"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <SummaryBadge tone="ok">Probe bereit {supportArtifactActionSummary.probeReady}</SummaryBadge>
        <SummaryBadge tone="warn">Manuelle Zuordnung {supportArtifactActionSummary.manualAssignment}</SummaryBadge>
        {supportArtifactActionSummary.readOnly > 0 ? <SummaryBadge tone="info">Nur Hinweis {supportArtifactActionSummary.readOnly}</SummaryBadge> : null}
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
          <thead className="bg-dbzs-bg">
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
    </OpsSection>
  );
}
