import type { IndexedFile, IndexedSymbol, ProjectMemory, SearchResult } from "@dbzs/shared";
import type { CodeIndexService } from "@/services/codeIndexService";

export interface RetrievedContext {
  summary: string;
  files: SearchResult[];
  symbols: Array<{ filePath: string; symbol: IndexedSymbol; score: number }>;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_@/.-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function scoreByProjectMemory(result: SearchResult, projectMemory: ProjectMemory | null): number {
  if (!projectMemory) {
    return result.score;
  }

  let nextScore = result.score;
  const pathLower = result.filePath.toLowerCase();

  if (projectMemory.importantFiles.some((entry) => pathLower.includes(entry.path.toLowerCase()))) {
    nextScore += 12;
  }

  for (const issue of projectMemory.knownIssues) {
    const content = `${issue.title} ${issue.description}`.toLowerCase();
    if (tokenize(content).some((token) => pathLower.includes(token))) {
      nextScore += issue.severity === "high" ? 6 : issue.severity === "medium" ? 3 : 1;
    }
  }

  return nextScore;
}

export class ContextRetrievalService {
  constructor(
    private readonly codeIndex: CodeIndexService,
    private readonly projectMemory: ProjectMemory | null = null
  ) {}

  getRelevantContext(goal: string): RetrievedContext {
    const files = this.getRelevantFiles(goal);
    const symbols = this.getRelevantSymbols(goal);
    const summary = [
      `Context fuer Ziel: ${goal}`,
      `Dateien: ${files.length}`,
      `Symbole: ${symbols.length}`,
      this.projectMemory ? `Frameworks: ${this.projectMemory.frameworks.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      summary,
      files,
      symbols
    };
  }

  getRelevantFiles(goal: string): SearchResult[] {
    const raw = this.codeIndex.searchCode(goal);
    return this.rankSearchResults(raw).slice(0, 20);
  }

  getRelevantSymbols(goal: string): Array<{ filePath: string; symbol: IndexedSymbol; score: number }> {
    const tokenSet = new Set(tokenize(goal));
    const result: Array<{ filePath: string; symbol: IndexedSymbol; score: number }> = [];

    for (const file of this.codeIndex.getIndexedFiles()) {
      for (const symbol of file.symbols) {
        const symbolToken = symbol.name.toLowerCase();
        let score = 0;

        for (const token of tokenSet) {
          if (symbolToken.includes(token)) {
            score += 8;
          }
        }

        if (score <= 0) {
          continue;
        }

        if (this.projectMemory?.importantFiles.some((entry) => file.path.includes(entry.path))) {
          score += 4;
        }

        result.push({ filePath: file.path, symbol, score });
      }
    }

    return result.sort((left, right) => right.score - left.score).slice(0, 30);
  }

  rankSearchResults(results: SearchResult[]): SearchResult[] {
    const reranked = results.map((result) => ({
      ...result,
      score: scoreByProjectMemory(result, this.projectMemory)
    }));

    return reranked.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
  }

  getRecentChanges(indexedFiles: IndexedFile[]): IndexedFile[] {
    return indexedFiles
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20);
  }

  findRelated(goalOrPath: string): SearchResult[] {
    const indexedPath = this.codeIndex
      .getIndexedFiles()
      .find((file) => file.path === goalOrPath || file.path.endsWith(goalOrPath))?.path;

    if (indexedPath) {
      return this.codeIndex.findRelatedFiles(indexedPath);
    }

    const relevant = this.getRelevantFiles(goalOrPath);
    const files = unique(relevant.map((entry) => entry.filePath));
    if (files.length === 0) {
      return [];
    }

    return this.codeIndex.findRelatedFiles(files[0] ?? "");
  }
}
