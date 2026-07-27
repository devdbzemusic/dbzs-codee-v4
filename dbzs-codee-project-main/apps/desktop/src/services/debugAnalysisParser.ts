import type { DebugAnalysis, DebugAnalysisSource } from "@dbzs/shared";

interface DebugAnalysisCandidate {
  source: DebugAnalysisSource;
  summary: string;
  probableCause: string;
  affectedFiles: string[];
  suggestedFixes: string[];
  rawLogs: string;
}

interface MatchedLogLocation {
  filePath: string;
  line: number | null;
  column: number | null;
}

const STACK_FILE_PATTERN = /(?:^|\()(?<file>[^()\s:>]+\.(?:ts|tsx|mts|cts|js|jsx|py|rb|go|java|mjs|cjs)):(?<line>\d+):(?<column>\d+)(?:\)|\s|$)/g;
const TYPESCRIPT_DIAGNOSTIC_PATTERNS = [
  /^(?<file>.+?\.(?:ts|tsx|mts|cts|js|jsx))\((?<line>\d+),(?<column>\d+)\):\s+error\s+(?<code>TS\d+):\s+(?<message>.+)$/,
  /^(?<file>.+?\.(?:ts|tsx|mts|cts|js|jsx)):(?<line>\d+):(?<column>\d+)\s*-\s*error\s+(?<code>TS\d+):\s+(?<message>.+)$/
];
const ESLINT_PATTERN =
  /^(?<file>.+?\.(?:ts|tsx|mts|cts|js|jsx)):(?<line>\d+):(?<column>\d+)\s+error\s+(?<message>.+?)(?:\s+\S+)?$/;
const VITEST_FAILURE_PATTERN = /^(?:FAIL|FAILED)\s+(?<file>.+?\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|py))\b/i;
const PYTEST_FAILURE_PATTERN = /^(?:FAILED|ERROR)\s+(?<file>.+?\.py)(?:::(?<testName>[^\s]+))?/i;
const RUNTIME_MODULE_PATTERN = /Cannot find module ['"](?<module>[^'"]+)['"]/i;
const RUNTIME_UNDEFINED_PATTERNS = [
  /Cannot read (?:properties|property) of undefined/i,
  /undefined is not (?:an object|a function)/i,
  /ReferenceError:/i,
  /TypeError:/i
];

function createAnalysisId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `dbg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toRawExcerpt(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  return lines.slice(start, end).join("\n");
}

function extractFirstStackLocation(rawLogs: string): MatchedLogLocation | null {
  const match = STACK_FILE_PATTERN.exec(rawLogs);
  STACK_FILE_PATTERN.lastIndex = 0;
  if (!match?.groups?.file) {
    return null;
  }

  const line = Number(match.groups.line ?? Number.NaN);
  const column = Number(match.groups.column ?? Number.NaN);
  return {
    filePath: normalizePath(match.groups.file),
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null
  };
}

function buildTypeScriptAnalysis(match: RegExpMatchArray, rawLogs: string): DebugAnalysisCandidate {
  const code = match.groups?.code ?? "TS0000";
  const message = match.groups?.message?.trim() ?? rawLogs.trim();
  const filePath = normalizePath(match.groups?.file ?? "");
  const line = Number(match.groups?.line ?? Number.NaN);
  const column = Number(match.groups?.column ?? Number.NaN);
  const location = Number.isFinite(line)
    ? { filePath, line, column: Number.isFinite(column) ? column : null }
    : null;

  const fixesByCode: Record<string, string[]> = {
    TS2304: ["Fehlenden Namen importieren oder definieren.", "Bezeichner und Datei-Export pruefen."],
    TS2339: ["Property-Namen gegen den echten Typ abgleichen.", "Typ-Definition oder Guard ergaenzen."],
    TS2552: ["Bezeichner auf Tippfehler und Umbenennungen pruefen.", "Fehlenden Import oder Alias korrigieren."],
    TS7006: ["Parameter-Typ explizit annotieren.", "Typ-Signatur der aufrufenden Funktion pruefen."]
  };

  const probableCauseByCode: Record<string, string> = {
    TS2304: "Ein Symbol wird verwendet, das im aktuellen Scope nicht definiert oder importiert ist.",
    TS2339: "Ein Property-Zugriff passt nicht zur aktuellen Typ-Definition.",
    TS2552: "Ein Bezeichner ist nicht bekannt oder wurde umbenannt.",
    TS7006: "Ein Funktionsparameter hat einen impliziten any-Typ."
  };

  const locationSummary = location
    ? `${filePath}:${location.line}${location.column ? `:${location.column}` : ""}`
    : filePath;

  return {
    source: "typecheck",
    summary: `${code} in ${locationSummary}: ${message}`,
    probableCause: probableCauseByCode[code] ?? "TypeScript-Fehler im Typ- oder Scope-Modell.",
    affectedFiles: filePath ? [filePath] : [],
    suggestedFixes: fixesByCode[code] ?? ["Betroffene Stelle mit dem gemeldeten Typfehler abgleichen.", "Minimalen Korrektur-Patch vorbereiten."],
    rawLogs
  };
}

function buildTestAnalysis(rawLine: string, rawLogs: string): DebugAnalysisCandidate | null {
  const vitestMatch = rawLine.match(VITEST_FAILURE_PATTERN);
  const pytestMatch = rawLine.match(PYTEST_FAILURE_PATTERN);
  const stackLocation = extractFirstStackLocation(rawLogs);

  if (!vitestMatch && !pytestMatch && !/AssertionError|expect\(|toBe\(|toEqual\(/i.test(rawLogs)) {
    return null;
  }

  const filePath = vitestMatch?.groups?.file ?? pytestMatch?.groups?.file ?? stackLocation?.filePath ?? "";
  const normalizedFile = normalizePath(filePath);
  const summary = vitestMatch
    ? `Testfehler in ${normalizedFile}`
    : pytestMatch
    ? `Pytest-Failure in ${normalizedFile}`
    : `Assertion-Fehler in ${normalizedFile || "Testlauf"}`;

  return {
    source: "test",
    summary,
    probableCause: "Der erwartete Testzustand weicht vom aktuellen Verhalten oder den Mocks ab.",
    affectedFiles: normalizedFile ? [normalizedFile] : stackLocation?.filePath ? [stackLocation.filePath] : [],
    suggestedFixes: [
      "Assertion und Testdaten gegen den aktuellen Zustand abgleichen.",
      "Mocks, Fixtures oder erwartete Strings an die echte Ausgabe anpassen."
    ],
    rawLogs
  };
}

function buildRuntimeAnalysis(rawLine: string, rawLogs: string): DebugAnalysisCandidate | null {
  const moduleMatch = rawLogs.match(RUNTIME_MODULE_PATTERN);
  const stackLocation = extractFirstStackLocation(rawLogs);

  if (!moduleMatch && !RUNTIME_UNDEFINED_PATTERNS.some((pattern) => pattern.test(rawLogs))) {
    return null;
  }

  if (moduleMatch) {
    return {
      source: "runtime",
      summary: `Runtime-Fehler: Cannot find module '${moduleMatch.groups?.module ?? "unknown"}'`,
      probableCause: "Ein Importpfad, Alias oder eine Dependency ist nicht aufloesbar.",
      affectedFiles: stackLocation?.filePath ? [stackLocation.filePath] : [],
      suggestedFixes: ["Importpfad und Dateiendung pruefen.", "Fehlende Dependency oder Export-Kette korrigieren."],
      rawLogs
    };
  }

  const runtimeSummary = rawLine.trim() || "Runtime-Fehler";
  return {
    source: "runtime",
    summary: runtimeSummary,
    probableCause: "Ein Laufzeitwert ist unerwartet null oder undefined, oder ein synchroner Fehler tritt im Stack auf.",
    affectedFiles: stackLocation?.filePath ? [stackLocation.filePath] : [],
    suggestedFixes: ["Null-/Undefined-Guard einziehen.", "Fehlerpfad und Datenfluss an der gemeldeten Stelle pruefen."],
    rawLogs
  };
}

function buildLintAnalysis(rawLine: string, rawLogs: string): DebugAnalysisCandidate | null {
  const lintMatch = rawLine.match(ESLINT_PATTERN);
  if (!lintMatch) {
    return null;
  }

  const filePath = normalizePath(lintMatch.groups?.file ?? "");
  const message = lintMatch.groups?.message?.trim() ?? rawLine.trim();

  return {
    source: "lint",
    summary: `Lint-Fehler in ${filePath || "unbekannter Datei"}: ${message}`,
    probableCause: "Eine Stil- oder Regelverletzung wird vom Linter beanstandet.",
    affectedFiles: filePath ? [filePath] : [],
    suggestedFixes: ["Regelkonforme Minimalaenderung anwenden.", "Falls noetig, die betroffene Zeile gezielt umschreiben."],
    rawLogs
  };
}

function extractTypeScriptAnalyses(lines: string[]): DebugAnalysisCandidate[] {
  const analyses: DebugAnalysisCandidate[] = [];

  lines.forEach((line, index) => {
    for (const pattern of TYPESCRIPT_DIAGNOSTIC_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        analyses.push(buildTypeScriptAnalysis(match, toRawExcerpt(lines, index)));
      }
    }
  });

  return analyses;
}

function extractLintAnalyses(lines: string[]): DebugAnalysisCandidate[] {
  const analyses: DebugAnalysisCandidate[] = [];

  lines.forEach((line, index) => {
    const lintAnalysis = buildLintAnalysis(line, toRawExcerpt(lines, index));
    if (lintAnalysis) {
      analyses.push(lintAnalysis);
    }
  });

  return analyses;
}

export function parseDebugAnalyses(rawLogs: string): DebugAnalysis[] {
  const normalizedLogs = rawLogs.trim();
  if (!normalizedLogs) {
    return [];
  }

  const lines = normalizedLogs.split(/\r?\n/);
  const typeScriptCandidates = extractTypeScriptAnalyses(lines);
  const lintCandidates = extractLintAnalyses(lines);
  const testCandidate = buildTestAnalysis(lines[0] ?? normalizedLogs, normalizedLogs);
  const runtimeCandidate = buildRuntimeAnalysis(lines[0] ?? normalizedLogs, normalizedLogs);

  const candidates = typeScriptCandidates.length > 0
    ? typeScriptCandidates
    : lintCandidates.length > 0
    ? lintCandidates
    : testCandidate
    ? [testCandidate]
    : runtimeCandidate
    ? [runtimeCandidate]
    : [];

  if (candidates.length === 0) {
    return [];
  }

  const deduped = new Map<string, DebugAnalysisCandidate>();
  for (const candidate of candidates) {
    const signature = `${candidate.source}|${candidate.summary}|${candidate.affectedFiles.join("|")}`;
    if (!deduped.has(signature)) {
      deduped.set(signature, {
        ...candidate,
        affectedFiles: uniqueStrings(candidate.affectedFiles)
      });
    }
  }

  const now = new Date().toISOString();
  return [...deduped.values()].map((candidate) => ({
    id: createAnalysisId(),
    source: candidate.source,
    summary: candidate.summary,
    probableCause: candidate.probableCause,
    affectedFiles: candidate.affectedFiles,
    suggestedFixes: candidate.suggestedFixes,
    rawLogs: candidate.rawLogs,
    createdAt: now
  }));
}