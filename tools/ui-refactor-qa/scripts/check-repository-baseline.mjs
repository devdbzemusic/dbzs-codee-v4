import fs from "node:fs";
import path from "node:path";
import { config, repoRoot, result, printResults, readJson, writeJson, run } from "./lib.mjs";

const results = [];
const rootPkgPath = path.join(repoRoot, config.repository.rootPackage);
const desktopPkgPath = path.join(repoRoot, config.repository.desktopPackage);
const playwrightPath = path.join(repoRoot, "apps/desktop/playwright.config.ts");

results.push(result("QA-001", fs.existsSync(rootPkgPath), "Root package.json vorhanden"));
results.push(result("QA-002", fs.existsSync(desktopPkgPath), "Desktop package.json vorhanden"));
results.push(result("QA-003", fs.existsSync(playwrightPath), "Playwright-Konfiguration vorhanden"));

if (fs.existsSync(rootPkgPath)) {
  const pkg = readJson(rootPkgPath);
  results.push(result("QA-004", pkg.name === config.repository.expectedName, `Repository-Paketname ist ${pkg.name}`));
  for (const script of ["test", "typecheck", "lint", "e2e", "ci:local:win"]) {
    results.push(result(`SCRIPT-${script}`, Boolean(pkg.scripts?.[script]), `Root-Script ${script} vorhanden`));
  }
}

if (fs.existsSync(desktopPkgPath)) {
  const pkg = readJson(desktopPkgPath);
  for (const script of ["test", "typecheck", "e2e", "dev:renderer"]) {
    results.push(result(`DESKTOP-${script}`, Boolean(pkg.scripts?.[script]), `Desktop-Script ${script} vorhanden`));
  }
  results.push(result("QA-PLAYWRIGHT-DEP", Boolean(pkg.devDependencies?.["@playwright/test"]), "@playwright/test vorhanden"));
}

const git = run("git", ["rev-parse", "HEAD"], { timeout: 30_000 });
if (git.ok) {
  const sha = git.stdout.trim();
  results.push(result(
    "QA-BASELINE-SHA",
    sha.length === 40,
    `Git HEAD erkannt: ${sha}`,
    { expectedBaseline: config.repository.baselineCommit, exactMatch: sha === config.repository.baselineCommit }
  ));
} else {
  results.push(result("QA-BASELINE-SHA", true, "Git-SHA nicht prüfbar; Dateibaseline wird verwendet", { stderr: git.stderr }));
}

writeJson("repository-baseline.json", results);
if (!printResults(results)) process.exitCode = 1;
