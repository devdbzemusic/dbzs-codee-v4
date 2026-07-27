import ts from "typescript";
import {
  isContextPathAllowed,
  normalizeWorkspacePath,
  type IndexedFile,
  type IndexedSymbol,
  type IndexedSymbolType,
  type SearchResult,
  type WorkspaceProjectFile
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

interface CodeIndexDocument {
  schemaVersion: 1;
  workspaceRoot: string;
  files: IndexedFile[];
  updatedAt: string;
}

const INDEX_DIR = ".codee";
const INDEX_FILE = "code-index.json";

function normalizePath(pathValue: string): string {
  return normalizeWorkspacePath(pathValue);
}

function joinPath(base: string, relative: string): string {
  const trimmedBase = base.replace(/[\\/]+$/, "");
  return `${trimmedBase}/${relative}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isAnalyzableFile(file: WorkspaceProjectFile): boolean {
  return isContextPathAllowed(file.relativePath) && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.relativePath);
}

function isValidIndexedFile(value: unknown): value is IndexedFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const file = value as Partial<IndexedFile>;
  const path = typeof file.path === "string" ? normalizePath(file.path) : "";
  return Boolean(path) &&
    !/^[a-z]:\//i.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").includes("..") &&
    isContextPathAllowed(path) &&
    typeof file.language === "string" &&
    typeof file.updatedAt === "string" &&
    Array.isArray(file.exports) &&
    Array.isArray(file.imports) &&
    Array.isArray(file.symbols);
}

function lineFromPos(source: ts.SourceFile, pos: number): number {
  return source.getLineAndCharacterOfPosition(pos).line + 1;
}

function isReactComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]+$/.test(name);
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

function isServiceName(name: string): boolean {
  return /Service$/.test(name);
}

function classifyFunction(name: string): IndexedSymbolType {
  if (isHookName(name)) {
    return "hook";
  }
  if (isReactComponentName(name)) {
    return "component";
  }
  if (isServiceName(name)) {
    return "service";
  }
  return "function";
}

function addSymbol(symbols: IndexedSymbol[], symbol: IndexedSymbol): void {
  if (symbols.some((entry) => entry.name === symbol.name && entry.type === symbol.type && entry.line === symbol.line)) {
    return;
  }
  symbols.push(symbol);
}

function extractImports(source: ts.SourceFile): string[] {
  const imports: string[] = [];
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
  });

  return unique(imports);
}

function extractExports(source: ts.SourceFile): string[] {
  const exports: string[] = [];

  const hasExportModifier = (node: ts.Node): boolean => {
    if (!ts.canHaveModifiers(node)) {
      return false;
    }

    const modifiers = ts.getModifiers(node);
    return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  };

  source.forEachChild((node) => {
    if (ts.isExportAssignment(node)) {
      exports.push("default");
      return;
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exports.push(element.name.text);
      }
      return;
    }

    if (!hasExportModifier(node)) {
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      exports.push(node.name.text);
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      exports.push(node.name.text);
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      exports.push(node.name.text);
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      exports.push(node.name.text);
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.push(declaration.name.text);
        }
      }
    }
  });

  return unique(exports);
}

function extractSymbols(source: ts.SourceFile): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(symbols, {
        name: node.name.text,
        type: classifyFunction(node.name.text),
        line: lineFromPos(source, node.getStart(source))
      });
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            addSymbol(symbols, {
              name,
              type: classifyFunction(name),
              line: lineFromPos(source, declaration.getStart(source))
            });
            continue;
          }

          if (isReactComponentName(name)) {
            addSymbol(symbols, {
              name,
              type: "component",
              line: lineFromPos(source, declaration.getStart(source))
            });
          }
        }
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      addSymbol(symbols, {
        name: node.name.text,
        type: isServiceName(node.name.text) ? "service" : "class",
        line: lineFromPos(source, node.getStart(source))
      });
    }

    if (ts.isInterfaceDeclaration(node)) {
      addSymbol(symbols, {
        name: node.name.text,
        type: "interface",
        line: lineFromPos(source, node.getStart(source))
      });
    }

    if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(symbols, {
        name: node.name.text,
        type: "type",
        line: lineFromPos(source, node.getStart(source))
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return symbols;
}

function tokenizeQuery(query: string): string[] {
  return unique(
    query
      .toLowerCase()
      .split(/[^a-z0-9_@/.-]+/i)
      .map((value) => value.trim())
      .filter((value) => value.length >= 2)
  );
}

function scoreFile(indexedFile: IndexedFile, tokens: string[]): SearchResult | null {
  const path = indexedFile.path.toLowerCase();
  const matchedSymbols: string[] = [];
  let score = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    if (path.includes(token)) {
      score += 5;
      reasons.push(`Dateiname/Pfad matcht '${token}'`);
    }

    const importMatches = indexedFile.imports.filter((entry) => entry.toLowerCase().includes(token));
    if (importMatches.length > 0) {
      score += importMatches.length * 3;
      reasons.push(`Import-Match fuer '${token}'`);
    }

    const exportMatches = indexedFile.exports.filter((entry) => entry.toLowerCase().includes(token));
    if (exportMatches.length > 0) {
      score += exportMatches.length * 4;
      reasons.push(`Export-Match fuer '${token}'`);
    }

    for (const symbol of indexedFile.symbols) {
      if (symbol.name.toLowerCase().includes(token)) {
        score += 6;
        matchedSymbols.push(symbol.name);
      }
    }
  }

  if (score <= 0) {
    return null;
  }

  return {
    filePath: indexedFile.path,
    reason: unique(reasons).join(" · "),
    matchedSymbols: unique(matchedSymbols),
    score
  };
}

export class CodeIndexService {
  private workspaceRoot: string | null = null;

  private files = new Map<string, IndexedFile>();

  private indexGeneration = 0;

  private getIndexPath(workspaceRoot: string): string {
    return joinPath(normalizePath(workspaceRoot), `${INDEX_DIR}/${INDEX_FILE}`);
  }

  private isCurrentBuild(workspaceRoot: string, generation: number): boolean {
    return this.workspaceRoot === workspaceRoot && this.indexGeneration === generation;
  }

  private async loadPersistedIndex(workspaceRoot: string, generation: number): Promise<Map<string, IndexedFile>> {
    const empty = new Map<string, IndexedFile>();
    const readProjectFile = backendClient.readProjectFile;
    if (!readProjectFile) {
      return empty;
    }

    const file = await readProjectFile(this.getIndexPath(workspaceRoot));
    if (!this.isCurrentBuild(workspaceRoot, generation) || !file?.content) {
      return empty;
    }

    try {
      const parsed = JSON.parse(file.content) as CodeIndexDocument;
      if (
        parsed.schemaVersion !== 1 ||
        normalizePath(parsed.workspaceRoot ?? "") !== workspaceRoot ||
        !Array.isArray(parsed.files)
      ) {
        return empty;
      }

      for (const indexedFile of parsed.files) {
        if (isValidIndexedFile(indexedFile)) {
          empty.set(normalizePath(indexedFile.path), indexedFile);
        }
      }
      return empty;
    } catch {
      return empty;
    }
  }

  private async persistIndex(
    workspaceRoot: string,
    generation: number,
    files: Map<string, IndexedFile>
  ): Promise<void> {
    if (!this.isCurrentBuild(workspaceRoot, generation)) {
      return;
    }

    const writeProjectFile = backendClient.writeProjectFile;
    if (!writeProjectFile) {
      throw new Error("Workspace write bridge ist nicht verfuegbar.");
    }

    const payload: CodeIndexDocument = {
      schemaVersion: 1,
      workspaceRoot,
      files: [...files.values()]
        .filter((file) => isValidIndexedFile(file))
        .sort((left, right) => left.path.localeCompare(right.path)),
      updatedAt: new Date().toISOString()
    };

    await writeProjectFile(this.getIndexPath(workspaceRoot), `${JSON.stringify(payload, null, 2)}\n`);
  }

  private analyzeSource(filePath: string, language: string, content: string): IndexedFile {
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return {
      path: normalizePath(filePath),
      language,
      exports: extractExports(source),
      imports: extractImports(source),
      symbols: extractSymbols(source),
      updatedAt: new Date().toISOString()
    };
  }

  async buildWorkspaceIndex(workspaceRoot: string): Promise<IndexedFile[]> {
    const scanProjectFiles = backendClient.scanProjectFiles;
    const readProjectFile = backendClient.readProjectFile;

    if (!scanProjectFiles || !readProjectFile) {
      throw new Error("Workspace scan/read bridge ist nicht verfuegbar.");
    }

    const nextRoot = normalizePath(workspaceRoot);
    const workspaceChanged = this.workspaceRoot !== nextRoot;
    this.indexGeneration += 1;
    const generation = this.indexGeneration;
    if (workspaceChanged) {
      this.files.clear();
    }
    this.workspaceRoot = nextRoot;

    const persistedFiles = await this.loadPersistedIndex(nextRoot, generation);
    if (!this.isCurrentBuild(nextRoot, generation)) {
      return this.getIndexedFiles();
    }

    const projectFiles = await scanProjectFiles(nextRoot);
    if (!this.isCurrentBuild(nextRoot, generation)) {
      return this.getIndexedFiles();
    }
    const candidates = projectFiles.filter(isAnalyzableFile);
    const nextFiles = new Map<string, IndexedFile>();

    for (const descriptor of candidates) {
      const file = await readProjectFile(descriptor.path);
      if (!this.isCurrentBuild(nextRoot, generation)) {
        return this.getIndexedFiles();
      }
      if (!file) {
        const persisted = persistedFiles.get(normalizePath(descriptor.relativePath));
        if (persisted) {
          nextFiles.set(persisted.path, persisted);
        }
        continue;
      }

      const analyzed = this.analyzeSource(descriptor.relativePath, descriptor.language, file.content);
      nextFiles.set(analyzed.path, analyzed);
    }

    if (!this.isCurrentBuild(nextRoot, generation)) {
      return this.getIndexedFiles();
    }
    this.files = nextFiles;
    await this.persistIndex(nextRoot, generation, nextFiles);
    return this.getIndexedFiles();
  }

  async updateFileIndex(filePath: string): Promise<IndexedFile | null> {
    const readProjectFile = backendClient.readProjectFile;
    if (!readProjectFile) {
      throw new Error("Workspace read bridge ist nicht verfuegbar.");
    }

    const workspaceRoot = this.workspaceRoot;
    const generation = this.indexGeneration;
    if (!workspaceRoot || !isContextPathAllowed(filePath)) {
      return null;
    }
    const file = await readProjectFile(filePath);
    if (
      !this.isCurrentBuild(workspaceRoot, generation) ||
      !file ||
      !isContextPathAllowed(file.path) ||
      !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)
    ) {
      return null;
    }

    const relativePath = normalizePath(file.path).replace(`${workspaceRoot}/`, "");
    if (!isValidIndexedFile({
      ...this.analyzeSource(relativePath, file.language, file.content),
      path: relativePath
    })) {
      return null;
    }
    const analyzed = this.analyzeSource(relativePath, file.language, file.content);
    this.files.set(analyzed.path, analyzed);
    await this.persistIndex(workspaceRoot, generation, this.files);
    return analyzed;
  }

  searchCode(query: string): SearchResult[] {
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];
    for (const file of this.files.values()) {
      const scored = scoreFile(file, tokens);
      if (scored) {
        results.push(scored);
      }
    }

    return results.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
  }

  findSymbol(symbolName: string): SearchResult[] {
    const token = symbolName.trim().toLowerCase();
    if (!token) {
      return [];
    }

    const results: SearchResult[] = [];
    for (const file of this.files.values()) {
      const matches = file.symbols.filter((symbol) => symbol.name.toLowerCase().includes(token));
      if (matches.length === 0) {
        continue;
      }

      results.push({
        filePath: file.path,
        reason: `Symbolsuche fuer '${symbolName}'`,
        matchedSymbols: unique(matches.map((entry) => entry.name)),
        score: matches.length * 10 + (file.exports.some((entry) => entry.toLowerCase().includes(token)) ? 5 : 0)
      });
    }

    return results.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
  }

  findRelatedFiles(filePath: string): SearchResult[] {
    const normalizedPath = normalizePath(filePath);
    const current = this.files.get(normalizedPath);
    if (!current) {
      return [];
    }

    const results: SearchResult[] = [];
    const currentBaseName = current.path.split("/").at(-1)?.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, "") ?? "";
    for (const candidate of this.files.values()) {
      if (candidate.path === current.path) {
        continue;
      }

      let score = 0;
      const reasons: string[] = [];
      const matchedSymbols: string[] = [];

      const sharedImports = candidate.imports.filter((entry) => current.imports.includes(entry));
      if (sharedImports.length > 0) {
        score += sharedImports.length * 4;
        reasons.push("Gemeinsame Imports");
      }

      const candidateImportsCurrent = candidate.imports.filter((entry) => entry.includes(currentBaseName));
      if (candidateImportsCurrent.length > 0) {
        score += 10;
        reasons.push("Direkte Import-Beziehung");
      }

      const symbolNames = current.symbols.map((entry) => entry.name.toLowerCase());
      for (const symbol of candidate.symbols) {
        if (symbolNames.includes(symbol.name.toLowerCase())) {
          score += 3;
          matchedSymbols.push(symbol.name);
        }
      }

      if (score > 0) {
        results.push({
          filePath: candidate.path,
          reason: unique(reasons).join(" · "),
          matchedSymbols: unique(matchedSymbols),
          score
        });
      }
    }

    return results.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
  }

  getIndexedFiles(): IndexedFile[] {
    return [...this.files.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  search(query: string, limit = 5): Array<{
    path: string;
    reasons: string[];
    score: number;
    language?: string;
    contentPreview?: string;
  }> {
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0 || this.files.size === 0) {
      return [];
    }

    const results: Array<{
      path: string;
      reasons: string[];
      score: number;
      language?: string;
      contentPreview?: string;
    }> = [];

    for (const file of this.files.values()) {
      const scored = scoreFile(file, tokens);
      if (scored) {
        results.push({
          path: file.path,
          reasons: scored.reason ? [scored.reason] : [],
          score: scored.score,
          language: file.language,
          contentPreview: (file as { content?: string }).content?.slice(0, 400)
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export const codeIndexService = new CodeIndexService();
