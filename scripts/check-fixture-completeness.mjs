/*
 * Verifies that every file/directory path a test-fixtures/<name>/README.md refers to
 * (in backticks, path-shaped: contains a "/" or a file extension) actually
 * exists on disk relative to that fixture's root.
 *
 * Motivation: test-fixtures/runtime-chat-tuning-lab/models/ was promised by its
 * own README ("Enthaelt drei .gguf-Dateien fuer direkte Workspace-Intents wie
 * count_files") but never existed in git history or on disk -- a blanket
 * `models/` .gitignore rule silently swallowed it. The gap sat undetected for
 * weeks because nothing ever cross-checked fixture READMEs against the
 * filesystem; the failure only surfaced when the corresponding pytest ran.
 * This is a cheap, generic pre-check that catches the same class of defect
 * across any fixture, without needing per-fixture test code.
 *
 * Usage: node scripts/check-fixture-completeness.mjs
 * Exits non-zero if any referenced path is missing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(repoRoot, "test-fixtures");

// A backtick-quoted token counts as a path reference if it contains a "/" or
// ends in a plausible file extension -- excludes inline code like `count_files`
// or `npm run build` that just happen to be in backticks.
const PATH_LIKE = /^[\w.\-]+(?:\/[\w.\-]+)*\/?$/;
// A bare extension mention like `.gguf` in prose ("drei `.gguf`-Dateien") is not
// a path reference -- require either a "/" or a non-empty filename before the
// extension (`report.ts`, not just `.ts`).
const HAS_SLASH_OR_EXTENSION = (token) => token.includes("/") || /^[\w\-]+\.[A-Za-z0-9]{1,8}$/.test(token);

function extractPathReferences(text) {
  const refs = new Set();
  const backtickPattern = /`([^`\n]+)`/g;
  let match;
  while ((match = backtickPattern.exec(text)) !== null) {
    const token = match[1].trim();
    if (PATH_LIKE.test(token) && HAS_SLASH_OR_EXTENSION(token)) {
      refs.add(token);
    }
  }
  return [...refs];
}

function main() {
  if (!existsSync(fixturesRoot)) {
    console.log("check-fixture-completeness: kein test-fixtures/-Verzeichnis, nichts zu pruefen.");
    process.exit(0);
  }

  const fixtureDirs = readdirSync(fixturesRoot).filter((name) =>
    statSync(path.join(fixturesRoot, name)).isDirectory()
  );

  const findings = [];

  for (const fixtureName of fixtureDirs) {
    const fixtureRoot = path.join(fixturesRoot, fixtureName);
    const readmePath = path.join(fixtureRoot, "README.md");
    if (!existsSync(readmePath)) continue;

    const text = readFileSync(readmePath, "utf-8");
    const refs = extractPathReferences(text);

    for (const ref of refs) {
      const candidate = path.join(fixtureRoot, ref);
      if (!existsSync(candidate)) {
        findings.push(`${fixtureName}/README.md referenziert "${ref}", aber ${path.relative(repoRoot, candidate)} existiert nicht.`);
      }
    }
  }

  if (findings.length === 0) {
    console.log("check-fixture-completeness: alle README-referenzierten Pfade existieren.");
    process.exit(0);
  }

  console.error("check-fixture-completeness: fehlende Fixture-Pfade gefunden:");
  for (const finding of findings) {
    console.error(`  - ${finding}`);
  }
  process.exit(1);
}

main();
