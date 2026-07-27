import type {
  MemoryTask,
  ProjectMemory,
  ProposedChange,
  WorkspaceProjectFile
} from "@dbzs/shared";

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv"
]);

export interface AgentContextPayload {
  agentId: string;
  projectSummary: string;
  frameworks: string[];
  languages: string[];
  knownIssues: ProjectMemory["knownIssues"];
  relevantFiles: string[];
  recentTasks: MemoryTask[];
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function fileScore(pathValue: string, tokens: string[], memory: ProjectMemory): number {
  const normalized = normalizePath(pathValue).toLowerCase();
  const segments = normalized.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return -1000;
  }

  let score = 0;
  if (/apps\/desktop\/src\//.test(normalized)) {
    score += 2;
  }
  if (/packages\/shared\//.test(normalized)) {
    score += 2;
  }
  if (/backend\//.test(normalized)) {
    score += 1;
  }

  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += 3;
    }
  }

  for (const file of memory.importantFiles) {
    const important = normalizePath(file.path).toLowerCase();
    if (important === normalized || normalized.endsWith(important)) {
      score += 6;
    }
  }

  for (const issue of memory.knownIssues) {
    const issueTokens = tokenize(`${issue.title} ${issue.description}`);
    if (issueTokens.some((token) => normalized.includes(token))) {
      score += issue.severity === "high" ? 5 : issue.severity === "medium" ? 3 : 1;
    }
  }

  return score;
}

export class ContextEngineService {
  constructor(
    private readonly memory: ProjectMemory,
    private readonly workspaceFiles: WorkspaceProjectFile[],
    private readonly recentChanges: ProposedChange[] = []
  ) {}

  buildAgentContext(agentId: string): AgentContextPayload {
    const targetGoalByAgent: Record<string, string> = {
      planner: "architecture plan task sequence",
      coder: "implementation service component store",
      tester: "test vitest pytest regression",
      debugger: "error runtime logs test failure",
      reviewer: "review quality risk security",
      docs: "docs readme architecture overview"
    };

    const relevantFiles = this.getRelevantFiles(targetGoalByAgent[agentId] ?? "project context");
    return {
      agentId,
      projectSummary: this.summarizeProject(),
      frameworks: this.memory.frameworks,
      languages: this.memory.languages,
      knownIssues: this.memory.knownIssues,
      relevantFiles,
      recentTasks: this.memory.recentTasks.slice(0, 5)
    };
  }

  getRelevantFiles(goal: string): string[] {
    const tokens = tokenize(goal);
    const sorted = this.workspaceFiles
      .map((file) => ({
        path: normalizePath(file.relativePath),
        score: fileScore(file.relativePath, tokens, this.memory)
      }))
      .filter((entry) => entry.score > -999)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

    const selected = sorted.slice(0, 20).map((entry) => entry.path);
    return unique(selected);
  }

  summarizeProject(): string {
    const parts = [
      `Projekt: ${this.memory.projectName}`,
      `Frameworks: ${this.memory.frameworks.join(", ") || "unbekannt"}`,
      `Sprachen: ${this.memory.languages.join(", ") || "unbekannt"}`,
      `Wichtige Dateien: ${this.memory.importantFiles.length}`,
      `Bekannte Issues: ${this.memory.knownIssues.length}`
    ];
    return parts.join(" | ");
  }

  getRecentChanges(): Array<{ id: string; filePath: string; reason: string; createdAt: string }> {
    if (this.recentChanges.length > 0) {
      return this.recentChanges
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 10)
        .map((entry) => ({
          id: entry.id,
          filePath: entry.filePath,
          reason: entry.reason,
          createdAt: entry.createdAt
        }));
    }

    return this.memory.recentTasks.slice(0, 10).map((task) => ({
      id: task.id,
      filePath: task.affectedFiles[0] ?? "",
      reason: task.summary,
      createdAt: task.createdAt
    }));
  }
}
