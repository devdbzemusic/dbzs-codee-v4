import type { IndexedModel } from "./index.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function formatModelSizeBadge(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "";
  }

  if (sizeBytes >= GB) {
    const gb = Math.round((sizeBytes / GB) * 10) / 10;
    const label = Number.isInteger(gb) ? `${gb}` : gb.toFixed(1);
    return `[${label}GB]`;
  }

  const mb = Math.max(1, Math.round(sizeBytes / MB));
  return `[${mb}MB]`;
}

export function formatRuntimeModelLabel(model: Pick<IndexedModel, "name" | "runtime_launcher" | "size_bytes">): string {
  const sizeBadge = formatModelSizeBadge(model.size_bytes);
  const nameWithSize = sizeBadge ? `${model.name} ${sizeBadge}` : model.name;
  return `${nameWithSize} · ${model.runtime_launcher}`;
}
