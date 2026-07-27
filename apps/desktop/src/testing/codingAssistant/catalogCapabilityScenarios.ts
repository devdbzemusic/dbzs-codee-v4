import type { ModelTargetAgent } from "@dbzs/shared";
import { parseAgentOutputToProposedChanges } from "@/services/agentOutputParser";
import { parseRuntimeToolCallsFromAssistant } from "@/services/runtimeChatToolParser";
import { evaluateTerminalCommandPolicy } from "@/runtime/tool/execPolicy";
import { executeAssistantTakeover } from "@/services/runtimeChatTakeover";
import type { RuntimeChatSendOptions } from "@/stores/runtimeChatStore";
import type { CapabilityScenario } from "./capabilityTypes";
import { setCapabilityBrokerAgentOverride } from "./capabilityScenarios";
import {
  evaluateKeywordExpectations,
  getScenariosByLayer,
  loadUseCaseCatalog,
  resolveMockResponse,
  resolveTakeoverProposal,
  type UseCaseScenario
} from "./useCaseCatalog";
import { FIXTURE_CALCULATOR_PATH, fixedSubtractContent, buildPatchJson } from "./fixtureWorkspace";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

export interface CatalogScenarioDeps {
  fixtureRoot: string;
  fixtureName: string;
  fixtureFiles: { relativePath: string }[];
  fileContents: Map<string, string>;
  runningStatus: import("@dbzs/shared").RuntimeStatus;
  mockAssistantResponse: (content: string) => void;
  sendChatStreamMock: { mock: { calls: unknown[][] } };
  queueProposedChangesMock: { mock: { calls: unknown[][]; mockClear: () => void } };
  enqueueJobMock: { mock: { calls: unknown[][]; mockClear: () => void; mockResolvedValueOnce: (value: unknown) => void } };
}

type CatalogDepsFactory = () => CatalogScenarioDeps;

function workspaceContext(deps: CatalogScenarioDeps) {
  return {
    rootPath: deps.fixtureRoot,
    name: deps.fixtureName,
    fileTree: deps.fixtureFiles.map((file) => file.relativePath),
    sampledFiles: [] as import("@dbzs/shared").RuntimeChatWorkspaceContext["sampledFiles"]
  };
}

function catalogSendOptions(deps: CatalogScenarioDeps, scenario: UseCaseScenario): RuntimeChatSendOptions {
  const directAgentTarget =
    scenario.targetAgent && scenario.targetAgent !== "runtime_chat";

  return {
    agentMode: scenario.agentMode || directAgentTarget ? "agent" : "auto",
    enabledSkillIds: scenario.skillId ? [scenario.skillId] : undefined
  };
}

function toCapabilityScenario(getDeps: CatalogDepsFactory, scenario: UseCaseScenario): CapabilityScenario {
  return {
    id: `catalog-${scenario.id}`,
    category: mapCategory(scenario.category),
    title: scenario.title,
    description: scenario.description,
    improvementHint: scenario.improvementHint,
    run: () => runCatalogScenario(getDeps(), scenario)
  };
}

function mapCategory(category: string): CapabilityScenario["category"] {
  const allowed: CapabilityScenario["category"][] = [
    "chat",
    "patch",
    "tools",
    "agent",
    "approval",
    "takeover",
    "policy",
    "context",
    "backend"
  ];
  return allowed.includes(category as CapabilityScenario["category"])
    ? (category as CapabilityScenario["category"])
    : "chat";
}

async function runCatalogScenario(deps: CatalogScenarioDeps, scenario: UseCaseScenario) {
  switch (scenario.category) {
    case "analysis":
    case "chat":
      return runChatScenario(deps, scenario);
    case "patch":
      if (scenario.id === "patch-markdown-block") {
        return runMarkdownPatchScenario(deps);
      }
      return runPatchScenario(deps, scenario);
    case "tools":
      return runToolScenario(scenario);
    case "policy":
      if (scenario.command) {
        return runPolicyScenario(scenario);
      }
      return runChatScenario(deps, scenario);
    case "agent":
      return runAgentScenario(deps, scenario);
    case "takeover":
      return runTakeoverScenario(deps, scenario);
    default:
      return { status: "skip" as const, message: `Kein Vitest-Runner fuer ${scenario.category}.` };
  }
}

async function runChatScenario(deps: CatalogScenarioDeps, scenario: UseCaseScenario) {
  if (scenario.expectSendFalse) {
    const sent = await useRuntimeChatStore.getState().sendMessage("   ", deps.runningStatus, null);
    return sent === false
      ? { status: "pass" as const, message: "Leere Nachricht blockiert." }
      : { status: "fail" as const, message: "Leere Nachricht wurde gesendet." };
  }

  const mockResponse = resolveMockResponse(scenario);
  deps.mockAssistantResponse(mockResponse);

  if (scenario.skillId) {
    useRuntimeChatStore.setState({ enabledSkillIds: [scenario.skillId] });
  }

  const prompt = scenario.prompt ?? scenario.title;
  const expectedAgent = (scenario.targetAgent as ModelTargetAgent | undefined) ?? "runtime_chat";
  setCapabilityBrokerAgentOverride(expectedAgent);
  const sent = await useRuntimeChatStore.getState().sendMessage(
    prompt,
    deps.runningStatus,
    null,
    workspaceContext(deps),
    null,
    expectedAgent,
    catalogSendOptions(deps, scenario)
  );

  try {
    const messages = useRuntimeChatStore.getState().messages;
    const assistantContent = messages.filter((message) => message.role === "assistant").at(-1)?.content ?? mockResponse;
    const combined = messages.map((message) => message.content).join("\n");
    const keywords = evaluateKeywordExpectations(combined, scenario);

    if (!sent) {
      const detail = useRuntimeChatStore.getState().error ?? "no error";
      return { status: "fail" as const, message: `sendMessage lieferte false: ${detail}` };
    }
    if (!keywords.ok) {
      return {
        status: "fail" as const,
        message: `Erwartung verfehlt. Fehlend: ${keywords.missing.join(", ")}. Verboten: ${keywords.forbidden.join(", ")}`,
        improvementHint: scenario.improvementHint
      };
    }
    return { status: "pass" as const, message: `Antwort OK (${assistantContent.length} Zeichen).` };
  } finally {
    setCapabilityBrokerAgentOverride(null);
  }
}

async function runPatchScenario(deps: CatalogScenarioDeps, scenario: UseCaseScenario) {
  const mockResponse = resolveMockResponse(scenario);
  deps.mockAssistantResponse(mockResponse);
  deps.queueProposedChangesMock.mockClear();
  const expectedAgent = (scenario.targetAgent as ModelTargetAgent | undefined) ?? "coder";
  setCapabilityBrokerAgentOverride(expectedAgent);

  const sent = await useRuntimeChatStore.getState().sendMessage(
    scenario.prompt ?? scenario.title,
    deps.runningStatus,
    null,
    workspaceContext(deps),
    null,
    expectedAgent,
    catalogSendOptions(deps, scenario)
  );

  if (!sent) {
    setCapabilityBrokerAgentOverride(null);
    const detail = useRuntimeChatStore.getState().error ?? "no error";
    return {
      status: "fail" as const,
      message: `sendMessage lieferte false: ${detail}`,
      improvementHint: scenario.improvementHint
    };
  }

  try {
    if (scenario.expectPatchQueue && deps.queueProposedChangesMock.mock.calls.length > 0) {
      const firstBatch = deps.queueProposedChangesMock.mock.calls[0]?.[0];
      const patchCount = Array.isArray(firstBatch) ? firstBatch.length : 0;
      if (scenario.expectPatchCount && patchCount !== scenario.expectPatchCount) {
        return {
          status: "fail" as const,
          message: `Erwartet ${scenario.expectPatchCount} Patches, erhalten ${patchCount}.`,
          improvementHint: scenario.improvementHint
        };
      }
      return {
        status: "pass" as const,
        message: `${patchCount} Aenderung(en) in Queue.`
      };
    }
    return { status: "fail" as const, message: "Kein Patch in Queue.", improvementHint: scenario.improvementHint };
  } finally {
    setCapabilityBrokerAgentOverride(null);
  }
}

async function runMarkdownPatchScenario(deps: CatalogScenarioDeps) {
  const payload = ["```json", buildPatchJson(FIXTURE_CALCULATOR_PATH, fixedSubtractContent()), "```"].join("\n");
  const parsed = parseAgentOutputToProposedChanges(payload, { agentId: "test", workspaceRoot: deps.fixtureRoot });
  return parsed.length === 1
    ? { status: "pass" as const, message: "Markdown-JSON geparst." }
    : { status: "fail" as const, message: "Markdown-JSON nicht parsebar." };
}

async function runToolScenario(scenario: UseCaseScenario) {
  const content = resolveMockResponse(scenario);
  const calls = parseRuntimeToolCallsFromAssistant(content);
  const expected = scenario.expectToolCalls ?? [];
  const names = calls.map((call) => call.name);
  const ok = expected.every((name) => names.includes(name));
  return ok
    ? { status: "pass" as const, message: `Tools: ${names.join(", ")}` }
    : { status: "fail" as const, message: `Erwartet ${expected.join(", ")}, erhalten ${names.join(", ")}` };
}

async function runPolicyScenario(scenario: UseCaseScenario) {
  const result = evaluateTerminalCommandPolicy(scenario.command ?? "");
  const expected = scenario.expectPolicy ?? "allow";
  return result.decision === expected
    ? { status: "pass" as const, message: result.reason ?? result.decision }
    : { status: "fail" as const, message: `Erwartet ${expected}, erhalten ${result.decision}` };
}

async function runAgentScenario(deps: CatalogScenarioDeps, scenario: UseCaseScenario) {
  if (scenario.skillId) {
    useRuntimeChatStore.setState({ enabledSkillIds: [scenario.skillId] });
  }

  const expectedAgent = (scenario.targetAgent as ModelTargetAgent | undefined) ?? "runtime_chat";
  setCapabilityBrokerAgentOverride(expectedAgent);
  try {
    deps.mockAssistantResponse(resolveMockResponse(scenario));
    const sent = await useRuntimeChatStore.getState().sendMessage(
      scenario.prompt ?? scenario.title,
      deps.runningStatus,
      null,
      workspaceContext(deps),
      null,
      expectedAgent,
      catalogSendOptions(deps, scenario)
    );

    const agent = useRuntimeChatStore.getState().lastRouting?.targetAgent;
    if (!sent) {
      const detail = useRuntimeChatStore.getState().error ?? "no error";
      return {
        status: "fail" as const,
        message: `sendMessage lieferte false: ${detail}`,
        improvementHint: scenario.improvementHint
      };
    }
    const keywords = evaluateKeywordExpectations(
      useRuntimeChatStore
        .getState()
        .messages.map((message) => message.content)
        .join("\n"),
      scenario
    );

    if (scenario.targetAgent && agent !== scenario.targetAgent) {
      return {
        status: "fail" as const,
        message: `Agent ${String(agent)} statt ${scenario.targetAgent}.`,
        improvementHint: scenario.improvementHint
      };
    }
    if (!keywords.ok) {
      return { status: "fail" as const, message: "Keyword-Erwartung verfehlt.", improvementHint: scenario.improvementHint };
    }
    return { status: "pass" as const, message: `Agent ${String(agent)}.` };
  } finally {
    setCapabilityBrokerAgentOverride(null);
  }
}

async function runTakeoverScenario(deps: CatalogScenarioDeps, scenario: UseCaseScenario) {
  deps.queueProposedChangesMock.mockClear();
  deps.enqueueJobMock.mockClear();
  if (scenario.expectJobEnqueue) {
    deps.enqueueJobMock.mockResolvedValueOnce({ id: "job-catalog-1", title: "Test", status: "queued" });
  }

  const proposal = resolveTakeoverProposal(scenario);
  const detail = await executeAssistantTakeover({
    proposal,
    workspaceRoot: deps.fixtureRoot,
    workspaceContext: workspaceContext(deps),
    activeFile: null,
    queueProposedChanges: deps.queueProposedChangesMock as never
  });

  if (scenario.expectPatchQueue && deps.queueProposedChangesMock.mock.calls.length > 0) {
    return { status: "pass" as const, message: detail };
  }
  if (scenario.expectJobEnqueue && deps.enqueueJobMock.mock.calls.length > 0) {
    return { status: "pass" as const, message: detail };
  }
  return { status: "fail" as const, message: detail, improvementHint: scenario.improvementHint };
}

export function buildCatalogVitestScenarios(getDeps: CatalogDepsFactory): CapabilityScenario[] {
  const catalog = loadUseCaseCatalog();
  return getScenariosByLayer("vitest", catalog)
    .filter((scenario) => scenario.id !== "workspace-boundary")
    .map((scenario) => toCapabilityScenario(getDeps, scenario));
}

export function buildInfrastructureScenarios(getDeps: CatalogDepsFactory): CapabilityScenario[] {
  return [
    {
      id: "patch-detection-heuristic",
      category: "patch",
      title: "looksLikeAgentChangePayload erkennt nur valide Payloads",
      description: "Heuristik vermeidet False Positives bei Freitext.",
      run: async () => {
        const { looksLikeAgentChangePayload } = await import("@/services/agentOutputParser");
        const prose = "Ich plane changes fuer src/calculator.ts";
        const json = buildPatchJson(FIXTURE_CALCULATOR_PATH, fixedSubtractContent());
        return !looksLikeAgentChangePayload(prose) && looksLikeAgentChangePayload(json)
          ? { status: "pass", message: "Heuristik korrekt." }
          : { status: "fail", message: "Heuristik liefert falsches Ergebnis." };
      }
    },
    {
      id: "context-workspace-sampling",
      category: "context",
      title: "Workspace-Kontext laedt Fixture-Dateien",
      description: "buildWorkspaceContext sampled Dateien aus dem Test-Workspace.",
      improvementHint: "Kontext-Pipeline bei grossen Workspaces optimieren.",
      run: async () => {
        const deps = getDeps();
        const { buildWorkspaceContext } = await import("@/services/runtimeChatContext");
        const result = await buildWorkspaceContext(
          deps.fixtureRoot,
          deps.fixtureName,
          deps.fixtureFiles as never,
          null
        );
        return result.context && result.sampledCount > 0
          ? { status: "pass", message: `${result.sampledCount} Datei(en) gesampelt.` }
          : { status: "fail", message: "Kein Workspace-Kontext." };
      }
    },
    {
      id: "chat-runtime-stopped-blocked",
      category: "chat",
      title: "Chat blockiert bei gestoppter Runtime",
      description: "Senden wird abgebrochen wenn Runtime gestoppt ist.",
      run: async () => {
        const deps = getDeps();
        const { backendClient } = await import("@/services/backendClient");
        const { getAllSlotsStatusMock } = await import("./capabilityScenarios");
        const { vi } = await import("vitest");
        const stopped = { ...deps.runningStatus, state: "stopped" as const, endpoint: null, pid: null, port: null };
        vi.mocked(backendClient.getRuntimeStatus).mockResolvedValue(stopped);
        getAllSlotsStatusMock.mockReset();
        getAllSlotsStatusMock.mockRejectedValue(new Error("network down"));
        await useRuntimeChatStore.getState().sendMessage("Hallo", stopped, null);
        return useRuntimeChatStore.getState().error?.includes("Backend nicht erreichbar")
          ? { status: "pass", message: "Senden blockiert." }
          : {
              status: "fail",
              message: `Kein Backend-Guard (${useRuntimeChatStore.getState().error ?? "no error"}).`
            };
      }
    },
    {
      id: "workspace-boundary-parser",
      category: "policy",
      title: "Parser blockiert Pfade ausserhalb Workspace",
      description: "Patch-Pfade ausserhalb des Workspace werden abgelehnt.",
      run: async () => {
        const deps = getDeps();
        const { AgentOutputParseError } = await import("@/services/agentOutputParser");
        try {
          parseAgentOutputToProposedChanges(
            JSON.stringify({
              changes: [{ filePath: "../outside.ts", proposedContent: "x" }]
            }),
            { agentId: "test", workspaceRoot: deps.fixtureRoot }
          );
          return { status: "fail", message: "Outside path wurde akzeptiert." };
        } catch (error) {
          return error instanceof AgentOutputParseError
            ? { status: "pass", message: "Outside path blockiert." }
            : { status: "fail", message: "Unerwarteter Fehler." };
        }
      }
    }
  ];
}
