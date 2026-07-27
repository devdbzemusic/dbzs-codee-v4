import type {
  GitDiffSummary,
  GitRepositoryStatus,
  KnownIssue,
  ProposedChange,
  ReviewFinding,
  ReviewFindingCategory,
  ReviewFindingSeverity,
  ReviewReport
} from "@dbzs/shared";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function lineForMatch(source: string, matcher: RegExp): number | undefined {
  const match = source.match(matcher);
  if (!match || match.index === undefined) {
    return undefined;
  }

  return source.slice(0, match.index).split(/\r?\n/).length;
}

function addFinding(
  findings: ReviewFinding[],
  category: ReviewFindingCategory,
  severity: ReviewFindingSeverity,
  title: string,
  description: string,
  options?: {
    filePath?: string;
    line?: number;
    suggestion?: string;
  }
): void {
  findings.push({
    id: createId("finding"),
    severity,
    category,
    title,
    description,
    filePath: options?.filePath,
    line: options?.line,
    suggestion: options?.suggestion
  });
}

function reviewTypeSafety(change: ProposedChange, findings: ReviewFinding[]): void {
  const content = change.proposedContent;
  const anyPattern = /[:<\s]any[>;\s,\)\]\|]/;
  if (anyPattern.test(content)) {
    addFinding(
      findings,
      "types",
      "warning",
      "Explizites any gefunden",
      "Die Aenderung verwendet any und kann TypeScript-Sicherheit reduzieren.",
      {
        filePath: change.filePath,
        line: lineForMatch(content, anyPattern),
        suggestion: "Konkrete Typen oder generische Constraints verwenden."
      }
    );
  }

  const unsafeCastPattern = /as\s+unknown\s+as\s+\w+/;
  if (unsafeCastPattern.test(content)) {
    addFinding(
      findings,
      "types",
      "warning",
      "Unsicherer Double-Cast",
      "Ein Cast ueber unknown kann Typsicherheit umgehen.",
      {
        filePath: change.filePath,
        line: lineForMatch(content, unsafeCastPattern),
        suggestion: "Typen am Ursprung korrigieren statt unsafe casts zu stapeln."
      }
    );
  }

  const nullableAccessPattern = /\w+\.[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*/;
  if (nullableAccessPattern.test(content) && /\bnull\b|\bundefined\b/.test(content) && !/\?\./.test(content)) {
    addFinding(
      findings,
      "types",
      "info",
      "Moeglicher fehlender Null-Check",
      "Im geaenderten Code sind nullable Werte sichtbar, aber es fehlen optionale Zugriffe oder Guards.",
      {
        filePath: change.filePath,
        suggestion: "Optional Chaining oder fruehen Guard fuer null/undefined ergaenzen."
      }
    );
  }
}

function reviewReactStructure(change: ProposedChange, findings: ReviewFinding[]): void {
  const path = normalizePath(change.filePath).toLowerCase();
  const content = change.proposedContent;
  const lines = content.split(/\r?\n/);
  const jsxLineCount = lines.filter((line) => /<\w+/.test(line)).length;
  const hasReactLikeFile = path.endsWith(".tsx") || /react|component/.test(path);

  if (hasReactLikeFile && lines.length > 220) {
    addFinding(
      findings,
      "architecture",
      "warning",
      "Sehr grosse React-Komponente",
      `Die Komponente umfasst ${lines.length} Zeilen und koennte schwer wartbar werden.`,
      {
        filePath: change.filePath,
        suggestion: "In kleinere Subkomponenten und Hooks aufteilen."
      }
    );
  }

  if (hasReactLikeFile && jsxLineCount > 80) {
    addFinding(
      findings,
      "maintainability",
      "info",
      "Viel Logik direkt im JSX",
      "Ein hoher JSX-Anteil deutet auf gemischte Darstellungs- und Logikschichten hin.",
      {
        filePath: change.filePath,
        suggestion: "Berechnungen in Hilfsfunktionen oder Hooks auslagern."
      }
    );
  }

  const statePattern = /useState\(/g;
  const stateCount = (content.match(statePattern) ?? []).length;
  if (hasReactLikeFile && stateCount >= 8) {
    addFinding(
      findings,
      "maintainability",
      "warning",
      "Viele lokale State-Segmente",
      `Es wurden ${stateCount} useState-Aufrufe erkannt; das kann auf ueberladene Komponenten hindeuten.`,
      {
        filePath: change.filePath,
        suggestion: "State konsolidieren oder in spezialisierte Stores/Hooks verschieben."
      }
    );
  }
}

function reviewSecurity(change: ProposedChange, findings: ReviewFinding[]): void {
  const content = change.proposedContent;

  const pathTraversalPattern = /\.\.\//;
  if (pathTraversalPattern.test(content) && /path\.join|resolve|normalize/.test(content)) {
    addFinding(
      findings,
      "security",
      "error",
      "Moeglicher Path Traversal Pfad",
      "Pfadoperationen mit relativen Aufstiegen koennen auf unsichere Zielpfade fuehren.",
      {
        filePath: change.filePath,
        line: lineForMatch(content, pathTraversalPattern),
        suggestion: "Eingabepfade kanonisieren und gegen Workspace-Root validieren."
      }
    );
  }

  const shellPattern = /spawn\([^\)]*\{[^\}]*shell\s*:\s*true|exec\(|terminalExec\(/;
  if (shellPattern.test(content)) {
    addFinding(
      findings,
      "security",
      "error",
      "Unsichere Shell-Nutzung",
      "Direkte Shell-Ausfuehrung erhoeht das Risiko von Command-Injection.",
      {
        filePath: change.filePath,
        line: lineForMatch(content, shellPattern),
        suggestion: "Allowlist-basierte Kommandos und shell=false verwenden."
      }
    );
  }

  const rawFsPattern = /\b(fs\.|readFileSync|writeFileSync|appendFileSync|rmSync)\b/;
  if (rawFsPattern.test(content)) {
    addFinding(
      findings,
      "security",
      "warning",
      "Direkter FS-Zugriff erkannt",
      "Direkte Dateizugriffe sollten hinter validierenden Services gekapselt werden.",
      {
        filePath: change.filePath,
        line: lineForMatch(content, rawFsPattern),
        suggestion: "Bestehende Safe-Editing- oder Workspace-Services verwenden."
      }
    );
  }
}

function reviewMaintainability(change: ProposedChange, findings: ReviewFinding[]): void {
  const content = change.proposedContent;
  const lines = content.split(/\r?\n/);

  const magicNumberPattern = /\b\d{3,}\b/;
  if (magicNumberPattern.test(content)) {
    addFinding(
      findings,
      "maintainability",
      "info",
      "Magic Number erkannt",
      "Numerische Literale ohne Kontext erschweren Wartung.",
      {
        filePath: change.filePath,
        line: lineForMatch(content, magicNumberPattern),
        suggestion: "Konstanten mit sprechendem Namen verwenden."
      }
    );
  }

  const longFunctionMatch = content.match(/function\s+\w+\s*\([^\)]*\)\s*\{([\s\S]{600,})\}/);
  if (longFunctionMatch) {
    addFinding(
      findings,
      "maintainability",
      "warning",
      "Lange Funktion erkannt",
      "Die geaenderte Funktion wirkt sehr umfangreich und schwer testbar.",
      {
        filePath: change.filePath,
        suggestion: "Funktion in kleinere Einheiten mit klarer Verantwortung trennen."
      }
    );
  }

  const duplicates = new Map<string, number>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 24 || line.startsWith("//") || line.startsWith("import ")) {
      continue;
    }
    duplicates.set(line, (duplicates.get(line) ?? 0) + 1);
  }

  const duplicateEntry = [...duplicates.entries()].find(([, count]) => count >= 3);
  if (duplicateEntry) {
    addFinding(
      findings,
      "architecture",
      "warning",
      "Duplicated Logic (basic)",
      `Eine identische Logikzeile wurde mindestens ${duplicateEntry[1]} mal erkannt.`,
      {
        filePath: change.filePath,
        suggestion: "Gemeinsame Logik in Hilfsfunktion oder Service extrahieren."
      }
    );
  }
}

function reviewTestingCoverage(change: ProposedChange, findings: ReviewFinding[]): void {
  const filePath = normalizePath(change.filePath);
  const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(filePath);
  if (!isTestFile && /\/src\//.test(filePath) && !/expect\(|describe\(|it\(/.test(change.proposedContent)) {
    addFinding(
      findings,
      "testing",
      "info",
      "Keine direkte Testaenderung erkennbar",
      "Fuer funktionale Aenderungen sollte geprueft werden, ob passende Tests vorhanden sind.",
      {
        filePath: change.filePath,
        suggestion: "Relevante Testfaelle fuer die Aenderung pruefen oder ergaenzen."
      }
    );
  }
}

function summarizeFindings(findings: ReviewFinding[]): string {
  if (findings.length === 0) {
    return "Keine auffaelligen Risiken gefunden.";
  }

  const errorCount = findings.filter((entry) => entry.severity === "error").length;
  const warningCount = findings.filter((entry) => entry.severity === "warning").length;
  const infoCount = findings.filter((entry) => entry.severity === "info").length;
  return `Review abgeschlossen: ${errorCount} errors, ${warningCount} warnings, ${infoCount} infos.`;
}

function analyzeChanges(changes: ProposedChange[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const change of changes) {
    reviewTypeSafety(change, findings);
    reviewReactStructure(change, findings);
    reviewSecurity(change, findings);
    reviewMaintainability(change, findings);
    reviewTestingCoverage(change, findings);

    if (change.proposedContent.length > 5000) {
      addFinding(
        findings,
        "performance",
        "info",
        "Grosser Patch-Inhalt",
        "Sehr grosse Aenderungen sind schwieriger zu reviewen und koennen Performance-/Regressionseffekte verstecken.",
        {
          filePath: change.filePath,
          suggestion: "Aenderung in kleinere, nachvollziehbare Schritte aufteilen."
        }
      );
    }
  }

  return findings;
}

function toReport(changes: ProposedChange[], findings: ReviewFinding[]): ReviewReport {
  const reviewedFiles = unique(changes.map((change) => change.filePath));
  return {
    id: createId("review"),
    summary: summarizeFindings(findings),
    findings,
    reviewedFiles,
    createdAt: new Date().toISOString()
  };
}

export class ReviewAgentService {
  reviewProposedChanges(changes: ProposedChange[]): ReviewReport {
    const scoped = changes.filter((change) => change.status === "pending" || change.status === "approved" || change.status === "rejected");
    const findings = analyzeChanges(scoped);
    return toReport(scoped, findings);
  }

  reviewAppliedChanges(changes: ProposedChange[]): ReviewReport {
    const scoped = changes.filter((change) => change.status === "applied");
    const findings = analyzeChanges(scoped);
    return toReport(scoped, findings);
  }

  summarizeReview(report: ReviewReport): string {
    return report.summary;
  }

  withKnownIssues(report: ReviewReport, knownIssues: KnownIssue[]): ReviewReport {
    if (knownIssues.length === 0) {
      return report;
    }

    const issueFindings: ReviewFinding[] = knownIssues.map((issue) => ({
      id: createId("finding"),
      severity: issue.severity === "high" ? "warning" : issue.severity === "medium" ? "info" : "info",
      category: "architecture",
      title: `Known Issue: ${issue.title}`,
      description: issue.description,
      suggestion: "Bei dieser Aenderung gegen bekannte Projektprobleme validieren."
    }));

    const nextFindings = [...report.findings, ...issueFindings];
    return {
      ...report,
      findings: nextFindings,
      summary: summarizeFindings(nextFindings)
    };
  }

  withRelevantFiles(report: ReviewReport, relevantFiles: string[]): ReviewReport {
    if (relevantFiles.length === 0) {
      return report;
    }

    return {
      ...report,
      reviewedFiles: unique([...report.reviewedFiles, ...relevantFiles])
    };
  }

  withGitContext(
    report: ReviewReport,
    gitRepositoryStatus?: GitRepositoryStatus | null,
    gitDiffSummary: GitDiffSummary[] = []
  ): ReviewReport {
    if (!gitRepositoryStatus || !gitRepositoryStatus.isRepository) {
      return report;
    }

    const gitFindings: ReviewFinding[] = [];

    if (gitRepositoryStatus.entries.some((entry) => entry.status === "conflicted")) {
      addFinding(
        gitFindings,
        "security",
        "error",
        "Merge-Konflikte erkannt",
        "Das Repository enthaelt Konflikte. Review-Ergebnisse koennen instabil sein, bis die Konflikte aufgeloest sind.",
        {
          suggestion: "Konfliktdateien zuerst aufloesen und danach erneut reviewen."
        }
      );
    }

    if (gitRepositoryStatus.entries.length > 20) {
      addFinding(
        gitFindings,
        "maintainability",
        "warning",
        "Viele uncommitted Aenderungen",
        `Es wurden ${gitRepositoryStatus.entries.length} geaenderte Dateien erkannt; Regressionen sind wahrscheinlicher.`,
        {
          suggestion: "Review in kleinere thematische Commits aufteilen."
        }
      );
    }

    const riskyDiff = gitDiffSummary.find((entry) => entry.additions + entry.deletions >= 300);
    if (riskyDiff) {
      addFinding(
        gitFindings,
        "performance",
        "warning",
        "Sehr grosser Dateidiff",
        `Die Datei ${riskyDiff.filePath} hat einen grossen Diff (${riskyDiff.additions + riskyDiff.deletions} Zeilen).`,
        {
          filePath: riskyDiff.filePath,
          suggestion: "Diff splitten oder zusaetzliche gezielte Tests fuer diesen Bereich ausfuehren."
        }
      );
    }

    if (gitFindings.length === 0) {
      return report;
    }

    const nextFindings = [...report.findings, ...gitFindings];
    return {
      ...report,
      findings: nextFindings,
      reviewedFiles: unique([...report.reviewedFiles, ...gitDiffSummary.map((entry) => entry.filePath)]),
      summary: summarizeFindings(nextFindings)
    };
  }
}