import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  evaluateKeywordExpectations,
  getScenariosByLayer,
  loadUseCaseCatalog
} from "./useCaseCatalog";
import { formatCapabilityReport, runCapabilityScenarios, type CapabilityScenario } from "./capabilityTypes";
import { buildLiveSystemPrompt } from "./liveRuntimeHelpers";
import { buildLiveUserPrompt, resolveLiveFileContext } from "./liveRuntimePayload";
import type { UseCaseScenario } from "./useCaseCatalog";

const LIVE = process.env.DBZS_LIVE_RUNTIME === "1";
const BACKEND_URL = process.env.DBZS_BACKEND_URL ?? "http://127.0.0.1:8876";

async function probeBackend(): Promise<{ ok: boolean; runtimeRunning: boolean; detail: string }> {
  try {
    const health = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) {
      return { ok: false, runtimeRunning: false, detail: `health ${health.status}` };
    }
    const runtimeResponse = await fetch(`${BACKEND_URL}/runtime/status`, { signal: AbortSignal.timeout(5000) });
    if (!runtimeResponse.ok) {
      return { ok: true, runtimeRunning: false, detail: "runtime status unavailable" };
    }
    const runtime = (await runtimeResponse.json()) as { state?: string };
    return {
      ok: true,
      runtimeRunning: runtime.state === "running",
      detail: `runtime=${runtime.state ?? "unknown"}`
    };
  } catch (error) {
    return {
      ok: false,
      runtimeRunning: false,
      detail: error instanceof Error ? error.message : "probe failed"
    };
  }
}

async function sendLiveChat(scenario: UseCaseScenario): Promise<string> {
  const fileContext = resolveLiveFileContext(scenario.id);
  const response = await fetch(`${BACKEND_URL}/runtime/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      messages: [
        { role: "system", content: buildLiveSystemPrompt(scenario.id) },
        { role: "user", content: buildLiveUserPrompt(scenario) }
      ],
      file_context: fileContext,
      temperature: 0.1,
      max_tokens: 768
    })
  });

  if (!response.ok) {
    throw new Error(`Live chat failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { message?: { content?: string } };
  return body.message?.content ?? "";
}

function buildLiveScenarios(): CapabilityScenario[] {
  const catalog = loadUseCaseCatalog();
  return getScenariosByLayer("live", catalog).map((scenario) => ({
    id: `live-${scenario.id}`,
    category: "chat",
    title: `[Live] ${scenario.title}`,
    description: scenario.description,
    improvementHint: scenario.improvementHint,
    run: async () => {
      if (!scenario.prompt) {
        return { status: "skip", message: "Kein Prompt definiert." };
      }
      const content = await sendLiveChat(scenario);
      const evaluation = evaluateKeywordExpectations(content, scenario);
      if (!evaluation.ok) {
        return {
          status: "fail",
          message: `Live-Antwort unzureichend. Fehlend: ${evaluation.missing.join(", ")}. Verboten: ${evaluation.forbidden.join(", ")}`,
          details: [content.slice(0, 500)],
          improvementHint: scenario.improvementHint
        };
      }
      return { status: "pass", message: `Live OK (${content.length} Zeichen).`, details: [content.slice(0, 300)] };
    }
  }));
}

describe.skipIf(!LIVE)("Live Runtime Capability Probe", () => {
  let probe = { ok: false, runtimeRunning: false, detail: "" };

  beforeAll(async () => {
    probe = await probeBackend();
  }, 30_000);

  it("Backend erreichbar", () => {
    expect(probe.ok, probe.detail).toBe(true);
  });

  it("Runtime laeuft (DBZS_LIVE_RUNTIME=1)", () => {
    if (!probe.ok) {
      expect.fail(`Backend nicht erreichbar: ${probe.detail}`);
    }
    expect(probe.runtimeRunning, `Runtime nicht aktiv (${probe.detail}). Starte Modell und setze DBZS_LIVE_RUNTIME=1.`).toBe(
      true
    );
  });

  const liveScenarios = buildLiveScenarios();
  for (const scenario of liveScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      if (!probe.ok || !probe.runtimeRunning) {
        return;
      }
      const result = await scenario.run();
      if (result.status === "fail") {
        console.warn(`Live improvement hint (${scenario.id}): ${result.improvementHint ?? result.message}`);
        if (result.details?.[0]) {
          console.warn(`Live response preview (${scenario.id}): ${result.details[0]}`);
        }
      }
      expect(result.status, result.message).toBe("pass");
    }, 120_000);
  }

  afterAll(async () => {
    if (!LIVE || liveScenarios.length === 0) {
      return;
    }
    const report = await runCapabilityScenarios(liveScenarios);
    const formatted = formatCapabilityReport(report);
    const outDir = path.resolve(process.cwd(), "test-results");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "live-capability-report.txt"), formatted, "utf8");
    console.log(formatted);
  });
});
