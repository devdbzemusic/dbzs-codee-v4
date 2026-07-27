import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function fixtureRoot() {
  return mkdtemp(path.join(os.tmpdir(), "dbzs-sync-version-"));
}

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

test("sync-version updates root, desktop, shared, backend, and electron-builder metadata", async () => {
  const root = await fixtureRoot();
  try {
    await writeFixture(root, {
      "package.json": JSON.stringify({ name: "root", version: "0.4.0-rc.1" }, null, 2),
      "apps/desktop/package.json": JSON.stringify({ name: "desktop", version: "0.3.0" }, null, 2),
      "packages/shared/package.json": JSON.stringify({ name: "shared", version: "0.3.0" }, null, 2),
      "backend/pyproject.toml": '[project]\nname = "backend"\nversion = "0.3.0"\n',
      "apps/desktop/electron-builder.yml": "appId: demo\nproductName: Demo\nappVersion: 0.3.0\n"
    });

    await execFileAsync(process.execPath, ["scripts/sync-version.mjs", "--root", root], {
      cwd: path.resolve(".")
    });

    const desktop = JSON.parse(await readFile(path.join(root, "apps/desktop/package.json"), "utf8"));
    const shared = JSON.parse(await readFile(path.join(root, "packages/shared/package.json"), "utf8"));
    const backend = await readFile(path.join(root, "backend/pyproject.toml"), "utf8");
    const builder = await readFile(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");

    assert.equal(desktop.version, "0.4.0-rc.1");
    assert.equal(shared.version, "0.4.0-rc.1");
    assert.match(backend, /version = "0.4.0-rc.1"/);
    assert.match(builder, /appVersion: 0.4.0-rc.1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync-version --check rejects mismatches", async () => {
  const root = await fixtureRoot();
  try {
    await writeFixture(root, {
      "package.json": JSON.stringify({ name: "root", version: "0.4.0-rc.1" }, null, 2),
      "apps/desktop/package.json": JSON.stringify({ name: "desktop", version: "0.3.0" }, null, 2),
      "packages/shared/package.json": JSON.stringify({ name: "shared", version: "0.4.0-rc.1" }, null, 2),
      "backend/pyproject.toml": '[project]\nname = "backend"\nversion = "0.4.0-rc.1"\n',
      "apps/desktop/electron-builder.yml": "appId: demo\nproductName: Demo\nappVersion: 0.4.0-rc.1\n"
    });

    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/sync-version.mjs", "--check", "--root", root], {
        cwd: path.resolve(".")
      }),
      /Versionsabweichung/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
