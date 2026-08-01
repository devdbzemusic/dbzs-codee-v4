/*
 * Flags number collisions in Pläne/ filenames (Plan 12, Etappe 4, Punkt 17).
 *
 * Plan documents in this repo are prefixed with a two-digit slot number
 * (e.g. "09 DBZS_CODEE_V4_REPOSITORY_URTEIL_...md"), sometimes spanning
 * several slots at once (e.g. "03 04 05 ...md"). With multiple parallel
 * Claude Code sessions regularly adding plan documents, the same slot has
 * repeatedly been claimed by more than one unrelated file within hours of
 * each other (observed: "02", "07", and "03 04 05" each claimed twice).
 *
 * This is a *checker*, not an auto-renumberer: deciding which of two
 * colliding plans should move to a free slot is a judgment call, not
 * something to guess at automatically. Non-blocking by default (exits 0
 * even with collisions found), unless --strict is passed.
 *
 * Usage: node scripts/check-plaene-numbering.mjs [--strict]
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plaeneDir = path.join(repoRoot, "Pläne");
const strict = process.argv.includes("--strict");

const SLOT_PREFIX_PATTERN = /^((?:\d{2}\s+)*\d{2})\s+(.+)$/;

function parseSlots(fileName) {
  const match = fileName.match(SLOT_PREFIX_PATTERN);
  if (!match) return null;
  return match[1].split(/\s+/);
}

function main() {
  const entries = readdirSync(plaeneDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const claimsBySlot = new Map();
  for (const fileName of entries) {
    const slots = parseSlots(fileName);
    if (!slots) continue;
    for (const slot of slots) {
      const claimants = claimsBySlot.get(slot) ?? [];
      claimants.push(fileName);
      claimsBySlot.set(slot, claimants);
    }
  }

  const collisions = [...claimsBySlot.entries()]
    .filter(([, files]) => new Set(files).size > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  if (collisions.length === 0) {
    console.log("check-plaene-numbering: keine Nummern-Kollision gefunden.");
    process.exit(0);
  }

  console.warn("check-plaene-numbering: Nummern-Kollisionen in Pläne/ gefunden:");
  for (const [slot, files] of collisions) {
    console.warn(`  - Slot "${slot}":`);
    for (const file of new Set(files)) {
      console.warn(`      ${file}`);
    }
  }

  process.exit(strict ? 1 : 0);
}

main();
