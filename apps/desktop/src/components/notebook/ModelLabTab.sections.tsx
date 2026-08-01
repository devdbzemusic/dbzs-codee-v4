import { useState, type FormEvent } from "react";
import type {
  ModelLabCollection,
  ModelLabCollectionCreate,
  ModelLabHuggingFaceSearchResult,
  ModelLabModel,
  ModelLabSource
} from "@dbzs/shared";
import { formatBytes, ModelLabStatusBadge } from "./ModelLabTab.primitives";
import { ModelBundleRow, SourceRow } from "./ModelLabTab.rows";

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
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            Aktualisieren
          </button>
          <button
            className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-3 py-1 text-xs font-medium text-dbzs-cyan disabled:opacity-40"
            disabled={isScanning || sourceCount === 0}
            onClick={onScanAll}
            type="button"
          >
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
  newSourcePath,
  onNewSourcePathChange,
  onAddSource,
  addingSource,
  onScanSource,
  isScanning
}: {
  sources: ModelLabSource[];
  newSourcePath: string;
  onNewSourcePathChange: (value: string) => void;
  onAddSource: () => void;
  addingSource: boolean;
  onScanSource: (sourceId: string) => void;
  isScanning: boolean;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newSourcePath.trim()) {
      onAddSource();
    }
  };

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-dbzs-muted">Modellquellen</h3>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <input
          className="min-w-[280px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => onNewSourcePathChange(event.target.value)}
          placeholder="Ordnerpfad, z. B. C:\Modelle"
          type="text"
          value={newSourcePath}
        />
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
          disabled={addingSource || !newSourcePath.trim()}
          type="submit"
        >
          {addingSource ? "Fuegt hinzu..." : "Quelle hinzufuegen"}
        </button>
      </form>
      {sources.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Modellquelle konfiguriert.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
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
              <SourceRow
                isScanning={isScanning}
                key={source.id}
                onScan={() => onScanSource(source.id)}
                source={source}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ModelLabModelsSection({
  models,
  selectedBundleId,
  onSelect
}: {
  models: ModelLabModel[];
  selectedBundleId: string | null;
  onSelect: (bundleId: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-dbzs-muted">Modell-Bibliothek</h3>
      {models.length === 0 ? (
        <p className="text-xs text-dbzs-muted">
          Keine Modelle gefunden - Quelle hinzufuegen und Scan ausfuehren.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
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
            {models.map((entry) => (
              <ModelBundleRow
                entry={entry}
                isSelected={entry.bundle.bundle_id === selectedBundleId}
                key={entry.bundle.bundle_id}
                onSelect={() => onSelect(entry.bundle.bundle_id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
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
    return (
      <div className="border border-dbzs-border bg-dbzs-panel p-3 text-xs text-dbzs-muted">
        Modell auswaehlen, um Details zu sehen.
      </div>
    );
  }

  const { bundle, artifacts } = model;
  const memberCollections = collections.filter((collection) => bundle.collection_ids.includes(collection.id));
  const availableCollections = collections.filter((collection) => !bundle.collection_ids.includes(collection.id));

  return (
    <div className="border border-dbzs-border bg-dbzs-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-dbzs-text">{bundle.name}</h4>
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
              <button
                className="border px-1.5 py-0.5 text-[10px]"
                key={collection.id}
                onClick={() => onRemoveFromCollection?.(collection.id)}
                style={{ borderColor: collection.color, color: collection.color }}
                title="Entfernen"
                type="button"
              >
                {collection.name} x
              </button>
            ))
          )}
        </div>
        {onAddToCollection && availableCollections.length > 0 ? (
          <select
            className="mt-2 border border-dbzs-border bg-dbzs-bg px-1.5 py-1 text-[11px] text-dbzs-text"
            onChange={(event) => {
              if (event.target.value) {
                onAddToCollection(event.target.value);
                event.target.value = "";
              }
            }}
            value=""
          >
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

  const countByCollection = (collectionId: string) =>
    models.filter((entry) => entry.bundle.collection_ids.includes(collectionId)).length;

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-dbzs-muted">Collections</h3>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <input
          className="min-w-[200px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => setName(event.target.value)}
          placeholder="Neue Collection, z. B. Coding-Modelle"
          type="text"
          value={name}
        />
        <input
          aria-label="Farbe"
          className="h-7 w-10 border border-dbzs-border bg-dbzs-bg"
          onChange={(event) => setColor(event.target.value)}
          type="color"
          value={color}
        />
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
          disabled={creatingCollection || !name.trim()}
          type="submit"
        >
          {creatingCollection ? "Legt an..." : "Anlegen"}
        </button>
      </form>
      {collections.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Collection angelegt.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {collections.map((collection) => (
            <span
              className="flex items-center gap-1 border px-2 py-1 text-[11px]"
              key={collection.id}
              style={{ borderColor: collection.color, color: collection.color }}
            >
              {collection.name}
              <span className="text-dbzs-muted">({countByCollection(collection.id)})</span>
            </span>
          ))}
        </div>
      )}
    </div>
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
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-dbzs-muted">
        HuggingFace-Suche
      </h3>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
        <input
          className="min-w-[240px] flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-text"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="z. B. llama-3 gguf"
          type="text"
          value={query}
        />
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-xs text-dbzs-muted disabled:opacity-40"
          disabled={searching || !query.trim()}
          type="submit"
        >
          {searching ? "Sucht..." : "Suchen"}
        </button>
      </form>
      {error ? <p className="mb-2 text-xs text-dbzs-red">{error}</p> : null}
      {results.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Keine Suchergebnisse.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
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
      )}
    </div>
  );
}
