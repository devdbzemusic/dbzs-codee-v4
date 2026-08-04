import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  ModelLabCollection,
  ModelLabCollectionCreate,
  ModelLabHuggingFaceSearchResult,
  ModelLabModel,
  ModelLabReadinessEntry,
  ModelLabRoleAssignment,
  ModelLabRoleAssignmentRequest,
  ModelLabRoutingEntry,
  ModelLabScanJob,
  ModelLabSource,
  ModelLabSourceCandidate
} from "@dbzs/shared";
import { formatBytes, ModelLabStatusBadge } from "./ModelLabTab.primitives";
import { ModelBundleRow, RoleAssignmentRow, SourceRow } from "./ModelLabTab.rows";
import { SummaryBadge, ToneBadge } from "./RuntimeModelsTab.primitives";

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
      <button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen((current) => !current)} type="button">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-dbzs-muted">{title}</h3>
            <ToneBadge fit tone="info" uppercase={false}>
              Quelle: {source}
            </ToneBadge>
          </div>
          {summary ? <div className="mt-2 flex flex-wrap gap-2">{summary}</div> : null}
        </div>
        <span className="shrink-0 text-xs text-dbzs-muted">{open ? "Einklappen" : "Aufklappen"}</span>
      </button>
      {open ? <div className="border-t border-dbzs-border/70 px-4 py-3">{children}</div> : null}
    </section>
  );
}

export function ModelLabHeader({
  backendOnline,
  sourceCount,
  modelCount,
  isLoading,
  isScanning,
  error,
  onRefresh,
  onScanAll
}: {
  backendOnline: boolean;
  sourceCount: number;
  modelCount: number;
  isLoading: boolean;
  isScanning: boolean;
  error: string | null;
  onRefresh: () => void;
  onScanAll: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-dbzs-border bg-dbzs-panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-dbzs-text">Model Lab</h2>
          <p className="mt-0.5 text-[11px] text-dbzs-muted">
            Backend: {backendOnline ? "aktiv" : "offline"} - {sourceCount} Quelle(n), {modelCount} Modell(e)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={isLoading} onClick={onRefresh} type="button">
            Aktualisieren
          </button>
          <button className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1 text-xs font-medium text-dbzs-cyan disabled:opacity-40" disabled={isScanning || sourceCount === 0} onClick={onScanAll} type="button">
            {isScanning ? "Scannt..." : "Alle Quellen scannen"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-dbzs-red">{error}</p> : null}
    </div>
  );
}

export function ModelLabSourcesSection({
  sources,
  jobs,
  newSourcePath,
  onNewSourcePathChange,
  onAddSource,
  onAddSuggestedSource,
  addingSource,
  onScanSource,
  isScanning,
  sourceCandidates
}: {
  sources: ModelLabSource[];
  jobs: ModelLabScanJob[];
  newSourcePath: string;
  onNewSourcePathChange: (value: string) => void;
  onAddSource: () => void;
  onAddSuggestedSource: (path: string) => void;
  addingSource: boolean;
  onScanSource: (sourceId: string) => void;
  isScanning: boolean;
  sourceCandidates: ModelLabSourceCandidate[];
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newSourcePath.trim()) {
      onAddSource();
    }
  };

  const latestJobs = jobs.slice().sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 6);

  return (
    <OpsSection
      defaultOpen
      source="Model Lab Sources + Scan Jobs"
      summary={
        <>
          <SummaryBadge tone="info">Sources {sources.length}</SummaryBadge>
          <SummaryBadge tone="warn">Jobs aktiv {jobs.filter((job) => job.status === "running" || job.status === "queued").length}</SummaryBadge>
          <SummaryBadge tone="ok">Abgeschlossen {jobs.filter((job) => job.status === "completed").length}</SummaryBadge>
          {jobs.some((job) => job.status === "failed") ? <SummaryBadge tone="error">Fehlgeschlagen {jobs.filter((job) => job.status === "failed").length}</SummaryBadge> : null}
        </>
      }
      title="Sources & Scan Jobs"
    >
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <input className="min-w-[280px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => onNewSourcePathChange(event.target.value)} placeholder="Ordnerpfad, z. B. C:\Modelle" type="text" value={newSourcePath} />
        <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={addingSource || !newSourcePath.trim()} type="submit">
          {addingSource ? "Fuegt hinzu..." : "Quelle hinzufuegen"}
        </button>
      </form>
      {sourceCandidates.length > 0 ? (
        <div className="mb-4 grid gap-2 md:grid-cols-2">
          {sourceCandidates.map((candidate) => (
            <button className="border border-dbzs-border bg-dbzs-bg px-3 py-2 text-left text-xs text-dbzs-text disabled:cursor-not-allowed disabled:opacity-50" disabled={!candidate.exists || candidate.already_registered || addingSource} key={candidate.path} onClick={() => onAddSuggestedSource(candidate.path)} title={candidate.reason} type="button">
              <span className="block font-medium">{candidate.recommended ? "* " : ""}{candidate.label}</span>
              <span className="mt-1 block truncate text-[11px] text-dbzs-muted">{candidate.path}</span>
              <span className="mt-1 block text-[11px] text-dbzs-muted">{candidate.already_registered ? "Registriert" : candidate.exists ? "Bereit" : "Nicht gefunden"}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-auto">
          {sources.length === 0 ? (
            <p className="text-xs text-dbzs-muted">Noch keine Modellquelle konfiguriert.</p>
          ) : (
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead className="bg-dbzs-bg">
                <tr className="border-b border-dbzs-border text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Pfad</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Letzter Scan</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <SourceRow isScanning={isScanning} key={source.id} onScan={() => onScanSource(source.id)} source={source} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded border border-dbzs-border/70 bg-dbzs-bg/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-[10px] uppercase tracking-[0.12em] text-dbzs-muted">Scan Jobs</h4>
            <ToneBadge fit tone="info" uppercase={false}>
              Progress aus Job-Daten
            </ToneBadge>
          </div>
          {latestJobs.length === 0 ? (
            <p className="text-xs text-dbzs-muted">Noch keine Scan-Jobs vorhanden.</p>
          ) : (
            <div className="space-y-2">
              {latestJobs.map((job) => (
                <div className="rounded border border-dbzs-border/60 bg-dbzs-panel/40 p-2" key={job.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ToneBadge fit tone={job.status === "failed" ? "error" : job.status === "completed" ? "ok" : "warn"}>
                      {job.status}
                    </ToneBadge>
                    <span className="text-[10px] text-dbzs-muted">{formatDateTime(job.created_at)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-dbzs-text">{job.progress_message ?? "Kein Fortschrittstext."}</div>
                  <div className="mt-1 text-[10px] text-dbzs-muted">
                    Dateien {job.total_files} · Artefakte {job.artifact_count} · Bundles {job.bundle_count}
                  </div>
                  {job.error ? <div className="mt-1 text-[10px] text-dbzs-red">{job.error}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </OpsSection>
  );
}

export function ModelLabModelsSection({
  models,
  selectedBundleId,
  onSelect,
  onAssignAndEnable,
  certifyModel,
  certifyingModel
}: {
  models: ModelLabModel[];
  selectedBundleId: string | null;
  onSelect: (bundleId: string) => void;
  onAssignAndEnable: (bundleId: string) => void;
  certifyModel?: (request: { bundle_id: string; certification: import("@dbzs/shared").ModelFleetCertificationKind; status: "passed" }) => void;
  certifyingModel?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "size" | "status">("name");
  const [capabilityFilter, setCapabilityFilter] = useState("all");

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const next = models.filter((entry) => {
      if (normalizedQuery && !`${entry.bundle.name} ${entry.bundle.capabilities.join(" ")} ${entry.bundle.status}`.toLowerCase().includes(normalizedQuery)) {
        return false;
      }
      if (capabilityFilter !== "all" && !entry.bundle.capabilities.includes(capabilityFilter)) {
        return false;
      }
      return true;
    });
    next.sort((left, right) => {
      if (sortBy === "status") return left.bundle.status.localeCompare(right.bundle.status);
      if (sortBy === "size") {
        const leftSize = left.artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);
        const rightSize = right.artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);
        return rightSize - leftSize;
      }
      return left.bundle.name.localeCompare(right.bundle.name);
    });
    return next;
  }, [capabilityFilter, models, query, sortBy]);

  const allCapabilities = useMemo(
    () => Array.from(new Set(models.flatMap((entry) => entry.bundle.capabilities))).sort((left, right) => left.localeCompare(right)),
    [models]
  );
  const certifiedCount = models.filter((entry) => entry.bundle.evidence.length > 0).length;

  return (
    <OpsSection
      defaultOpen
      source="Model Lab Bundles"
      summary={
        <>
          <SummaryBadge tone="info">Inventory {models.length}</SummaryBadge>
          <SummaryBadge tone="ok">Mit Evidence {certifiedCount}</SummaryBadge>
          <SummaryBadge tone="warn">Vision {models.filter((entry) => entry.bundle.capabilities.includes("vision")).length}</SummaryBadge>
        </>
      }
      title="Inventory, Capabilities & Certification"
    >
      {models.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Keine Modelle gefunden - Quelle hinzufuegen und Scan ausfuehren.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className="min-w-[220px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setQuery(event.target.value)} placeholder="Nach Name, Status oder Capability filtern" type="text" value={query} />
            <select className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setCapabilityFilter(event.target.value)} value={capabilityFilter}>
              <option value="all">Alle Capabilities</option>
              {allCapabilities.map((capability) => (
                <option key={capability} value={capability}>
                  {capability}
                </option>
              ))}
            </select>
            <select className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setSortBy(event.target.value as typeof sortBy)} value={sortBy}>
              <option value="name">Name</option>
              <option value="size">Groesse</option>
              <option value="status">Status</option>
            </select>
            <ToneBadge fit tone="info" uppercase={false}>
              Sichtbar: {filteredModels.length}
            </ToneBadge>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-dbzs-bg">
                <tr className="border-b border-dbzs-border text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Quantisierung</th>
                  <th className="px-2 py-1">Groesse</th>
                  <th className="px-2 py-1">Capabilities</th>
                  <th className="px-2 py-1">Artefakte</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((entry) => (
                  <ModelBundleRow certifyModel={certifyModel} certifyingModel={certifyingModel} entry={entry} isSelected={entry.bundle.bundle_id === selectedBundleId} key={entry.bundle.bundle_id} onAssignAndEnable={onAssignAndEnable} onSelect={() => onSelect(entry.bundle.bundle_id)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </OpsSection>
  );
}

export function ModelLabInspectorPanel({
  model,
  collections = [],
  onAddToCollection,
  onRemoveFromCollection
}: {
  model: ModelLabModel | null;
  collections?: ModelLabCollection[];
  onAddToCollection?: (collectionId: string) => void;
  onRemoveFromCollection?: (collectionId: string) => void;
}) {
  if (!model) {
    return <div className="rounded border border-dbzs-border bg-dbzs-panel p-3 text-xs text-dbzs-muted">Modell auswaehlen, um Details zu sehen.</div>;
  }

  const { bundle, artifacts } = model;
  const memberCollections = collections.filter((collection) => bundle.collection_ids.includes(collection.id));
  const availableCollections = collections.filter((collection) => !bundle.collection_ids.includes(collection.id));

  return (
    <div className="rounded border border-dbzs-border bg-dbzs-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-dbzs-text">Inspector · {bundle.name}</h4>
        <ModelLabStatusBadge status={bundle.status} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-dbzs-muted">
        <dt>Typ</dt>
        <dd>{bundle.health.model_type}</dd>
        <dt>Architektur</dt>
        <dd>{bundle.health.architecture ?? "-"}</dd>
        <dt>Kontextlaenge</dt>
        <dd>{bundle.health.context_length ?? "-"}</dd>
        <dt>Ordnergroesse</dt>
        <dd>{formatBytes(bundle.health.folder_size_bytes)}</dd>
        <dt>Capabilities</dt>
        <dd>{bundle.capabilities.join(", ") || "-"}</dd>
        <dt>Modalitaeten</dt>
        <dd>{bundle.modalities.join(", ") || "-"}</dd>
      </dl>
      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">Collections</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {memberCollections.length === 0 ? (
            <span className="text-[11px] text-dbzs-muted">keiner Collection zugeordnet</span>
          ) : (
            memberCollections.map((collection) => (
              <button className="border px-1.5 py-0.5 text-[10px]" key={collection.id} onClick={() => onRemoveFromCollection?.(collection.id)} style={{ borderColor: collection.color, color: collection.color }} title="Entfernen" type="button">
                {collection.name} x
              </button>
            ))
          )}
        </div>
        {onAddToCollection && availableCollections.length > 0 ? (
          <select className="mt-2 border border-dbzs-border bg-dbzs-bg px-1.5 py-1 text-[11px] text-dbzs-text" onChange={(event) => {
            if (event.target.value) {
              onAddToCollection(event.target.value);
              event.target.value = "";
            }
          }} value="">
            <option value="">Zu Collection hinzufuegen...</option>
            {availableCollections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {bundle.health.issues.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">Probleme</p>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-dbzs-red">
            {bundle.health.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">Artefakte ({artifacts.length})</p>
        <ul className="mt-1 space-y-1 text-[11px] text-dbzs-muted">
          {artifacts.map((artifact) => (
            <li className="flex items-center justify-between gap-2" key={artifact.artifact_id}>
              <span className="truncate">{artifact.file_name}</span>
              <span className="shrink-0 text-dbzs-muted">{formatBytes(artifact.size_bytes)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ModelLabCollectionsSection({
  collections,
  models,
  creatingCollection,
  onCreateCollection
}: {
  collections: ModelLabCollection[];
  models: ModelLabModel[];
  creatingCollection: boolean;
  onCreateCollection: (request: ModelLabCollectionCreate) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#22D3EE");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim()) {
      onCreateCollection({ name: name.trim(), color });
      setName("");
    }
  };

  const countByCollection = (collectionId: string) => models.filter((entry) => entry.bundle.collection_ids.includes(collectionId)).length;

  return (
    <OpsSection
      defaultOpen={false}
      source="Model Lab Collections"
      summary={
        <>
          <SummaryBadge tone="info">Collections {collections.length}</SummaryBadge>
          <SummaryBadge tone="info">Zugeordnete Modelle {collections.reduce((sum, collection) => sum + countByCollection(collection.id), 0)}</SummaryBadge>
        </>
      }
      title="Collections"
    >
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <input className="min-w-[200px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => setName(event.target.value)} placeholder="Neue Collection, z. B. Coding-Modelle" type="text" value={name} />
        <input aria-label="Farbe" className="h-7 w-10 border border-dbzs-border bg-dbzs-bg" onChange={(event) => setColor(event.target.value)} type="color" value={color} />
        <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={creatingCollection || !name.trim()} type="submit">
          {creatingCollection ? "Legt an..." : "Anlegen"}
        </button>
      </form>
      {collections.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Collection angelegt.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {collections.map((collection) => (
            <span className="flex items-center gap-1 border px-2 py-1 text-[11px]" key={collection.id} style={{ borderColor: collection.color, color: collection.color }}>
              {collection.name}
              <span className="text-dbzs-muted">({countByCollection(collection.id)})</span>
            </span>
          ))}
        </div>
      )}
    </OpsSection>
  );
}

export function ModelLabReadinessSection({ readinessMap }: { readinessMap: ModelLabReadinessEntry[] }) {
  const blocked = readinessMap.filter((entry) => entry.blockers.length > 0).length;

  return (
    <OpsSection
      defaultOpen={false}
      source="Model Readiness Map"
      summary={
        <>
          <SummaryBadge tone="info">Eintraege {readinessMap.length}</SummaryBadge>
          {blocked > 0 ? <SummaryBadge tone="error">Mit Blockern {blocked}</SummaryBadge> : <SummaryBadge tone="ok">Keine Blocker</SummaryBadge>}
        </>
      }
      title="Readiness"
    >
      {readinessMap.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Readiness-Daten vorhanden.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-dbzs-bg">
              <tr className="border-b border-dbzs-border text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">
                <th className="px-2 py-1">Modell</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Probe</th>
                <th className="px-2 py-1">Benchmark</th>
                <th className="px-2 py-1">Evidence</th>
                <th className="px-2 py-1">Routing</th>
                <th className="px-2 py-1">Blocker</th>
              </tr>
            </thead>
            <tbody>
              {readinessMap.map((entry) => (
                <tr className="border-b border-dbzs-border/60" key={entry.bundle_id}>
                  <td className="px-2 py-1.5 text-xs font-medium text-dbzs-text">{entry.bundle_name}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.status}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.latest_probe_status ?? "-"}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.latest_benchmark_status ?? "-"}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.evidence_count} / {entry.certification_count} Zert.</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.routing_allowed_roles.length}/{entry.assigned_roles.length}</td>
                  <td className="px-2 py-1.5 text-[11px]">
                    <span className={entry.blockers.length === 0 ? "text-dbzs-green" : "text-dbzs-red"}>
                      {entry.blockers.length === 0 ? "OK" : entry.blockers.join(", ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OpsSection>
  );
}

export function ModelLabRoutingSection({ routingMap }: { routingMap: ModelLabRoutingEntry[] }) {
  return (
    <OpsSection
      defaultOpen={false}
      source="Routing Map"
      summary={
        <>
          <SummaryBadge tone="info">Roles {routingMap.length}</SummaryBadge>
          <SummaryBadge tone="ok">Freigegeben {routingMap.filter((entry) => entry.routing_allowed).length}</SummaryBadge>
          {routingMap.some((entry) => !entry.routing_allowed) ? <SummaryBadge tone="error">Blockiert {routingMap.filter((entry) => !entry.routing_allowed).length}</SummaryBadge> : null}
        </>
      }
      title="Fleet Routing"
    >
      {routingMap.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Fleet-Rollen zugewiesen.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-dbzs-bg">
              <tr className="border-b border-dbzs-border text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">
                <th className="px-2 py-1">Rolle</th>
                <th className="px-2 py-1">Modell</th>
                <th className="px-2 py-1">Safety</th>
                <th className="px-2 py-1">Evidence</th>
                <th className="px-2 py-1">Routing</th>
              </tr>
            </thead>
            <tbody>
              {routingMap.map((entry) => (
                <tr className="border-b border-dbzs-border/60" key={`${entry.role}:${entry.bundle_id}`}>
                  <td className="px-2 py-1.5 text-xs font-medium text-dbzs-text">{entry.role}</td>
                  <td className="px-2 py-1.5 text-xs text-dbzs-text">{entry.bundle_name}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.safety_level}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
                    {entry.passed_certifications.length}/{entry.required_certifications.length}
                    {entry.missing_certifications.length > 0 ? ` fehlt: ${entry.missing_certifications.join(", ")}` : ""}
                  </td>
                  <td className="px-2 py-1.5 text-[11px]">
                    <span className={entry.routing_allowed ? "text-dbzs-green" : "text-dbzs-red"}>{entry.routing_allowed ? "Freigegeben" : "Blockiert"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OpsSection>
  );
}

export function ModelLabRoleAssignmentSection({
  models,
  roleAssignments,
  assigningRole,
  settingsFieldConflicts,
  onAssignRole
}: {
  models: ModelLabModel[];
  roleAssignments: ModelLabRoleAssignment[];
  assigningRole: boolean;
  settingsFieldConflicts: Set<string>;
  onAssignRole: (request: ModelLabRoleAssignmentRequest) => void;
}) {
  return (
    <OpsSection
      defaultOpen={false}
      source="Role Assignments"
      summary={
        <>
          <SummaryBadge tone="info">Assignments {roleAssignments.length}</SummaryBadge>
          {settingsFieldConflicts.size > 0 ? <SummaryBadge tone="error">Settings-Konflikte {settingsFieldConflicts.size}</SummaryBadge> : <SummaryBadge tone="ok">Keine Settings-Konflikte</SummaryBadge>}
        </>
      }
      title="Role Assignment"
    >
      {models.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Modelle gescannt.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full min-w-[1020px] border-collapse text-left">
            <thead className="bg-dbzs-bg">
              <tr className="border-b border-dbzs-border text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">
                <th className="px-2 py-1">Bundle</th>
                <th className="px-2 py-1">Health</th>
                <th className="px-2 py-1">Zuordnung</th>
                <th className="px-2 py-1">Rolle</th>
                <th className="px-2 py-1">Settings-Feld</th>
                <th className="px-2 py-1">Residency</th>
                <th className="px-2 py-1">Aktiv</th>
                <th className="px-2 py-1" />
                <th className="px-2 py-1">Runtime</th>
              </tr>
            </thead>
            <tbody>
              {models.map((entry) => (
                <RoleAssignmentRow assigningRole={assigningRole} assignments={roleAssignments.filter((assignment) => assignment.bundle_id === entry.bundle.bundle_id)} entry={entry} hasConflict={settingsFieldConflicts.has(entry.bundle.bundle_id)} key={entry.bundle.bundle_id} onAssignRole={onAssignRole} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OpsSection>
  );
}

export function ModelLabHuggingFaceSearchSection({
  query,
  onQueryChange,
  onSearch,
  results,
  searching,
  error
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  results: ModelLabHuggingFaceSearchResult[];
  searching: boolean;
  error: string | null;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch();
  };

  return (
    <OpsSection
      defaultOpen={false}
      source="HuggingFace Search API"
      summary={
        <>
          <SummaryBadge tone="info">Treffer {results.length}</SummaryBadge>
          {results.length > 0 ? <SummaryBadge tone="ok">Top Repo {results[0]?.id ?? "-"}</SummaryBadge> : null}
        </>
      }
      title="Benchmarks / Discovery"
    >
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <input className="min-w-[240px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text" onChange={(event) => onQueryChange(event.target.value)} placeholder="z. B. llama-3 gguf" type="text" value={query} />
        <button className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40" disabled={searching || !query.trim()} type="submit">
          {searching ? "Sucht..." : "Suchen"}
        </button>
      </form>
      {error ? <p className="mb-2 text-xs text-dbzs-red">{error}</p> : null}
      {results.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Keine Suchergebnisse.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead className="bg-dbzs-bg">
              <tr className="border-b border-dbzs-border text-[10px] uppercase tracking-[0.1em] text-dbzs-muted">
                <th className="px-2 py-1">Repo</th>
                <th className="px-2 py-1">Pipeline</th>
                <th className="px-2 py-1">Downloads</th>
                <th className="px-2 py-1">Likes</th>
                <th className="px-2 py-1">Groesse</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr className="border-b border-dbzs-border/60" key={result.id}>
                  <td className="px-2 py-1.5 text-xs text-dbzs-text">{result.id}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{result.pipeline || "-"}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{result.downloads}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{result.likes}</td>
                  <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{formatBytes(result.size_mb * 1024 * 1024)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OpsSection>
  );
}
