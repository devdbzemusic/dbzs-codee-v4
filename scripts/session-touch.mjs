/*
 * Lightweight session-coordination check (Plan 12, Etappe 1, Punkt 3).
 *
 * This project is regularly worked on by multiple Claude Code sessions in the
 * same working directory at the same time, which has repeatedly caused
 * collisions (branch checkouts mid-session, surprise commits, uncommitted
 * files from another session sitting in the shared tree). This script makes
 * that visible instead of discoverable only via surprising diffs: each
 * session registers itself in `.codee/session-registry.json` (gitignored --
 * this is live local coordination state, not project history) and prints a
 * warning if another session's entry is still fresh.
 *
 * Usage: node scripts/session-touch.mjs "kurze Aufgabenbeschreibung"
 *   Run once at session start, and again before risky git operations
 *   (checkout, reset, force-push) if in doubt.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(repoRoot, ".codee", "session-registry.json");

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h: a session not touched since is assumed ended.

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function loadRegistry() {
  if (!existsSync(registryPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function main() {
  const task = process.argv[2] ?? "";
  const branch = git(["branch", "--show-current"]) ?? "(unbekannt)";
  const now = Date.now();
  const sessionId = `${process.pid}-${now.toString(36)}`;

  const existing = loadRegistry();
  const fresh = existing.filter((entry) => now - new Date(entry.lastSeenAt).getTime() < STALE_AFTER_MS);
  const others = fresh.filter((entry) => entry.sessionId !== sessionId);

  if (others.length > 0) {
    console.warn("session-touch: andere aktive Session(en) gefunden:");
    for (const entry of others) {
      const ageMinutes = Math.round((now - new Date(entry.lastSeenAt).getTime()) / 60000);
      console.warn(
        `  - Branch "${entry.branch}", zuletzt aktiv vor ${ageMinutes} min, Aufgabe: ${entry.task || "(keine Angabe)"}`
      );
    }
    if (others.some((entry) => entry.branch !== branch)) {
      console.warn(
        "  ACHTUNG: mindestens eine andere Session ist auf einem ANDEREN Branch aktiv -- vor `git checkout`/`reset`/Force-Push besonders vorsichtig sein."
      );
    }
  } else {
    console.log("session-touch: keine andere aktive Session gefunden.");
  }

  const updated = [
    ...fresh.filter((entry) => entry.sessionId !== sessionId),
    { sessionId, branch, task, startedAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString() }
  ];

  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
  console.log(`session-touch: registriert auf Branch "${branch}"${task ? ` (${task})` : ""}.`);
}

main();
