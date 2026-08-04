/*
 * Guarantees the electron binary is actually downloaded after `pnpm install`.
 *
 * Root cause (observed 2026-08-04, not fully explained): pnpm-workspace.yaml's
 * `allowBuilds: { electron: true, ... }` is the officially documented pnpm
 * setting for this and correctly resolves electron's package during install
 * (electron-winstaller's own build script under the same allowBuilds entry
 * runs fine) -- but electron's own install.js (which downloads the actual
 * electron.exe/electron.app via @electron/get) silently does not run,
 * leaving node_modules/electron/dist missing with no warning or error from
 * pnpm. Reproduced on a clean install twice. Rather than depend on pinning
 * down pnpm's internal script-approval behavior further, this idempotently
 * runs electron's own install script directly whenever the binary is absent
 * -- safe to run on every install, near-instant no-op when already present.
 *
 * Usage: node scripts/ensure-electron-binary.mjs (wired into "postinstall")
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function findElectronDir() {
  try {
    const pkgPath = require.resolve("electron/package.json", { paths: [repoRoot] });
    return path.dirname(pkgPath);
  } catch {
    return null;
  }
}

function isElectronBinaryPresent(electronDir) {
  const win = path.join(electronDir, "dist", "electron.exe");
  const mac = path.join(electronDir, "dist", "Electron.app");
  const linux = path.join(electronDir, "dist", "electron");
  return existsSync(win) || existsSync(mac) || existsSync(linux);
}

function main() {
  const electronDir = findElectronDir();
  if (!electronDir) {
    console.log("ensure-electron-binary: electron not in the dependency tree, nothing to do.");
    process.exit(0);
  }

  if (isElectronBinaryPresent(electronDir)) {
    console.log("ensure-electron-binary: electron binary already present.");
    process.exit(0);
  }

  console.log("ensure-electron-binary: electron binary missing, running electron/install.js...");
  const result = spawnSync(process.execPath, [path.join(electronDir, "install.js")], {
    cwd: electronDir,
    stdio: "inherit"
  });

  if (result.status !== 0 || !isElectronBinaryPresent(electronDir)) {
    console.warn(
      "ensure-electron-binary: electron/install.js did not produce a binary. " +
      "Electron-dependent scripts (dev/build/e2e) may fail until this is resolved manually."
    );
    process.exit(0); // non-fatal -- don't break `pnpm install` for non-desktop workflows
  }

  console.log("ensure-electron-binary: electron binary installed successfully.");
}

main();
