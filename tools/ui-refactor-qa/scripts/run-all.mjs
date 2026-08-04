import fs from "node:fs";
import path from "node:path";
import { projectRoot, repoRoot, artifactsDir, ensureArtifacts, phase, run } from "./lib.mjs";

ensureArtifacts();

const checks = [
  "check-repository-baseline.mjs",
  "check-ui-reference-quarantine.mjs",
  "check-neural-shell-contract.mjs",
  "check-css-contract.mjs",
  "check-changed-ui-files.mjs"
];

const executions = [];
for (const script of checks) {
  const execution = run("node", [path.join(projectRoot, "scripts", script)], {
    cwd: repoRoot,
    env: { DBZS_UI_QA_PHASE: phase }
  });
  executions.push({ name: script, ...execution });
  fs.writeFileSync(
    path.join(artifactsDir, "logs", `${script}.log`),
    `${execution.stdout}\n${execution.stderr}`,
    "utf8"
  );
}

const optionalCommands = [
  { name: "typecheck", command: "pnpm", args: ["typecheck"] },
  { name: "desktop-tests", command: "pnpm", args: ["--filter", "@dbzs/desktop", "test"] }
];

if (phase === "final") {
  optionalCommands.push({ name: "backend-tests", command: "pnpm", args: ["test"] });
}

if (process.env.DBZS_UI_QA_SKIP_REPO_COMMANDS !== "1") {
  for (const item of optionalCommands) {
    const execution = run(item.command, item.args, { cwd: repoRoot, timeout: 30 * 60 * 1000 });
    executions.push({ name: item.name, ...execution });
    fs.writeFileSync(
      path.join(artifactsDir, "logs", `${item.name}.log`),
      `${execution.stdout}\n${execution.stderr}`,
      "utf8"
    );
  }
}

const summary = {
  phase,
  repoRoot,
  generatedAt: new Date().toISOString(),
  passed: executions.filter((item) => item.ok).length,
  failed: executions.filter((item) => !item.ok).length,
  executions
};

fs.writeFileSync(path.join(artifactsDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

const md = [
  "# DBZS UI Refactor QA Summary",
  "",
  `- Phase: \`${phase}\``,
  `- Passed: **${summary.passed}**`,
  `- Failed: **${summary.failed}**`,
  "",
  "| Check | Status | Dauer |",
  "|---|---:|---:|",
  ...executions.map((item) => `| ${item.name} | ${item.ok ? "PASS" : "FAIL"} | ${item.durationMs} ms |`)
].join("\n");
fs.writeFileSync(path.join(artifactsDir, "summary.md"), md, "utf8");

console.log(md);
if (summary.failed) process.exitCode = 1;
