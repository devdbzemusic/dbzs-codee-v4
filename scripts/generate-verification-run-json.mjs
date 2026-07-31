/*
 * Generates a machine-readable verification-run.json inside an acceptance-run
 * folder (Plaene/10 DBZS_CODEE_V4_ABNAHME_TEST_PLAYBOOK.md, Abschnitt 14).
 *
 * Reads the same RUN_SUMMARY.md overview table that a tester fills in by hand
 * (see scripts/new-acceptance-run.ps1) rather than tracking its own separate
 * state -- one source of truth for a run's test statuses.
 *
 * Usage: node scripts/generate-verification-run-json.mjs [run-folder]
 *   run-folder defaults to the most recently modified folder under
 *   docs/audits/runs/.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runsRoot = path.join(repoRoot, "docs", "audits", "runs");

function resolveRunDir(argRunDir) {
  if (argRunDir) {
    return path.isAbsolute(argRunDir) ? argRunDir : path.join(repoRoot, argRunDir);
  }
  if (!existsSync(runsRoot)) {
    throw new Error(`No runs found under ${runsRoot} -- run scripts/new-acceptance-run.ps1 first.`);
  }
  const candidates = readdirSync(runsRoot)
    .map((name) => path.join(runsRoot, name))
    .filter((full) => statSync(full).isDirectory());
  if (candidates.length === 0) {
    throw new Error(`No run folders under ${runsRoot} -- run scripts/new-acceptance-run.ps1 first.`);
  }
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/** Parses the "| Test-ID | Titel | Status |" markdown table written by new-acceptance-run.ps1. */
function parseTestOverview(runSummaryText) {
  const rows = [];
  const tableRowPattern = /^\|\s*([A-Z]{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*([A-Z_]+)\s*\|\s*$/gm;
  let match;
  while ((match = tableRowPattern.exec(runSummaryText)) !== null) {
    rows.push({ id: match[1], title: match[2], status: match[3] });
  }
  return rows;
}

function main() {
  const runDir = resolveRunDir(process.argv[2]);
  const runSummaryPath = path.join(runDir, "RUN_SUMMARY.md");
  if (!existsSync(runSummaryPath)) {
    throw new Error(`RUN_SUMMARY.md not found in ${runDir} -- is this a valid acceptance-run folder?`);
  }

  const runSummaryText = readFileSync(runSummaryPath, "utf-8");
  const tests = parseTestOverview(runSummaryText);
  if (tests.length === 0) {
    throw new Error(`No test rows parsed from ${runSummaryPath} -- overview table format may have changed.`);
  }

  const statusCounts = tests.reduce((acc, test) => {
    acc[test.status] = (acc[test.status] ?? 0) + 1;
    return acc;
  }, {});

  const payload = {
    runId: path.basename(runDir),
    generatedAt: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    statusCounts,
    tests
  };

  const outPath = path.join(runDir, "verification-run.json");
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  console.log(`verification-run.json geschrieben: ${outPath}`);
  console.log(`  ${tests.length} Tests, Status: ${JSON.stringify(statusCounts)}`);
}

main();
