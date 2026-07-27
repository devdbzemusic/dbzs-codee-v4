import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const softLimit = 600;
const hardLimit = 900;
const targetRoots = [
  "apps/desktop/src",
  "apps/desktop/electron",
  "backend/app",
  "packages/shared/src",
];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".py"]);
const ignoredSegments = new Set([
  "node_modules",
  "dist",
  "out",
  "coverage",
  ".git",
  ".cache",
  "backend-dist",
]);

const legacyHardLimitAllowlist = new Set([
  "apps/desktop/src/stores/runtimeChatStore.ts",
  "apps/desktop/src/App.tsx",
  "apps/desktop/src/components/JobMonitorPanel.tsx",
  "apps/desktop/src/components/RuntimeChatTab.tsx",
  "apps/desktop/src/components/WorkspaceExplorer.tsx",
  "apps/desktop/src/settings/settingsRegistry.ts",
  "apps/desktop/src/skills/.system/imagegen/scripts/image_gen.py",
  "apps/desktop/src/skills/sora/scripts/sora.py",
  "apps/desktop/electron/main.ts",
  "backend/app/agent_workbench/repository.py",
  "backend/app/models/index_service.py",
  "backend/app/runtime/service.py",
  "packages/shared/src/index.ts",
]);

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
      continue;
    }
    if (!extensions.has(path.extname(entry.name))) continue;
    results.push(full);
  }
  return results;
}

function rel(file) {
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

function countTopLevelMatches(lines, regex) {
  let depth = 0;
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (depth === 0 && regex.test(trimmed)) {
      count += 1;
    }
    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") depth = Math.max(0, depth - 1);
    }
  }
  return count;
}

function metricForFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const lineCount = lines.length;
  const topLevelFunctionCount = countTopLevelMatches(lines, /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?const\s+\w+\s*=\s*\(/);
  const exportCount = lines.filter((line) => /^\s*export\s+/.test(line)).length;
  return { lineCount, topLevelFunctionCount, exportCount };
}

const files = targetRoots.flatMap((dir) => walk(path.join(repoRoot, dir)));
const warnings = [];
const failures = [];

for (const file of files) {
  const relative = rel(file);
  const { lineCount, topLevelFunctionCount, exportCount } = metricForFile(file);

  if (lineCount >= softLimit) {
    warnings.push(`[lines] ${relative}: ${lineCount}`);
  }
  if (topLevelFunctionCount >= 12) {
    warnings.push(`[top-level-functions] ${relative}: ${topLevelFunctionCount}`);
  }
  if (exportCount >= 50) {
    warnings.push(`[exports] ${relative}: ${exportCount}`);
  }
  if (lineCount >= hardLimit && !legacyHardLimitAllowlist.has(relative)) {
    failures.push(`[hard-limit] ${relative}: ${lineCount} lines`);
  }
}

if (warnings.length > 0) {
  console.log("Repo health warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (failures.length > 0) {
  console.error("Repo health hard failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("File metrics check passed.");
