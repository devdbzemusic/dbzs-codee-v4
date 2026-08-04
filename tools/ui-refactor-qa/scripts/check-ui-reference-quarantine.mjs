import fs from "node:fs";
import path from "node:path";
import { config, repoRoot, result, printResults, walk, writeJson } from "./lib.mjs";

const results = [];
const sourceRoot = path.join(repoRoot, config.paths.desktopSrc);
const sourceFiles = walk(sourceRoot, (file) => /\.(ts|tsx|js|jsx|css|scss|json)$/.test(file));
const violations = [];

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of config.forbiddenReferencePatterns) {
    if (text.includes(pattern)) {
      violations.push({ file: path.relative(repoRoot, file), pattern });
    }
  }
}

results.push(result(
  "QA-005",
  violations.length === 0,
  violations.length ? `${violations.length} verbotene Referenzimporte/-muster gefunden` : "Keine verbotenen Demo-Imports gefunden",
  { violations }
));

const referenceRoot = process.env[config.paths.referenceEnv];
if (referenceRoot) {
  const required = [
    "client/src/components/codee/CodeeWorkbench.tsx",
    "client/src/index.css",
    "client/src/hooks/useCodeeWorkbenchController.ts",
    "client/src/lib/codeeWorkbenchModel.ts"
  ];
  for (const rel of required) {
    results.push(result(
      `REFERENCE-${rel}`,
      fs.existsSync(path.join(referenceRoot, rel)),
      `UI-Referenzdatei ${rel}`
    ));
  }
  const accidentalInsideRepo = path.resolve(referenceRoot).startsWith(path.resolve(repoRoot) + path.sep);
  results.push(result(
    "QA-REFERENCE-LOCATION",
    !accidentalInsideRepo || referenceRoot.includes(".codee-reference"),
    "UI-Referenz liegt außerhalb des Produktiv-Source-Trees oder in .codee-reference",
    { referenceRoot }
  ));
} else {
  results.push(result("QA-REFERENCE-OPTIONAL", true, "DBZS_UI_REFERENCE_ROOT nicht gesetzt; Quellinventarprüfung übersprungen"));
}

writeJson("ui-reference-quarantine.json", results);
if (!printResults(results)) process.exitCode = 1;
