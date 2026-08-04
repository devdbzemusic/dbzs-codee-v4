import fs from "node:fs";
import path from "node:path";
import { config, repoRoot, phase, result, printResults, walk, writeJson } from "./lib.mjs";

const results = [];
const cssFiles = walk(path.join(repoRoot, config.paths.desktopSrc), (file) => /\.(css|scss)$/.test(file));
const corpus = cssFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

const forbiddenGeneric = [".panel {", ".header {", ".button {"];
const genericHits = forbiddenGeneric.filter((token) => corpus.includes(token));
results.push(result(
  "QA-CSS-NAMESPACE",
  phase === "baseline" || genericHits.length === 0 || corpus.includes(".dbzs-workbench"),
  "Workbench-CSS verwendet eigenen Namensraum",
  { genericHits }
));

const hasMinGuards = corpus.includes("min-width: 0") && corpus.includes("min-height: 0");
results.push(result(
  "QA-030",
  phase === "baseline" || hasMinGuards,
  phase === "baseline" ? "Grid/Flex-Minimum-Guards in Baseline optional" : "min-width/min-height Guards vorhanden"
));

results.push(result(
  "QA-MANUS-ASSET",
  !corpus.includes("/manus-storage/"),
  "Keine /manus-storage/-Assetpfade im Produktiv-CSS"
));

writeJson("css-contract.json", results);
if (!printResults(results)) process.exitCode = 1;
