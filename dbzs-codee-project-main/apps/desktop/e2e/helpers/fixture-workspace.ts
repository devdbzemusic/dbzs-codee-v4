import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface FixtureFileRecord {
  relativePath: string;
  content: string;
  language: string;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".md": "markdown"
};

export function resolveFixtureRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "../../fixtures/coding-assistant-workspace"),
    path.resolve(process.cwd(), "fixtures/coding-assistant-workspace"),
    path.resolve(process.cwd(), "../fixtures/coding-assistant-workspace")
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error("Fixture workspace not found.");
}

function walk(root: string, relativeDir = ""): string[] {
  const dir = path.join(root, relativeDir);
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...walk(root, rel));
    } else {
      files.push(rel.replace(/\\/g, "/"));
    }
  }

  return files.sort();
}

export function loadFixtureRecords(root = resolveFixtureRoot()): {
  root: string;
  name: string;
  files: FixtureFileRecord[];
} {
  const name = path.basename(root);
  const files = walk(root).map((relativePath) => {
    const absolute = path.join(root, relativePath);
    const ext = path.extname(relativePath).toLowerCase();
    return {
      relativePath,
      content: readFileSync(absolute, "utf8"),
      language: LANGUAGE_BY_EXT[ext] ?? "plaintext"
    };
  });

  return { root: root.replace(/\\/g, "/"), name, files };
}

export function toProjectFiles(root: string, records: FixtureFileRecord[]) {
  return records.map((file) => ({
    path: `${root}/${file.relativePath}`,
    relativePath: file.relativePath,
    name: path.basename(file.relativePath),
    language: file.language
  }));
}
