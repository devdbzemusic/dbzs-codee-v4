import fs from "node:fs";
import path from "node:path";
import { config, repoRoot, phase, result, printResults, walk, writeJson } from "./lib.mjs";

const results = [];
const srcRoot = path.join(repoRoot, config.paths.desktopSrc);
const files = walk(srcRoot, (file) => /\.(ts|tsx)$/.test(file));
const corpus = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

const phaseConfig = config.phases[phase] || config.phases.baseline;
const shellSignals = [
  "NeuralWorkbenchShell",
  "data-testid=\"dbzs-workbench\"",
  "uiShellMode",
  "neural-workbench"
];
const foundSignals = shellSignals.filter((signal) => corpus.includes(signal));

results.push(result(
  "QA-007",
  !phaseConfig.requireFeatureFlag || (corpus.includes("classic") && corpus.includes("neural-workbench")),
  phaseConfig.requireFeatureFlag ? "Feature Flag classic/neural-workbench vorhanden" : "Feature Flag in Baseline noch optional",
  { foundSignals }
));

results.push(result(
  "QA-008",
  !phaseConfig.requireNeuralShell || foundSignals.length >= 2,
  phaseConfig.requireNeuralShell ? "Neural Workbench Shell erkannt" : "Neural Workbench Shell in Baseline noch optional",
  { foundSignals }
));

const appPath = path.join(srcRoot, "App.tsx");
if (fs.existsSync(appPath)) {
  const lines = fs.readFileSync(appPath, "utf8").split(/\r?\n/).length;
  results.push(result(
    "QA-APP-SIZE",
    lines < 1800,
    `App.tsx hat ${lines} Zeilen`,
    { advisory: lines > 1200 ? "Weiter extrahieren" : "Akzeptabel" }
  ));
}

writeJson("neural-shell-contract.json", results);
if (!printResults(results)) process.exitCode = 1;
