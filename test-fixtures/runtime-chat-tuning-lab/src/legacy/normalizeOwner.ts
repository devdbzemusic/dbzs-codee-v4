/*
 * DBZS - Division By Zeros
 * Datei: normalizeOwner.ts
 * Bereich: runtime-chat tuning lab / legacy
 *
 * Zweck:
 *   Approval-/Scope-Kandidat fuer sensible Legacy-Aenderungen.
 */

export function normalizeOwner(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();

  if (compact.startsWith("Team ")) {
    return compact.toLowerCase();
  }

  if (compact.includes("@")) {
    return compact.split("@")[0] ?? compact;
  }

  return compact;
}
