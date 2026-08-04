import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = process.env.DBZS_REPO_ROOT
  ? path.resolve(process.env.DBZS_REPO_ROOT)
  : path.resolve(projectRoot, "..", "..");

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export const config = readJson(path.join(projectRoot, "qa.config.json"));
export const phase = process.env.DBZS_UI_QA_PHASE || "baseline";
export const artifactsDir = path.join(repoRoot, config.paths.artifacts);

export function ensureArtifacts() {
  fs.mkdirSync(path.join(artifactsDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(artifactsDir, "screenshots"), { recursive: true });
}

export function walk(root, accept = () => true) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        if (["node_modules", ".git", "dist", "out", "coverage", "playwright-report"].includes(entry)) continue;
        stack.push(path.join(current, entry));
      }
    } else if (accept(current)) {
      out.push(current);
    }
  }
  return out.sort();
}

export function result(id, ok, message, details = {}) {
  return { id, ok, message, details, timestamp: new Date().toISOString() };
}

export function run(command, args, options = {}) {
  const started = Date.now();
  let cmd = command;
  let cmdArgs = args;
  if (command === "pnpm") {
    cmd = "npx";
    cmdArgs = ["pnpm", ...args];
  }
  const proc = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: options.timeout || 20 * 60 * 1000
  });
  return {
    command: [command, ...args].join(" "),
    status: proc.status,
    signal: proc.signal,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    durationMs: Date.now() - started,
    ok: proc.status === 0
  };
}

export function writeJson(name, value) {
  ensureArtifacts();
  fs.writeFileSync(path.join(artifactsDir, name), JSON.stringify(value, null, 2), "utf8");
}

export function printResults(results) {
  for (const item of results) {
    console.log(`${item.ok ? "PASS" : "FAIL"} ${item.id} ${item.message}`);
  }
  return results.every((item) => item.ok);
}
