import path from "node:path";
import fs from "node:fs";
import { repoRoot, result, printResults, writeJson, run } from "./lib.mjs";

const results = [];
const diff = run("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], { timeout: 30_000 });
if (!diff.ok) {
  results.push(result("QA-031", true, "Git-Diff nicht verfügbar; Changed-Files-Lint übersprungen", { stderr: diff.stderr }));
} else {
  const changed = diff.stdout.split(/\r?\n/).filter(Boolean)
    .filter((file) => /^apps\/desktop\/(src|electron)\/.*\.(ts|tsx|js|jsx)$/.test(file));

  if (!changed.length) {
    results.push(result("QA-031", true, "Keine geänderten UI-/Electron-Dateien"));
  } else {
    const existing = changed.filter((file) => fs.existsSync(path.join(repoRoot, file)));
    const lint = run("pnpm", ["exec", "eslint", ...existing], { timeout: 10 * 60 * 1000 });
    results.push(result(
      "QA-031",
      lint.ok,
      `Changed-Files-Lint für ${existing.length} Dateien`,
      { files: existing, stdout: lint.stdout.slice(-4000), stderr: lint.stderr.slice(-4000) }
    ));
  }
}

writeJson("changed-ui-files.json", results);
if (!printResults(results)) process.exitCode = 1;
