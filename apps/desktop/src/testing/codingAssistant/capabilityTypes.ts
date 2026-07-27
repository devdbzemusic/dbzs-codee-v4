export type CapabilityCategory =
  | "chat"
  | "patch"
  | "tools"
  | "agent"
  | "approval"
  | "takeover"
  | "policy"
  | "context"
  | "backend";

export type CapabilityStatus = "pass" | "fail" | "skip";

export interface CapabilityResult {
  status: CapabilityStatus;
  message: string;
  details?: string[];
  improvementHint?: string;
  durationMs?: number;
}

export interface CapabilityScenario {
  id: string;
  category: CapabilityCategory;
  title: string;
  description: string;
  improvementHint?: string;
  run: () => Promise<CapabilityResult>;
}

export interface CapabilityReport {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: Array<CapabilityScenario & CapabilityResult>;
  improvementBacklog: string[];
}

export function formatCapabilityReport(report: CapabilityReport): string {
  const lines = [
    "=== Coding Assistant Capability Report ===",
    `Generated: ${report.generatedAt}`,
    `Pass: ${report.passed} | Fail: ${report.failed} | Skip: ${report.skipped} | Total: ${report.total}`,
    ""
  ];

  for (const result of report.results) {
    const icon = result.status === "pass" ? "OK" : result.status === "fail" ? "FAIL" : "SKIP";
    lines.push(`[${icon}] ${result.id} (${result.category}) — ${result.title}`);
    lines.push(`      ${result.message}`);
    if (result.details?.[0]) {
      lines.push(`      Antwort: ${result.details[0].replace(/\s+/g, " ").slice(0, 280)}`);
    }
    if (result.improvementHint) {
      lines.push(`      Hint: ${result.improvementHint}`);
    }
  }

  if (report.improvementBacklog.length > 0) {
    lines.push("", "=== Improvement Backlog ===");
    for (const item of report.improvementBacklog) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

export async function runCapabilityScenarios(
  scenarios: CapabilityScenario[],
  options?: { beforeScenario?: () => Promise<void> }
): Promise<CapabilityReport> {
  const results: CapabilityReport["results"] = [];

  for (const scenario of scenarios) {
    if (options?.beforeScenario) {
      await options.beforeScenario();
    }
    const startedAt = Date.now();
    try {
      const outcome = await scenario.run();
      results.push({
        ...scenario,
        ...outcome,
        durationMs: Date.now() - startedAt,
        improvementHint: outcome.improvementHint ?? scenario.improvementHint
      });
    } catch (error) {
      results.push({
        ...scenario,
        status: "fail",
        message: error instanceof Error ? error.message : "Unbekannter Fehler",
        improvementHint: scenario.improvementHint,
        durationMs: Date.now() - startedAt
      });
    }
  }

  const passed = results.filter((entry) => entry.status === "pass").length;
  const failed = results.filter((entry) => entry.status === "fail").length;
  const skipped = results.filter((entry) => entry.status === "skip").length;

  const improvementBacklog = results
    .filter((entry) => entry.status === "fail")
    .map((entry) => `${entry.id}: ${entry.improvementHint ?? entry.message}`);

  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    skipped,
    results,
    improvementBacklog
  };
}
