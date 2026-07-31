/*
 * Flags drift between README.md, TODO.md, HANDOVER.md and docs/STATUS_TODAY.md
 * (Plaene/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md, Abschnitt 14 — "automatische
 * Synchronisation" of these four files).
 *
 * Deliberately a *checker*, not an auto-rewriter: these files carry hand-written
 * nuance (what's still open, what's deliberately deferred, why) that a blind
 * overwrite would destroy. This only compares the "Stand: <date>" line each file
 * carries and any `origin/main` commit-hash references, and warns on mismatch --
 * non-blocking, exits 0 even when drift is found, unless --strict is passed.
 *
 * Usage: node scripts/check-docs-drift.mjs [--strict]
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const TRACKED_FILES = ["README.md", "TODO.md", "HANDOVER.md", path.join("docs", "STATUS_TODAY.md")];

function extractStandDate(text) {
  const match = text.match(/^Stand:\s*(\d{4}-\d{2}-\d{2})/m);
  return match ? match[1] : null;
}

function extractOriginMainHashes(text) {
  const hashes = [];
  const pattern = /origin\/main[`'"]?\s*(?:zeigt auf|points to|shows)\s*[`'"]?([0-9a-f]{7,40})/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    hashes.push(match[1]);
  }
  return hashes;
}

function main() {
  const findings = [];
  const standDates = new Map();
  const hashRefs = new Map();

  for (const relPath of TRACKED_FILES) {
    const fullPath = path.join(repoRoot, relPath);
    if (!existsSync(fullPath)) {
      findings.push(`${relPath}: Datei fehlt.`);
      continue;
    }
    const text = readFileSync(fullPath, "utf-8");
    const standDate = extractStandDate(text);
    if (!standDate) {
      findings.push(`${relPath}: keine "Stand: YYYY-MM-DD"-Zeile gefunden.`);
    } else {
      standDates.set(relPath, standDate);
    }
    const hashes = extractOriginMainHashes(text);
    if (hashes.length > 0) {
      hashRefs.set(relPath, hashes);
    }
  }

  const uniqueDates = new Set(standDates.values());
  if (uniqueDates.size > 1) {
    findings.push(
      `"Stand:"-Datum weicht ab: ${[...standDates.entries()].map(([file, date]) => `${file}=${date}`).join(", ")}`
    );
  }

  const uniqueHashPrefixes = new Set(
    [...hashRefs.values()].flat().map((hash) => hash.slice(0, 7))
  );
  if (uniqueHashPrefixes.size > 1) {
    findings.push(
      `origin/main-Commit-Referenz weicht ab: ${[...hashRefs.entries()]
        .map(([file, hashes]) => `${file}=${hashes.join(",")}`)
        .join(" | ")}`
    );
  }

  if (findings.length === 0) {
    console.log("check-docs-drift: keine Abweichung gefunden.");
    process.exit(0);
  }

  console.warn("check-docs-drift: moegliche Doku-Drift gefunden:");
  for (const finding of findings) {
    console.warn(`  - ${finding}`);
  }
  process.exit(strict ? 1 : 0);
}

main();
