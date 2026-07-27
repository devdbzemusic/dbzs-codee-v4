import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import type { Dirent } from "node:fs";
import {
  DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES,
  isDefaultContextExcluded,
  type ProjectCreationResult,
  type ProjectWorkflow,
  type WorkspaceProjectFile,
  type WorkspaceState
} from "@dbzs/shared";

const IGNORED_DIRECTORIES = new Set([
  ...DEFAULT_CONTEXT_EXCLUDED_DIRECTORIES,
  ".next",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv"
]);

const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  projectPath: null,
  projectName: null,
  lastOpenedAt: null,
  maxFileScanCount: 2500
};

export function toResolvedPath(inputPath: string): string {
  return path.resolve(inputPath);
}

export function normalizeProjectWorkflow(input: string | null | undefined): ProjectWorkflow {
  const value = (input ?? "").trim().toLowerCase();
  if (["", "ts", "typescript", "dbzs", "dbzs-typescript"].includes(value)) {
    return "dbzs-typescript";
  }
  if (["py", "python", "runtime", "python-runtime"].includes(value)) {
    return "python-runtime";
  }
  if (["empty", "leer", "minimal", "blank"].includes(value)) {
    return "empty";
  }
  throw new Error("Unknown project workflow. Use dbzs-typescript, python-runtime, or empty.");
}

function sanitizeProjectFolderName(projectName: string): string {
  const trimmed = projectName.trim();
  if (!trimmed) {
    throw new Error("Project name is required.");
  }

  const sanitized = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/[.\s-]+$/, "");

  if (!sanitized) {
    throw new Error("Project name does not produce a valid folder name.");
  }

  return sanitized;
}

function isWindowsLikePath(targetPath: string): boolean {
  // `path.win32.isAbsolute("/tmp")` ist ebenfalls true. Auf Linux wuerde
  // dadurch ein nativer POSIX-Pfad faelschlich mit Win32-Semantik aufgeloest.
  return targetPath.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(targetPath);
}

function resolveWorkspacePath(workspaceRoot: string, candidatePath: string): {
  pathModule: typeof path.posix | typeof path.win32;
  resolvedRoot: string;
  resolvedCandidate: string;
} {
  const usesWindowsPaths = isWindowsLikePath(workspaceRoot) || isWindowsLikePath(candidatePath);
  const pathModule = usesWindowsPaths ? path.win32 : path.posix;
  const resolvedRoot = pathModule.normalize(pathModule.resolve(workspaceRoot));
  const resolvedCandidate = pathModule.isAbsolute(candidatePath)
    ? pathModule.normalize(pathModule.resolve(candidatePath))
    : pathModule.normalize(pathModule.resolve(resolvedRoot, candidatePath));
  return { pathModule, resolvedRoot, resolvedCandidate };
}

function isPathInsideWorkspace(root: string, candidate: string, pathModule: typeof path.posix | typeof path.win32): boolean {
  const normalizedRoot = pathModule.normalize(root);
  const normalizedCandidate = pathModule.normalize(candidate);
  const relative = pathModule.relative(normalizedRoot, normalizedCandidate);
  if (relative === "") {
    return true;
  }
  if (relative === ".." || relative.startsWith(".." + pathModule.sep) || pathModule.isAbsolute(relative)) {
    return false;
  }
  const segments = relative.split(pathModule.sep).filter(Boolean);
  return !segments.some((segment) => segment === "..");
}

function canonicalizeExistingPath(targetPath: string): string | null {
  try {
    return realpathSync.native(targetPath);
  } catch {
    return null;
  }
}

export function ensurePathInsideWorkspace(workspaceRoot: string, candidatePath: string): string {
  const { pathModule, resolvedRoot, resolvedCandidate } = resolveWorkspacePath(workspaceRoot, candidatePath);
  if (!isPathInsideWorkspace(resolvedRoot, resolvedCandidate, pathModule)) {
    throw new Error("Path is outside of current workspace.");
  }

  const canCanonicalize = process.platform === "win32" ? pathModule === path.win32 : pathModule === path.posix;
  if (!canCanonicalize) {
    return resolvedCandidate;
  }
  const canonicalRoot = canonicalizeExistingPath(resolvedRoot);
  if (!canonicalRoot) {
    return resolvedCandidate;
  }
  const canonicalCandidate = canonicalizeExistingPath(resolvedCandidate);
  if (canonicalCandidate && !isPathInsideWorkspace(canonicalRoot, canonicalCandidate, pathModule)) {
    throw new Error("Path is outside of current workspace.");
  }
  if (!canonicalCandidate) {
    let existingParent = pathModule.dirname(resolvedCandidate);
    while (existingParent !== pathModule.dirname(existingParent) && !canonicalizeExistingPath(existingParent)) {
      existingParent = pathModule.dirname(existingParent);
    }
    const canonicalParent = canonicalizeExistingPath(existingParent);
    if (canonicalParent && !isPathInsideWorkspace(canonicalRoot, canonicalParent, pathModule)) {
      throw new Error("Path is outside of current workspace.");
    }
  }

  return resolvedCandidate;
}

export function normalizeContextPathsForActiveWorkspace(
  activeWorkspaceRoot: string | null,
  requestedWorkspaceRoot: string,
  candidates: string[]
): string[] {
  if (!activeWorkspaceRoot) {
    throw new Error("No active workspace configured.");
  }

  const activeRoot = toResolvedPath(activeWorkspaceRoot);
  const requestedRoot = toResolvedPath(requestedWorkspaceRoot);
  if (requestedRoot !== activeRoot) {
    throw new Error("[WORKSPACE_INVALID] Context path normalization outside active workspace is blocked.");
  }

  return candidates.map((candidate) => {
    const normalizedCandidate = candidate.replace(/\\/g, path.sep);
    const safe = ensurePathInsideWorkspace(activeRoot, normalizedCandidate);
    return path.relative(activeRoot, safe).replace(/\\/g, "/");
  });
}

function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".css": "css",
    ".html": "html",
    ".js": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".py": "python",
    ".tsx": "typescript",
    ".ts": "typescript",
    ".toml": "ini",
    ".yaml": "yaml",
    ".yml": "yaml"
  };

  return map[extension] ?? "plaintext";
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function readDirectorySafe(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[workspace] Skip unreadable directory: ${directoryPath} (${message})`);
    return [];
  }
}

async function isWorkspaceDirectory(root: string): Promise<boolean> {
  try {
    const stats = await fs.stat(root);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureEmptyOrMissingDirectory(targetPath: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    return;
  }

  const stats = await fs.stat(targetPath);
  if (!stats.isDirectory()) {
    throw new Error(`Project target exists and is not a directory: ${targetPath}`);
  }

  const entries = await fs.readdir(targetPath);
  if (entries.length > 0) {
    throw new Error(`Project target is not empty: ${targetPath}`);
  }
}

async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
  createdFiles: string[]
): Promise<void> {
  const targetPath = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf-8");
  createdFiles.push(normalizeRelativePath(relativePath));
}

function commonProjectFiles(projectName: string, workflow: ProjectWorkflow): Array<[string, string]> {
  const now = new Date().toISOString();
  return [
    [
      ".codee/project.json",
      `${JSON.stringify(
        {
          schemaVersion: 1,
          name: projectName,
          workflow,
          createdAt: now,
          source: "dbzs-codee-desktop"
        },
        null,
        2
      )}\n`
    ],
    [
      "README.md",
      `# ${projectName}\n\nDBZS-Projekt, erstellt mit dem Workflow \`${workflow}\`.\n\n## Start\n\n- Architektur in \`docs/ARCHITECTURE.md\` pflegen.\n- Aufgaben in \`TODO.md\` klein und pruefbar halten.\n- Secrets niemals committen.\n`
    ],
    [
      "AGENTS.md",
      `# Projekt-Agentenregeln\n\n- Aendere nur Dateien innerhalb dieses Projektordners.\n- Halte Module klein, testbar und klar getrennt.\n- Dokumentiere relevante Architekturentscheidungen in \`docs/\`.\n- Verwende Platzhalter fuer Secrets, keine echten Tokens.\n`
    ],
    [
      "docs/ARCHITECTURE.md",
      `# Architektur\n\n## Zweck\n\nDieses Projekt ist ein DBZS-kompatibler Workspace.\n\n## Module\n\n- \`.codee/\`: Projektmetadaten fuer Codee.\n- \`docs/\`: Architektur und Betriebsnotizen.\n\n## Entscheidungen\n\n- Initialer Workflow: \`${workflow}\`.\n`
    ],
    [
      "TODO.md",
      `# TODO\n\n- [ ] Projektziel konkretisieren\n- [ ] Erste lauffaehige Funktion bauen\n- [ ] Tests/Checks definieren\n`
    ],
    [
      ".gitignore",
      `node_modules/\ndist/\nbuild/\ncoverage/\n.env\n.env.*\n.venv/\nvenv/\n__pycache__/\n.pytest_cache/\n.DS_Store\n`
    ]
  ];
}

function workflowFiles(projectName: string, workflow: ProjectWorkflow): Array<[string, string]> {
  if (workflow === "empty") {
    return [[".codee/README.md", "# Codee\n\nProjektmetadaten und lokale Agent-Konfiguration.\n"]];
  }

  if (workflow === "python-runtime") {
    return [
      [
        "pyproject.toml",
        `[project]\nname = "${projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}"\nversion = "0.1.0"\ndescription = "DBZS Python Runtime Projekt"\nrequires-python = ">=3.11"\ndependencies = []\n\n[dependency-groups]\ndev = ["pytest>=8.0.0"]\n`
      ],
      ["app/__init__.py", ""],
      [
        "app/main.py",
        `def main() -> str:\n    return "DBZS ${projectName} bereit"\n\n\nif __name__ == "__main__":\n    print(main())\n`
      ],
      [
        "tests/test_smoke.py",
        `from app.main import main\n\n\ndef test_main_returns_status():\n    assert "${projectName}" in main()\n`
      ]
    ];
  }

  return [
    [
      "package.json",
      `${JSON.stringify(
        {
          name: projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            build: "tsc -p tsconfig.json",
            test: "node --test"
          },
          devDependencies: {
            typescript: "^5.0.0"
          }
        },
        null,
        2
      )}\n`
    ],
    [
      "tsconfig.json",
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            outDir: "dist",
            rootDir: "src"
          },
          include: ["src/**/*.ts"]
        },
        null,
        2
      )}\n`
    ],
    [
      "src/index.ts",
      `export function bootProject(): string {\n  return "DBZS ${projectName} bereit";\n}\n\nconsole.log(bootProject());\n`
    ]
  ];
}

export async function createProjectWorkflow(
  parentDirectory: string,
  projectName: string,
  workflowInput: string | null | undefined
): Promise<ProjectCreationResult> {
  const parentPath = toResolvedPath(parentDirectory);
  const workflow = normalizeProjectWorkflow(workflowInput);
  const folderName = sanitizeProjectFolderName(projectName);
  const projectPath = path.join(parentPath, folderName);

  const parentExists = await isWorkspaceDirectory(parentPath);
  if (!parentExists) {
    throw new Error(`Parent directory does not exist or is not a directory: ${parentPath}`);
  }

  await ensureEmptyOrMissingDirectory(projectPath);
  await fs.mkdir(projectPath, { recursive: true });

  const createdFiles: string[] = [];
  for (const [relativePath, content] of [...commonProjectFiles(projectName.trim(), workflow), ...workflowFiles(projectName.trim(), workflow)]) {
    await writeProjectFile(projectPath, relativePath, content, createdFiles);
  }

  return {
    projectPath,
    projectName: folderName,
    workflow,
    createdFiles
  };
}

export async function scanProjectFiles(
  projectPath: string,
  maxFileCount: number
): Promise<WorkspaceProjectFile[]> {
  const root = toResolvedPath(projectPath);
  const entries: WorkspaceProjectFile[] = [];
  const skippedDirectories: string[] = [];
  const discoveredDirectories = new Set<string>();
  const boundedMaxFileCount = Math.max(0, maxFileCount);

  const exists = await isWorkspaceDirectory(root);
  if (!exists) {
    console.warn(`[workspace] Scan aborted. Workspace root does not exist or is not a directory: ${root}`);
    throw new Error(`Workspace path does not exist or is not a directory: ${root}`);
  }

  async function walk(currentPath: string): Promise<void> {
    if (entries.length >= boundedMaxFileCount) {
      return;
    }

    const dirEntries = await readDirectorySafe(currentPath);
    for (const dirEntry of dirEntries) {
      if (entries.length >= boundedMaxFileCount) {
        return;
      }

      const nextPath = path.join(currentPath, dirEntry.name);
      const relativePath = normalizeRelativePath(path.relative(root, nextPath));

      if (dirEntry.isSymbolicLink()) {
        skippedDirectories.push(relativePath || dirEntry.name);
        continue;
      }

      if (dirEntry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(dirEntry.name.toLowerCase()) || isDefaultContextExcluded(relativePath)) {
          skippedDirectories.push(relativePath || dirEntry.name);
          continue;
        }

        discoveredDirectories.add(relativePath || dirEntry.name);
        await walk(nextPath);
        continue;
      }

      if (!dirEntry.isFile()) {
        continue;
      }

      const resolved = toResolvedPath(nextPath);
      entries.push({
        path: resolved,
        relativePath,
        name: path.basename(resolved),
        language: detectLanguage(resolved)
      });
    }
  }

  const rootEntries = await readDirectorySafe(root);
  console.info(`[workspace] Scan start`, {
    workspaceRoot: root,
    exists: true,
    isDirectory: true,
    maxFileScanCount: boundedMaxFileCount,
    rootEntryCount: rootEntries.length
  });

  async function walkWithKnownEntries(currentPath: string, dirEntries: Dirent[]): Promise<void> {
    for (const dirEntry of dirEntries) {
      if (entries.length >= boundedMaxFileCount) {
        return;
      }

      const nextPath = path.join(currentPath, dirEntry.name);
      const relativePath = normalizeRelativePath(path.relative(root, nextPath));

      if (dirEntry.isSymbolicLink()) {
        skippedDirectories.push(relativePath || dirEntry.name);
        continue;
      }

      if (dirEntry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(dirEntry.name.toLowerCase()) || isDefaultContextExcluded(relativePath)) {
          skippedDirectories.push(relativePath || dirEntry.name);
          continue;
        }

        discoveredDirectories.add(relativePath || dirEntry.name);
        await walk(nextPath);
        continue;
      }

      if (!dirEntry.isFile()) {
        continue;
      }

      const resolved = toResolvedPath(nextPath);
      entries.push({
        path: resolved,
        relativePath,
        name: path.basename(resolved),
        language: detectLanguage(resolved)
      });
    }
  }

  await walkWithKnownEntries(root, rootEntries);

  const sortedEntries = entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  console.info(`[workspace] Scan done`, {
    workspaceRoot: root,
    foundFiles: sortedEntries.length,
    foundDirectories: discoveredDirectories.size,
    skippedDirectories,
    first20RelativePaths: sortedEntries.slice(0, 20).map((entry) => entry.relativePath)
  });

  return sortedEntries;
}

export async function loadWorkspaceState(stateFilePath: string): Promise<WorkspaceState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf-8");
    const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(normalized) as Partial<WorkspaceState>;
    return {
      projectPath: parsed.projectPath ?? null,
      projectName: parsed.projectName ?? null,
      lastOpenedAt: parsed.lastOpenedAt ?? null,
      maxFileScanCount: parsed.maxFileScanCount ?? DEFAULT_WORKSPACE_STATE.maxFileScanCount
    };
  } catch {
    return DEFAULT_WORKSPACE_STATE;
  }
}

export async function saveWorkspaceState(stateFilePath: string, state: WorkspaceState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf-8");
}

export function workspaceDefaults(): WorkspaceState {
  return { ...DEFAULT_WORKSPACE_STATE };
}
