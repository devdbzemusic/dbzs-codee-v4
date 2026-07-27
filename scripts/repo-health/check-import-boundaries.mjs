import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const targets = [
  "apps/desktop/src",
  "apps/desktop/electron",
  "backend/app",
];
const ignoredSegments = new Set(["node_modules", "dist", "out", ".git", ".cache", "coverage", "backend-dist"]);
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".py"]);

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

const importRegex = /^\s*import\s+.*?from\s+["'](.+?)["'];?/gm;

function collectImports(file) {
  const raw = fs.readFileSync(file, "utf8");
  return [...raw.matchAll(importRegex)].map((match) => match[1]);
}

function fileCategory(relative) {
  if (relative.startsWith("apps/desktop/src/components/")) return "component";
  if (relative.startsWith("apps/desktop/src/stores/")) return "store";
  if (relative.startsWith("apps/desktop/src/services/")) return "service";
  if (relative.startsWith("apps/desktop/src/runtime/")) return "runtime";
  if (relative.startsWith("packages/shared/src/")) return "shared";
  if (relative.startsWith("backend/app/runtime/")) return "backend-runtime";
  return "other";
}

function isViolation(relative, importPath) {
  const category = fileCategory(relative);
  if (category === "component" && (importPath.includes("backend/") || importPath.includes("node:fs") || importPath.includes("child_process"))) {
    return "components must not import backend or filesystem/process logic";
  }
  if (category === "store" && importPath.startsWith("@/components/")) {
    return "stores must not import components";
  }
  if (category === "shared" && (importPath.startsWith("@/") || importPath.startsWith("backend/"))) {
    return "shared must remain framework- and app-neutral";
  }
  return null;
}

const failures = [];
const warnings = [];
for (const file of targets.flatMap((dir) => walk(path.join(repoRoot, dir)))) {
  const relative = rel(file);
  for (const importPath of collectImports(file)) {
    const violation = isViolation(relative, importPath);
    if (violation) {
      failures.push(`${relative} -> ${importPath} :: ${violation}`);
      continue;
    }
    if (fileCategory(relative) === "component" && importPath.startsWith("@/services/") && !importPath.includes("bootUiFormatter")) {
      warnings.push(`${relative} -> ${importPath} :: component uses service directly`);
    }
  }
}

if (warnings.length > 0) {
  console.log("Import boundary warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (failures.length > 0) {
  console.error("Import boundary violations:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Import boundary check passed.");
