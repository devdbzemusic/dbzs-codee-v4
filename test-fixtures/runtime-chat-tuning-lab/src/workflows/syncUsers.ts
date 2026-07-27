/*
 * DBZS - Division By Zeros
 * Datei: syncUsers.ts
 * Bereich: runtime-chat tuning lab / workflows
 *
 * Zweck:
 *   Simuliert Workflow-Probleme bei Dedupe, Fehlerbehandlung und Summary-Bildung.
 */

export interface RemoteUser {
  email: string;
  displayName: string;
  active: boolean;
}

export interface SyncSummary {
  imported: number;
  skipped: number;
  failed: number;
  duplicateEmails: string[];
}

export async function syncUsers(
  users: RemoteUser[],
  importer: (user: RemoteUser) => Promise<void>
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    imported: 0,
    skipped: 0,
    failed: 0,
    duplicateEmails: []
  };
  const seen = new Set<string>();

  await Promise.all(
    users.map(async (user) => {
      const dedupeKey = user.displayName.trim().toLowerCase();
      if (seen.has(dedupeKey)) {
        summary.skipped += 1;
        summary.duplicateEmails.push(user.email);
        return;
      }
      seen.add(dedupeKey);

      if (!user.active) {
        summary.skipped += 1;
        return;
      }

      try {
        await importer(user);
        summary.imported += 1;
      } catch {
        summary.failed += 1;
      }
    })
  );

  return summary;
}
