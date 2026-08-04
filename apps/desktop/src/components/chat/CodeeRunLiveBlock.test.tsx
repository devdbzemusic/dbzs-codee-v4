import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeChatRun } from "@dbzs/shared";
import completedFixture from "@/services/repositoryReview/__fixtures__/run-mrx99prx-4i17.redacted.json";
import { CodeeRunLiveBlock } from "./CodeeRunLiveBlock";

declare global {
   
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeRun(overrides: Partial<RuntimeChatRun> = {}): RuntimeChatRun {
  return {
    id: "run-review-ui",
    userMessageId: "msg-user",
    status: "waiting_first_token",
    startedAt: new Date(Date.now() - completedFixture.durationMs).toISOString(),
    mode: "agent",
    profile: "agent",
    contextEnabled: true,
    events: [],
    turns: [],
    toolCalls: [],
    fileChanges: [],
    commands: [],
    ...overrides
  };
}

describe("CodeeRunLiveBlock review UX", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T10:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("zeigt auch nach mehr als 20 Sekunden keinen künstlichen Stall-Alarm und behält Stopp", () => {
    const onCancel = vi.fn();
    act(() => {
      root.render(<CodeeRunLiveBlock run={makeRun()} onCancel={onCancel} isSending />);
      vi.advanceTimersByTime(21_000);
    });
    expect(container.textContent).not.toMatch(/GENERIERUNG BLOCKIERT|20s ohne Rückmeldung|Runtime anhalten/);
    const stop = [...container.querySelectorAll("button")].find((button) => button.textContent === "Stopp");
    expect(stop).toBeTruthy();
    act(() => stop?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("zeigt einen deterministischen Review-Abschluss samt Aktionen", () => {
    const review = completedFixture.repositoryReview;
    const run = makeRun({
      status: "completed",
      outcome: "success",
      finishedAt: new Date().toISOString(),
      repositoryReview: {
        reviewId: "rev-regression-001",
        scope: "full_repository",
        status: "completed",
        outcome: "completed_with_warnings",
        intentLabel: "code_review",
        workflowId: "repository_review",
        totalBatches: review.totalBatches,
        completedBatches: review.completedBatches,
        checks: [
          { id: "typecheck", label: "Typecheck", status: "passed" },
          { id: "build", label: "Build", status: "not_executed" }
        ],
        severityCounts: review.severityCounts,
        artifactDir: ".codee/reviews/rev-regression-001",
        reportPath: ".codee/reviews/rev-regression-001/REVIEW_REPORT.md",
        findingsPath: ".codee/reviews/rev-regression-001/findings.json",
        analyzerDiagnostics: [{
          batchId: "batch-1",
          llmAttempted: true,
          llmSucceeded: false,
          llmFindingCount: 0,
          heuristicExecuted: true,
          heuristicFindingCount: 15,
          mode: "heuristic_fallback"
        }],
        quality: {
          analyzerCoverage: 0,
          reviewedFileCount: 42,
          plannedFileCount: 42,
          findingCount: 15,
          uniqueFindingTitles: 2,
          uniqueCategories: 3,
          uniqueSeverities: 1,
          repeatedGenericFindingRatio: 0.8,
          securityCoverage: "not_run",
          architectureCoverage: "not_run",
          performanceCoverage: "not_run",
          confidence: "low",
          warnings: ["LLM-Abdeckung nicht belastbar."]
        }
      }
    });
    act(() => {
      root.render(
        <CodeeRunLiveBlock
          run={run}
          onCancel={() => {}}
          isSending={false}
          workspaceRoot="C:/workspace"
          onFixFindings={() => {}}
          onRerunReview={() => {}}
        />
      );
    });
    expect(container.textContent).toContain("23 / 23");
    expect(container.textContent).toContain("Qualitätsstatus: low");
    expect(container.textContent).toContain("Analyse: LLM 0/1 · Heuristik 1/1");
    expect(container.textContent).toContain("Findings beheben");
    expect(container.textContent).toContain("Review erneut ausführen");
  });

  it("zeigt einen degradierten Resident-Fallback sichtbar an", () => {
    const run = makeRun({
      status: "streaming",
      selectionSource: "explicit_fallback",
      degraded: true,
      degradedReason: "Residenter Fallback aktiv: Rollenmodell war nicht inferenzbereit."
    });
    act(() => {
      root.render(<CodeeRunLiveBlock run={run} onCancel={() => {}} isSending workspaceRoot="C:/workspace" />);
    });

    expect(container.textContent).toContain("Run im degradierten Modus fortgesetzt");
    expect(container.textContent).toContain("Residenter Fallback aktiv");
  });
});
