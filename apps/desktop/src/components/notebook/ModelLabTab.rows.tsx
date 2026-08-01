import type { ModelLabModel, ModelLabSource } from "@dbzs/shared";
import { formatBytes, ModelLabStatusBadge } from "./ModelLabTab.primitives";

export function SourceRow({ source, onScan, isScanning }: { source: ModelLabSource; onScan: () => void; isScanning: boolean }) {
  return (
    <tr className="border-b border-dbzs-border/60">
      <td className="px-2 py-1.5 text-xs text-dbzs-text">{source.name ?? source.path}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{source.path}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
        {source.enabled ? "aktiv" : "deaktiviert"}
        {source.trusted ? " - vertrauenswuerdig" : ""}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
        {source.last_scan_status ?? "noch nicht gescannt"}
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-40"
          disabled={isScanning || !source.enabled}
          onClick={onScan}
          type="button"
        >
          {isScanning ? "Scannt..." : "Scan"}
        </button>
      </td>
    </tr>
  );
}

export function ModelBundleRow({
  entry,
  isSelected,
  onSelect
}: {
  entry: ModelLabModel;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { bundle } = entry;
  const totalSize = entry.artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);

  return (
    <tr
      className={`cursor-pointer border-b border-dbzs-border/60 ${isSelected ? "bg-dbzs-cyan/5" : "hover:bg-dbzs-bg"}`}
      onClick={onSelect}
    >
      <td className="px-2 py-1.5 text-xs text-dbzs-text">
        {bundle.is_favorite ? "* " : ""}
        {bundle.name}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
        <ModelLabStatusBadge status={bundle.status} />
      </td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{bundle.health.quantization ?? "-"}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{formatBytes(totalSize)}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{bundle.capabilities.join(", ") || "-"}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.artifacts.length}</td>
    </tr>
  );
}
