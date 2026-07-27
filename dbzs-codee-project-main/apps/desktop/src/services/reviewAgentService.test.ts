import { describe, expect, it } from "vitest";
import type { GitDiffSummary, GitRepositoryStatus, ProposedChange } from "@dbzs/shared";
import { ReviewAgentService } from "./reviewAgentService";

const service = new ReviewAgentService();

function makeChange(partial: Partial<ProposedChange>): ProposedChange {
  return {
    id: partial.id ?? "c1",
    agentId: partial.agentId ?? "runtime-chat",
    filePath: partial.filePath ?? "apps/desktop/src/App.tsx",
    proposedContent: partial.proposedContent ?? "export const x = 1;",
    reason: partial.reason ?? "test",
    createdAt: partial.createdAt ?? new Date().toISOString(),
    status: partial.status ?? "pending",
    originalContent: partial.originalContent
  };
}

describe("ReviewAgentService", () => {
  it("erkennt any usage", () => {
    const report = service.reviewProposedChanges([
      makeChange({ proposedContent: "const value: any = input;" })
    ]);

    expect(report.findings.some((finding) => finding.category === "types" && finding.title.includes("any"))).toBe(true);
  });

  it("erkennt grosse React-Komponente", () => {
    const hugeLines = Array.from({ length: 260 }, (_, index) => `  <div>${index}</div>`).join("\n");
    const report = service.reviewProposedChanges([
      makeChange({
        filePath: "apps/desktop/src/components/HugePanel.tsx",
        proposedContent: `export function HugePanel() {\nreturn (\n${hugeLines}\n);\n}`
      })
    ]);

    expect(report.findings.some((finding) => finding.category === "architecture" && finding.title.includes("React-Komponente"))).toBe(true);
  });

  it("erkennt unsafe path usage", () => {
    const report = service.reviewProposedChanges([
      makeChange({
        filePath: "apps/desktop/electron/security.ts",
        proposedContent: "const target = path.join(rootPath, '../secret');"
      })
    ]);

    expect(report.findings.some((finding) => finding.category === "security" && finding.severity === "error")).toBe(true);
  });

  it("erkennt duplicated logic basic", () => {
    const repeated = [
      "const normalized = input.trim().toLowerCase();",
      "const normalized = input.trim().toLowerCase();",
      "const normalized = input.trim().toLowerCase();"
    ].join("\n");

    const report = service.reviewProposedChanges([
      makeChange({ proposedContent: repeated })
    ]);

    expect(report.findings.some((finding) => finding.title.includes("Duplicated Logic"))).toBe(true);
  });

  it("klassifiziert Severity korrekt", () => {
    const report = service.reviewProposedChanges([
      makeChange({
        filePath: "apps/desktop/electron/main.ts",
        proposedContent: "exec(command)"
      })
    ]);

    expect(report.findings.some((finding) => finding.severity === "error")).toBe(true);
  });

  it("liefert leeres Review ohne Findings", () => {
    const report = service.reviewAppliedChanges([
      makeChange({
        status: "applied",
        filePath: "apps/desktop/tests/reviewSafe.test.ts",
        proposedContent: "describe('safe', () => { it('works', () => { expect(true).toBe(true); }); });"
      })
    ]);

    expect(report.reviewedFiles.length).toBe(1);
    expect(report.findings).toHaveLength(0);
    expect(service.summarizeReview(report)).toContain("Keine auffaelligen Risiken");
  });

  it("laesst report unveraendert wenn git-kontext fehlt oder kein repository", () => {
    const base = service.reviewProposedChanges([
      makeChange({ proposedContent: "export const stable = true;" })
    ]);

    const withoutGit = service.withGitContext(base, undefined, []);
    const noRepoStatus: GitRepositoryStatus = {
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      isRepository: false,
      hasUncommittedChanges: false,
      entries: [],
      updatedAt: new Date().toISOString()
    };
    const withNoRepo = service.withGitContext(base, noRepoStatus, []);

    expect(withoutGit.findings).toEqual(base.findings);
    expect(withoutGit.summary).toBe(base.summary);
    expect(withNoRepo.findings).toEqual(base.findings);
    expect(withNoRepo.summary).toBe(base.summary);
  });

  it("fuegt findings fuer konflikte, viele aenderungen und grossen diff hinzu", () => {
    const base = service.reviewProposedChanges([
      makeChange({ proposedContent: "export const stable = true;" })
    ]);

    const gitRepositoryStatus: GitRepositoryStatus = {
      workspaceRoot: "D:/Dev/repo/dbzs-codee",
      isRepository: true,
      currentBranch: "feature/risky-review",
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 1,
      hasUncommittedChanges: true,
      entries: [
        { filePath: "apps/desktop/src/components/Conflict.tsx", status: "conflicted" },
        ...Array.from({ length: 21 }, (_, index) => ({
          filePath: `apps/desktop/src/components/File${index}.tsx`,
          status: "modified" as const
        }))
      ],
      updatedAt: new Date().toISOString()
    };
    const gitDiffSummary: GitDiffSummary[] = [
      {
        filePath: "apps/desktop/src/components/Conflict.tsx",
        additions: 240,
        deletions: 90,
        summary: "330 +++++-----"
      }
    ];

    const enriched = service.withGitContext(base, gitRepositoryStatus, gitDiffSummary);

    expect(enriched.findings.some((finding) => finding.title.includes("Merge-Konflikte erkannt") && finding.severity === "error")).toBe(true);
    expect(enriched.findings.some((finding) => finding.title.includes("Viele uncommitted Aenderungen") && finding.severity === "warning")).toBe(true);
    expect(enriched.findings.some((finding) => finding.title.includes("Sehr grosser Dateidiff") && finding.filePath === "apps/desktop/src/components/Conflict.tsx")).toBe(true);
    expect(enriched.reviewedFiles).toContain("apps/desktop/src/components/Conflict.tsx");
  });
});
