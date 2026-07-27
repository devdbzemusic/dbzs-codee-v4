import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const check = args.includes("--check");
const rootIndex = args.indexOf("--root");
const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
const workspaceRoot = rootArg ? path.resolve(rootArg) : path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootPackageUrl = path.join(workspaceRoot, "package.json");
const desktopUrl = path.join(workspaceRoot, "apps/desktop/package.json");
const sharedUrl = path.join(workspaceRoot, "packages/shared/package.json");
const backendUrl = path.join(workspaceRoot, "backend/pyproject.toml");
const electronBuilderUrl = path.join(workspaceRoot, "apps/desktop/electron-builder.yml");

const root = JSON.parse(await readFile(rootPackageUrl, "utf8"));
const desktop = JSON.parse(await readFile(desktopUrl, "utf8"));
const shared = JSON.parse(await readFile(sharedUrl, "utf8"));
const backend = await readFile(backendUrl, "utf8");
const electronBuilder = await readFile(electronBuilderUrl, "utf8");
const backendVersion = backend.match(/^version = "([^"]+)"/m)?.[1];
const mismatches = [
  desktop.version !== root.version && "desktop",
  shared.version !== root.version && "shared",
  backendVersion !== root.version && "backend",
  !electronBuilder.includes(`appVersion: ${root.version}`) && "electron-builder"
].filter(Boolean);

if (check) {
  if (mismatches.length) {
    throw new Error(`Versionsabweichung: ${mismatches.join(", ")}`);
  }
  process.stdout.write(`Version konsistent: ${root.version}\n`);
} else {
  desktop.version = root.version;
  shared.version = root.version;
  await writeFile(desktopUrl, `${JSON.stringify(desktop, null, 2)}\n`);
  await writeFile(sharedUrl, `${JSON.stringify(shared, null, 2)}\n`);
  await writeFile(backendUrl, backend.replace(/^version = "[^"]+"/m, `version = "${root.version}"`));
  await writeFile(electronBuilderUrl, electronBuilder.replace(/appVersion: .*$/m, `appVersion: ${root.version}`));
}
