import { backendClient } from "@/services/backendClient";

const TELEMETRY_DIR = ".codee";
const TELEMETRY_FILE = "git-telemetry.json";
const TELEMETRY_VERSION = 1;

export type GitTelemetryEvent =
  | "refresh_status"
  | "select_diff_file"
  | "select_diff_full"
  | "generate_commit_suggestions"
  | "create_commit"
  | "create_restore_point"
  | "restore_from_point"
  | "delete_restore_point"
  | "cleanup_restore_points";

export interface GitTelemetryCounters {
  refreshStatus: number;
  selectDiffFile: number;
  selectDiffFull: number;
  generateCommitSuggestions: number;
  createCommit: number;
  createRestorePoint: number;
  restoreFromPoint: number;
  deleteRestorePoint: number;
  cleanupRestorePoints: number;
}

export interface GitTelemetry {
  version: number;
  workspaceRoot: string;
  counters: GitTelemetryCounters;
  updatedAt: string;
}

const ZERO_COUNTERS: GitTelemetryCounters = {
  refreshStatus: 0,
  selectDiffFile: 0,
  selectDiffFull: 0,
  generateCommitSuggestions: 0,
  createCommit: 0,
  createRestorePoint: 0,
  restoreFromPoint: 0,
  deleteRestorePoint: 0,
  cleanupRestorePoints: 0
};

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+$/g, "").trim();
}

function telemetryPath(workspaceRoot: string): string {
  const normalized = normalizePath(workspaceRoot);
  return `${normalized}/${TELEMETRY_DIR}/${TELEMETRY_FILE}`;
}

function mapEventToCounter(event: GitTelemetryEvent): keyof GitTelemetryCounters {
  switch (event) {
    case "refresh_status":
      return "refreshStatus";
    case "select_diff_file":
      return "selectDiffFile";
    case "select_diff_full":
      return "selectDiffFull";
    case "generate_commit_suggestions":
      return "generateCommitSuggestions";
    case "create_commit":
      return "createCommit";
    case "create_restore_point":
      return "createRestorePoint";
    case "restore_from_point":
      return "restoreFromPoint";
    case "delete_restore_point":
      return "deleteRestorePoint";
    case "cleanup_restore_points":
      return "cleanupRestorePoints";
    default:
      return "refreshStatus";
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toTelemetry(workspaceRoot: string, candidate: unknown): GitTelemetry {
  const normalizedRoot = normalizePath(workspaceRoot);
  if (!candidate || typeof candidate !== "object") {
    return {
      version: TELEMETRY_VERSION,
      workspaceRoot: normalizedRoot,
      counters: { ...ZERO_COUNTERS },
      updatedAt: new Date().toISOString()
    };
  }

  const data = candidate as Partial<GitTelemetry>;
  const counters = (data.counters ?? {}) as Partial<GitTelemetryCounters>;

  return {
    version: TELEMETRY_VERSION,
    workspaceRoot: normalizedRoot,
    counters: {
      refreshStatus: Number(counters.refreshStatus ?? 0),
      selectDiffFile: Number(counters.selectDiffFile ?? 0),
      selectDiffFull: Number(counters.selectDiffFull ?? 0),
      generateCommitSuggestions: Number(counters.generateCommitSuggestions ?? 0),
      createCommit: Number(counters.createCommit ?? 0),
      createRestorePoint: Number(counters.createRestorePoint ?? 0),
      restoreFromPoint: Number(counters.restoreFromPoint ?? 0),
      deleteRestorePoint: Number(counters.deleteRestorePoint ?? 0),
      cleanupRestorePoints: Number(counters.cleanupRestorePoints ?? 0)
    },
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString()
  };
}

export class GitTelemetryService {
  async load(workspaceRoot: string): Promise<GitTelemetry> {
    try {
      const file = await backendClient.readProjectFile(telemetryPath(workspaceRoot));
      if (!file?.content) {
        return toTelemetry(workspaceRoot, null);
      }

      return toTelemetry(workspaceRoot, safeParse(file.content));
    } catch {
      return toTelemetry(workspaceRoot, null);
    }
  }

  async increment(workspaceRoot: string, event: GitTelemetryEvent): Promise<GitTelemetry> {
    try {
      const current = await this.load(workspaceRoot);
      const counterKey = mapEventToCounter(event);
      const next: GitTelemetry = {
        ...current,
        counters: {
          ...current.counters,
          [counterKey]: current.counters[counterKey] + 1
        },
        updatedAt: new Date().toISOString()
      };

      await backendClient.writeProjectFile(telemetryPath(workspaceRoot), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    } catch {
      return toTelemetry(workspaceRoot, null);
    }
  }
}

export const gitTelemetryService = new GitTelemetryService();
