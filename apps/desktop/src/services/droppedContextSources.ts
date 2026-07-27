/**
 * Deduplicate and structure context drop telemetry.
 */

import type { DroppedContextReason, DroppedContextSource } from "@dbzs/shared";

export function dedupeDroppedSourceIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => Boolean(id?.trim()))));
}

export function allocateTokensRemoved(
  ids: string[],
  tokensBefore: number,
  tokensAfter: number
): Record<string, number> {
  const unique = dedupeDroppedSourceIds(ids);
  const totalRemoved = Math.max(0, tokensBefore - tokensAfter);
  if (unique.length === 0 || totalRemoved === 0) {
    return {};
  }
  const base = Math.floor(totalRemoved / unique.length);
  let remainder = totalRemoved - base * unique.length;
  const out: Record<string, number> = {};
  for (const id of unique) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    out[id] = base + extra;
  }
  return out;
}

export function buildDroppedContextSources(
  ids: string[],
  reason: DroppedContextReason,
  tokensRemovedById?: Record<string, number>,
  totals?: { tokensBefore: number; tokensAfter: number }
): DroppedContextSource[] {
  const unique = dedupeDroppedSourceIds(ids);
  const tokensBefore = Math.max(0, totals?.tokensBefore ?? 0);
  const tokensAfter = Math.max(0, totals?.tokensAfter ?? 0);
  return unique.map((id) => {
    const tokensRemoved = Math.max(0, tokensRemovedById?.[id] ?? 0);
    return {
      id,
      reason,
      tokensBefore,
      tokensAfter,
      tokensRemoved
    };
  });
}

export function mergeDroppedContextSources(
  existing: DroppedContextSource[],
  next: DroppedContextSource[]
): DroppedContextSource[] {
  const byId = new Map<string, DroppedContextSource>();
  for (const entry of [...existing, ...next]) {
    const prev = byId.get(entry.id);
    if (!prev) {
      byId.set(entry.id, entry);
      continue;
    }
    byId.set(entry.id, {
      id: entry.id,
      reason: prev.reason === "duplicate" ? entry.reason : prev.reason,
      tokensBefore: Math.max(prev.tokensBefore, entry.tokensBefore),
      tokensAfter: Math.min(prev.tokensAfter, entry.tokensAfter),
      tokensRemoved: Math.max(prev.tokensRemoved, entry.tokensRemoved)
    });
  }
  return Array.from(byId.values());
}
