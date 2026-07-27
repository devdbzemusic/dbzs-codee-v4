import type { ProposedChange } from "@dbzs/shared";

interface ParsedAgentChangeInput {
  filePath?: unknown;
  proposedContent?: unknown;
  reason?: unknown;
}

interface ParsedAgentPayload {
  changes?: unknown;
}

export class AgentOutputParseError extends Error {
  readonly code:
    | "INVALID_JSON"
    | "EMPTY_CHANGES"
    | "MISSING_FILE_PATH"
    | "MISSING_PROPOSED_CONTENT"
    | "OUTSIDE_WORKSPACE";

  constructor(
    code:
      | "INVALID_JSON"
      | "EMPTY_CHANGES"
      | "MISSING_FILE_PATH"
      | "MISSING_PROPOSED_CONTENT"
      | "OUTSIDE_WORKSPACE",
    message: string
  ) {
    super(message);
    this.name = "AgentOutputParseError";
    this.code = code;
  }
}

export interface ParseAgentOutputOptions {
  agentId: string;
  workspaceRoot: string;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function splitRootAndSegments(pathValue: string): { rootPrefix: string; segments: string[] } {
  const normalized = normalizePath(pathValue);
  const driveMatch = normalized.match(/^[A-Za-z]:/);
  const rootPrefix = driveMatch ? driveMatch[0] : "";
  const withoutRoot = driveMatch ? normalized.slice(driveMatch[0].length) : normalized;
  const segments = withoutRoot
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

  return { rootPrefix, segments };
}

function resolvePath(pathValue: string, workspaceRoot: string): string | null {
  const rawPath = normalizePath(pathValue);
  const { rootPrefix: workspacePrefix, segments: workspaceSegments } = splitRootAndSegments(workspaceRoot);
  const isAbsolute = /^[A-Za-z]:/.test(rawPath) || rawPath.startsWith("/");

  if (isAbsolute) {
    const { rootPrefix, segments } = splitRootAndSegments(rawPath);
    if (workspacePrefix && rootPrefix && workspacePrefix.toLowerCase() !== rootPrefix.toLowerCase()) {
      return null;
    }

    const safeSegments: string[] = [];
    for (const segment of segments) {
      if (segment === "..") {
        if (safeSegments.length === 0) {
          return null;
        }
        safeSegments.pop();
        continue;
      }
      safeSegments.push(segment);
    }

    if (workspaceSegments.length > safeSegments.length) {
      return null;
    }

    for (let index = 0; index < workspaceSegments.length; index += 1) {
      if (workspaceSegments[index]?.toLowerCase() !== safeSegments[index]?.toLowerCase()) {
        return null;
      }
    }

    return `${workspacePrefix}${safeSegments.length ? `/${safeSegments.join("/")}` : ""}`;
  }

  const relativeSegments = rawPath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

  const mergedSegments = [...workspaceSegments];
  for (const segment of relativeSegments) {
    if (segment === "..") {
      if (mergedSegments.length <= workspaceSegments.length) {
        return null;
      }
      mergedSegments.pop();
      continue;
    }
    mergedSegments.push(segment);
  }

  return `${workspacePrefix}${mergedSegments.length ? `/${mergedSegments.join("/")}` : ""}`;
}

function toAgentChangeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractBalancedJsonObject(raw: string, startIndex: number): string | null {
  const opener = raw[startIndex];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : null;
  if (!closer) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < raw.length; index += 1) {
    const char = raw[index] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opener) {
      depth += 1;
      continue;
    }

    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");
  let startIndex = -1;

  if (objectStart >= 0 && arrayStart >= 0) {
    startIndex = Math.min(objectStart, arrayStart);
  } else {
    startIndex = objectStart >= 0 ? objectStart : arrayStart;
  }

  if (startIndex >= 0) {
    const balanced = extractBalancedJsonObject(raw, startIndex);
    if (balanced) {
      return balanced.trim();
    }
  }

  return raw.trim();
}

function normalizeAgentPayload(parsed: unknown): ParsedAgentPayload {
  if (Array.isArray(parsed)) {
    return { changes: parsed };
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.changes)) {
      return { changes: record.changes };
    }
  }

  return {};
}

export function looksLikeAgentChangePayload(rawOutput: string): boolean {
  try {
    const parsed = normalizeAgentPayload(JSON.parse(extractJson(rawOutput)));
    return Array.isArray(parsed.changes) && parsed.changes.length > 0;
  } catch {
    return false;
  }
}

export function parseAgentOutputToProposedChanges(
  rawOutput: string,
  options: ParseAgentOutputOptions
): ProposedChange[] {
  let parsed: ParsedAgentPayload;
  try {
    parsed = normalizeAgentPayload(JSON.parse(extractJson(rawOutput)));
  } catch {
    throw new AgentOutputParseError("INVALID_JSON", "Agent-Ausgabe ist kein gueltiges JSON.");
  }

  if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) {
    throw new AgentOutputParseError("EMPTY_CHANGES", "Agent-Ausgabe enthaelt keine aenderbaren changes.");
  }

  const now = new Date().toISOString();
  return parsed.changes.map((entry) => {
    const candidate = entry as ParsedAgentChangeInput;
    const candidateFilePath = typeof candidate.filePath === "string" ? candidate.filePath.trim() : "";
    if (!candidateFilePath) {
      throw new AgentOutputParseError("MISSING_FILE_PATH", "Ein Change ohne filePath wurde gefunden.");
    }

    const candidateProposedContent =
      typeof candidate.proposedContent === "string" ? candidate.proposedContent : "";
    if (!candidateProposedContent) {
      throw new AgentOutputParseError(
        "MISSING_PROPOSED_CONTENT",
        "Ein Change ohne proposedContent wurde gefunden."
      );
    }

    const resolvedPath = resolvePath(candidateFilePath, options.workspaceRoot);
    if (!resolvedPath) {
      throw new AgentOutputParseError(
        "OUTSIDE_WORKSPACE",
        `Pfad liegt ausserhalb des Workspace: ${candidateFilePath}`
      );
    }

    const reason =
      typeof candidate.reason === "string" && candidate.reason.trim().length > 0
        ? candidate.reason.trim()
        : "Agent-Vorschlag";

    return {
      id: toAgentChangeId(),
      agentId: options.agentId,
      filePath: resolvedPath,
      proposedContent: candidateProposedContent,
      reason,
      createdAt: now,
      status: "pending"
    } satisfies ProposedChange;
  });
}
