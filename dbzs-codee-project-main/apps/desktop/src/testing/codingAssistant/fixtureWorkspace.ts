import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceFile, WorkspaceProjectFile } from "@dbzs/shared";

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".json": "json",
  ".md": "markdown"
};

function detectLanguage(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

export function resolveFixtureWorkspaceRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../../fixtures/coding-assistant-workspace"),
    path.resolve(process.cwd(), "../../fixtures/coding-assistant-workspace"),
    path.resolve(process.cwd(), "fixtures/coding-assistant-workspace")
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error("coding-assistant-workspace fixture not found.");
}

async function walkFiles(root: string, relativeDir = ""): Promise<string[]> {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      files.push(...(await walkFiles(root, relativePath)));
      continue;
    }
    files.push(relativePath.replace(/\\/g, "/"));
  }

  return files.sort();
}

export async function loadFixtureWorkspaceFiles(root = resolveFixtureWorkspaceRoot()): Promise<{
  root: string;
  name: string;
  projectFiles: WorkspaceProjectFile[];
  fileContents: Map<string, string>;
}> {
  const name = path.basename(root);
  const relativePaths = await walkFiles(root);
  const fileContents = new Map<string, string>();
  const projectFiles: WorkspaceProjectFile[] = [];

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, relativePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    fileContents.set(relativePath, content);
    projectFiles.push({
      path: absolutePath,
      relativePath,
      name: path.basename(relativePath),
      language: detectLanguage(relativePath)
    });
  }

  return { root, name, projectFiles, fileContents };
}

export function toWorkspaceFile(root: string, relativePath: string, content: string): WorkspaceFile {
  const normalized = relativePath.replace(/\\/g, "/");
  return {
    path: path.join(root, normalized),
    name: path.basename(normalized),
    language: detectLanguage(normalized),
    content
  };
}

export function buildPatchJson(relativePath: string, proposedContent: string, reason?: string): string {
  return JSON.stringify({
    changes: [
      {
        filePath: relativePath,
        proposedContent,
        reason: reason ?? "Test patch"
      }
    ]
  });
}

export const FIXTURE_CALCULATOR_PATH = "src/calculator.ts";
export const FIXTURE_GREET_PATH = "src/greet.ts";

export function fixedSubtractContent(): string {
  return `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}
`;
}

export function multiplyCalculatorContent(): string {
  return `${fixedSubtractContent().trim()}

export function multiply(a: number, b: number): number {
  return a * b;
}
`;
}

export function refactorGreetContent(): string {
  return `const DEFAULT_GREETING = "Hello, stranger!";

export function greet(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return DEFAULT_GREETING;
  }
  return \`Hello, \${trimmed}!\`;
}
`;
}

export const FIXTURE_CALCULATOR_TEST_PATH = "src/calculator.test.ts";

export function multiplyTestFileContent(): string {
  return `import { describe, expect, it } from "vitest";
import { add, divide, multiply, subtract } from "./calculator";

describe("calculator", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("subtracts numbers", () => {
    expect(subtract(5, 3)).toBe(2);
  });

  it("multiplies numbers", () => {
    expect(multiply(4, 3)).toBe(12);
  });

  it("divides numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });
});
`;
}

export function buildMultiFilePatchJson(
  changes: Array<{ filePath: string; proposedContent: string; reason?: string }>
): string {
  return JSON.stringify({ changes });
}

export function buildFixAndTestPatchJson(): string {
  return buildMultiFilePatchJson([
    {
      filePath: FIXTURE_CALCULATOR_PATH,
      proposedContent: multiplyCalculatorContent(),
      reason: "Fix subtract and add multiply"
    },
    {
      filePath: FIXTURE_CALCULATOR_TEST_PATH,
      proposedContent: multiplyTestFileContent(),
      reason: "Add multiply test coverage"
    }
  ]);
}
