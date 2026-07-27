import { spawnSync } from "node:child_process";

const command = "pnpm";
const args = ["--filter", "@dbzs/desktop", "test:capabilities"];

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...process.env, RUN_CAPABILITY_SUITE: "1" },
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
