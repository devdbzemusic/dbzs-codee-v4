import fs from "node:fs";
import path from "node:path";
import { projectRoot, repoRoot } from "./lib.mjs";

const source = path.join(projectRoot, "e2e");
const target = path.join(repoRoot, "apps/desktop/e2e/ui-refactor");
fs.mkdirSync(target, { recursive: true });

for (const file of fs.readdirSync(source)) {
  if (!file.endsWith(".ts")) continue;
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}

const proposal = {
  rootScripts: {
    "test:ui-refactor": "node tools/ui-refactor-qa/scripts/run-all.mjs",
    "test:ui-refactor:e2e": "pnpm --filter @dbzs/desktop e2e e2e/ui-refactor"
  },
  desktopScripts: {
    "e2e:ui-refactor": "playwright test e2e/ui-refactor"
  }
};

fs.writeFileSync(
  path.join(projectRoot, "SCRIPT_PROPOSAL.json"),
  JSON.stringify(proposal, null, 2),
  "utf8"
);

console.log(`E2E-Dateien installiert nach ${target}`);
console.log("package.json wurde absichtlich nicht automatisch verändert.");
console.log("Script-Vorschläge: tools/ui-refactor-qa/SCRIPT_PROPOSAL.json");
