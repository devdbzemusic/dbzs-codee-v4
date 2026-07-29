import type { Page } from "@playwright/test";
import { loadFixtureRecords, toProjectFiles } from "./fixture-workspace";
import { loadScenarioCatalog, resolveMockResponse, resolveSkillTitle, type E2EScenarioShape } from "./scenario-responses";

const DEFAULT_SETTINGS = {
  theme: "dark",
  autoSave: true,
  editorFontSize: 14,
  terminalShell: "powershell",
  safeCommandConfirmation: true,
  telemetryEnabled: false,
  modelsPath: "D:\\Models",
  defaultModelId: "coder-test",
  backendUrl: "http://127.0.0.1:8876",
  agentExecutionEnabled: true,
  safeMode: true,
  maxAgentRuntimeSeconds: 3600,
  maxFileScanCount: 2500,
  cloudModelsEnabled: false,
  preferLocalModels: true,
  localOnlyModels: true,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  anthropicApiKey: "",
  openaiApiKey: "",
  defaultPlannerModelId: "coder-test",
  defaultCoderModelId: "coder-test",
  defaultReviewerModelId: "coder-test",
  defaultDebugModelId: "coder-test",
  maxAutonomousSteps: 20,
  maxDebugRetries: 2,
  maxFailedTaskRetries: 1,
  localOnly: true
};

const RUNNING_RUNTIME = {
  state: "running",
  provider: "llama.cpp",
  model_id: "coder-test",
  model_name: "Coder Test",
  port: 8081,
  pid: 4242,
  endpoint: "http://127.0.0.1:8081",
  message: ""
};

const MODEL_INDEX = {
  summary: {
    total: 1,
    llama_server_ready: 1,
    llama_server_candidate: 0,
    ollama_ready: 0
  },
  models: [
    {
      id: "coder-test",
      name: "Coder Test",
      provider: "llama.cpp",
      backend: "llama.cpp",
      runtime_launcher: "llama-server",
      compatibility: "llama_server_ready",
      size_bytes: 0,
      path: "D:/Models/coder-test.gguf"
    }
  ]
};

export interface TestBridgeOptions {
  chatResponse?: string;
  runtimeState?: "running" | "stopped";
  workspace?: boolean;
  jobs?: Array<{
    id: string;
    title: string;
    status: string;
    task_type?: string;
    priority?: number;
    assigned_agent_role?: string;
    created_at?: string;
    updated_at?: string;
  }>;
}

export interface E2ETestHooks {
  chatCalls: Array<{ messages: unknown[] }>;
  enqueueCalls: unknown[];
  streamChunks: number;
}

interface BridgeBootPhase {
  id: string;
  label: string;
  state: "pending" | "running" | "success" | "failed";
  progress: number;
  message: string;
  dependencies: string[];
  optional: boolean;
  blocksWindowRelease: boolean;
  pollCount: number;
  retryCount: number;
  details: unknown[];
  startedAt?: number;
  finishedAt?: number;
}

function loadScenarioCatalogFromBridge(): { scenarios: Array<E2EScenarioShape & { layers?: string[] }> } {
  return loadScenarioCatalog();
}

export function getE2EScenarios(): Array<E2EScenarioShape & Record<string, unknown>> {
  return loadScenarioCatalogFromBridge().scenarios.filter((scenario) => scenario.layers?.includes("e2e"));
}

export async function installTestBridge(page: Page, options?: TestBridgeOptions): Promise<void> {
  const fixture = loadFixtureRecords();
  const workspaceState = {
    projectPath: options?.workspace === false ? null : fixture.root,
    projectName: options?.workspace === false ? null : fixture.name,
    lastOpenedAt: new Date().toISOString(),
    maxFileScanCount: 2500
  };
  const projectFiles = toProjectFiles(fixture.root, fixture.files);
  const chatResponse =
    options?.chatResponse ??
    "Der subtract-Bug addiert statt zu subtrahieren. Fix: return a - b in src/calculator.ts.";
  const runtime = options?.runtimeState === "stopped"
    ? { state: "stopped", message: "Runtime stopped.", provider: null, model_id: null, model_name: null, port: null, pid: null, endpoint: null }
    : RUNNING_RUNTIME;
  const jobs = options?.jobs ?? [];

  await page.route("**/runtime/slots/*/status", async (route) => {
    const slotId = route.request().url().split("/slots/")[1]?.split("/")[0] ?? "quality_cpu";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...RUNNING_RUNTIME,
        slot_id: slotId,
        state: "running",
        chat_ready: true,
        device_policy: slotId === "fast_gpu" ? "gpu" : "cpu",
        gpu_layers: slotId === "fast_gpu" ? 32 : 0,
        context_size: 8192
      })
    });
  });
  await page.route("**/runtime/slots/*/start", async (route) => {
    const slotId = route.request().url().split("/slots/")[1]?.split("/")[0] ?? "quality_cpu";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...RUNNING_RUNTIME, slot_id: slotId, state: "running", chat_ready: true })
    });
  });
  await page.route("**/runtime/slots/*/warmup", async (route) => {
    const slotId = route.request().url().split("/slots/")[1]?.split("/")[0] ?? "quality_cpu";
    const body = route.request().postDataJSON?.() as { model_id?: string; timeout_ms?: number } | undefined;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        outcome: "inference_ready",
        detail: "OK",
        model_id: body?.model_id ?? "coder-test",
        model_name: "Coder Test",
        slot_id: slotId,
        elapsed_ms: 12,
        readiness_stage: "inference_ready"
      })
    });
  });

  await page.addInitScript(
    ({ settings, workspaceState, projectFiles, files, runtime, modelIndex, chatResponseText, initialJobs }) => {
      localStorage.setItem("dbzs-runtime-chat-tool-profile", "ask");
      const fileMap = new Map(files.map((file) => [file.relativePath, file.content]));
      const hooks: E2ETestHooks = { chatCalls: [], enqueueCalls: [], streamChunks: 0 };
      (window as unknown as { __dbzsE2E: E2ETestHooks }).__dbzsE2E = hooks;
      const now = Date.now();
      const bootState = {
        runId: "boot-e2e",
        status: "starting",
        currentPhaseId: "frontend-bridge",
        overallProgress: 0,
        startedAt: now,
        backendPid: 4242,
        backendPort: 8876,
        activeRuntimeSlot: "quality_cpu",
        residentModelId: "coder-test",
        detectedModelCount: 1,
        lastErrorMessage: null,
        phases: [
          {
            id: "frontend-bridge",
            label: "Frontend Bridge",
            state: "running",
            progress: 10,
            message: "Initialisiere IPC-Bridge.",
            dependencies: [],
            optional: false,
            blocksWindowRelease: false,
            pollCount: 0,
            retryCount: 0,
            details: [],
            startedAt: now
          },
          {
            id: "frontend-config-sync",
            label: "Frontend Config Sync",
            state: "pending",
            progress: 0,
            message: "",
            dependencies: ["frontend-bridge"],
            optional: false,
            blocksWindowRelease: false,
            pollCount: 0,
            retryCount: 0,
            details: []
          },
          {
            id: "workspace-restore",
            label: "Workspace Restore",
            state: "pending",
            progress: 0,
            message: "",
            dependencies: ["frontend-config-sync"],
            optional: false,
            blocksWindowRelease: false,
            pollCount: 0,
            retryCount: 0,
            details: []
          },
          {
            id: "agents-roles-models",
            label: "Agents Roles Models",
            state: "pending",
            progress: 0,
            message: "",
            dependencies: ["workspace-restore"],
            optional: false,
            blocksWindowRelease: false,
            pollCount: 0,
            retryCount: 0,
            details: []
          }
        ] satisfies BridgeBootPhase[]
      };
      const bootListeners = new Set<(state: typeof bootState) => void>();
      const resolveBridgeAssistantContent = (messages: unknown[], fallback: string): string => {
        const serialized = JSON.stringify(messages);
        const lastContent =
          Array.isArray(messages) && messages.length > 0
            ? String((messages[messages.length - 1] as { content?: unknown })?.content ?? "")
            : "";

        if (/schlage einen fix vor/i.test(serialized)) {
          if (/\[Tool Result: read_file\]/i.test(serialized) || /src\/calculator\.ts/i.test(lastContent)) {
            return "Der subtract-Bug addiert statt zu subtrahieren. In src/calculator.ts sollte subtract `return a - b;` verwenden. Ich habe bewusst noch keine Umsetzen-Aktion ausgelöst.";
          }
          return [
            "<CODEE_TOOL_CALL>",
            JSON.stringify({ name: "read_file", arguments: { path: "src/calculator.ts" } }),
            "</CODEE_TOOL_CALL>"
          ].join("\n");
        }

        return `${fallback}\n\n(Echo: ${lastContent})`;
      };

      const noopSubscription = () => () => undefined;
      const cloneBootState = () => ({
        ...bootState,
        phases: bootState.phases.map((phase) => ({ ...phase, details: [...phase.details] }))
      });
      const notifyBootState = () => {
        const snapshot = cloneBootState();
        for (const listener of bootListeners) {
          listener(snapshot);
        }
      };
      const markNextPhaseRunning = (phaseId: string) => {
        const nextPhaseOrder = [
          "frontend-bridge",
          "frontend-config-sync",
          "workspace-restore",
          "agents-roles-models"
        ];
        const currentIndex = nextPhaseOrder.indexOf(phaseId);
        const nextId = currentIndex >= 0 ? nextPhaseOrder[currentIndex + 1] : null;
        if (!nextId) {
          bootState.currentPhaseId = null;
          bootState.status = "ready";
          bootState.overallProgress = 100;
          return;
        }
        const nextPhase = bootState.phases.find((phase) => phase.id === nextId);
        if (!nextPhase || nextPhase.state !== "pending") {
          return;
        }
        nextPhase.state = "running";
        nextPhase.progress = 15;
        nextPhase.startedAt = Date.now();
        nextPhase.message = `Phase ${nextPhase.label} gestartet.`;
        bootState.currentPhaseId = nextId;
        bootState.overallProgress = Math.max(bootState.overallProgress, 25);
      };

      window.dbzs = {
        getAppInfo: async () => ({
          name: "dbzs-e2e",
          version: "0.0.0",
          platform: "test",
          backendUrl: settings.backendUrl
        }),
        getBackendHealth: async () => ({ status: "ok", app: "DBZS", version: "0.0.0" }),
        getBackendStartupStatus: async () => ({ state: "ready", message: null, port: 8876 }),
        onBackendStartupStatus: noopSubscription,
        getBootState: async () => cloneBootState(),
        onBootState: (listener) => {
          bootListeners.add(listener);
          return () => {
            bootListeners.delete(listener);
          };
        },
        reportBootPhaseState: async (phaseId, state, message) => {
          const phase = bootState.phases.find((entry) => entry.id === phaseId);
          if (!phase) {
            return;
          }
          phase.state = state;
          phase.message = message;
          phase.progress = state === "success" ? 100 : phase.progress;
          phase.finishedAt = Date.now();
          bootState.overallProgress = Math.max(
            bootState.overallProgress,
            Math.round((bootState.phases.filter((entry) => entry.state === "success").length / bootState.phases.length) * 100)
          );
          if (state === "failed") {
            bootState.status = "failed";
            bootState.currentPhaseId = phaseId;
            bootState.lastErrorMessage = message;
          } else if (state === "success") {
            markNextPhaseRunning(phaseId);
          }
          notifyBootState();
        },
        isBootSafeMode: async () => false,
        getSettings: async () => settings,
        updateSettings: async (next) => next,
        getWorkspaceState: async () => workspaceState,
        setWorkspaceState: async (next) => next,
        normalizeWorkspaceContextPaths: async (root: string, candidates: string[]) => {
          const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
          return candidates.map((candidate) => {
            const normalized = candidate.replace(/\\/g, "/");
            return normalized.startsWith(`${normalizedRoot}/`) ? normalized.slice(normalizedRoot.length + 1) : normalized;
          });
        },
        scanProjectFiles: async () => projectFiles,
        readProjectFile: async (filePath: string) => {
          const normalizedRoot = workspaceState.projectPath?.replace(/\\/g, "/") ?? "";
          const normalizedPath = filePath.replace(/\\/g, "/");
          const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
            ? normalizedPath.slice(normalizedRoot.length + 1)
            : normalizedPath;
          const content = fileMap.get(relative);
          if (!content) return null;
          const record = files.find((file) => file.relativePath === relative);
          return {
            path: normalizedPath,
            name: relative.split("/").pop() ?? relative,
            language: record?.language ?? "plaintext",
            content
          };
        },
        writeProjectFile: async (filePath: string, content: string) => ({
          path: filePath,
          name: filePath.split(/[\\/]/).pop() ?? filePath,
          language: "plaintext",
          content
        }),
        openFileDialog: async () => null,
        saveFile: async () => ({ path: "", name: "", language: "plaintext", content: "" }),
        getModelIndex: async () => modelIndex,
        getRuntimeStatus: async () => runtime,
        startRuntimeModel: async () => runtime,
        stopRuntimeModel: async () => ({ state: "stopped", message: "" }),
        sendRuntimeChat: async (request) => {
          hooks.chatCalls.push({ messages: request.messages });
          const content = resolveBridgeAssistantContent(request.messages, chatResponseText);
          return {
            message: {
              role: "assistant",
              content
            },
            model_id: "coder-test",
            model_name: "Coder Test"
          };
        },
        streamRuntimeChat: async (request, onChunk) => {
          hooks.chatCalls.push({ messages: request.messages });
          const content = resolveBridgeAssistantContent(request.messages, chatResponseText);
          onChunk({ delta: content, totalLength: content.length });
          hooks.streamChunks += 1;
          return {
            message: { role: "assistant", content },
            model_id: "coder-test",
            model_name: "Coder Test"
          };
        },
        listAgents: async () => [],
        getAgent: async () => {
          throw new Error("not found");
        },
        createAgent: async () => ({ id: "agent-1", name: "Test", role: "coder", enabled: true }),
        updateAgent: async () => ({ id: "agent-1", name: "Test", role: "coder", enabled: true }),
        startAgent: async () => ({ id: "agent-1", name: "Test", role: "coder", enabled: true }),
        stopAgent: async () => ({ id: "agent-1", name: "Test", role: "coder", enabled: false }),
        deleteAgent: async () => ({ status: "deleted", agent_id: "agent-1" }),
        listAgentLogs: async () => [],
        listProjectMemory: async () => [],
        upsertProjectMemory: async () => ({ id: "mem-1", title: "Test", content: "", tags: [], created_at: "", updated_at: "" }),
        deleteProjectMemory: async () => ({ status: "deleted" }),
        listTasks: async () => [],
        createTask: async () => ({ id: "task-1", title: "Test", status: "todo", created_at: "", updated_at: "" }),
        updateTask: async () => ({ id: "task-1", title: "Test", status: "todo", created_at: "", updated_at: "" }),
        deleteTask: async () => ({ status: "deleted" }),
        analyzeDocs: async () => ({ summary: "ok", markdown: "# Docs" }),
        generateDocs: async () => ({ markdown: "# Generated" }),
        listJobs: async () => initialJobs,
        enqueueJob: async (request) => {
          hooks.enqueueCalls.push(request);
          return {
            id: "job-e2e-1",
            title: request.title,
            status: "queued",
            task_type: request.task_type,
            priority: request.priority,
            assigned_agent_role: request.assigned_agent_role,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
        },
        reloadBackend: async () => ({ status: "ok" }),
        onRuntimeChatWindowState: noopSubscription,
        onRuntimeChatContext: noopSubscription,
        getRuntimeChatContext: async () => null,
        publishRuntimeChatContext: async () => ({ status: "ok" })
      };
    },
    {
      settings: DEFAULT_SETTINGS,
      workspaceState,
      projectFiles,
      files: fixture.files,
      runtime,
      modelIndex: MODEL_INDEX,
      chatResponseText: chatResponse,
      initialJobs: jobs
    }
  );
}

export { resolveSkillTitle, SKILL_TITLES } from "./scenario-responses";

export async function installScenarioBridge(page: Page, scenario: E2EScenarioShape & { runtimeState?: "running" | "stopped" }): Promise<void> {
  await installTestBridge(page, {
    chatResponse: resolveMockResponse(scenario),
    runtimeState: scenario.runtimeState ?? "running"
  });
}

export async function getE2EHooks(page: Page): Promise<E2ETestHooks> {
  return page.evaluate(() => (window as unknown as { __dbzsE2E: E2ETestHooks }).__dbzsE2E);
}

export function runtimeChatComposer(page: import("@playwright/test").Page) {
  return runtimeChatScope(page).getByRole("textbox", {
    name: /Analysiere, plane(?:, debugge)? oder (?:frag nach dem Status|implementiere)|Backend verbinden|Runtime starten/i
  });
}

export async function openRuntimeChatPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  const chat = page.locator("section").filter({ hasText: "Runtime Chat" }).first();
  await chat.scrollIntoViewIfNeeded();
  await chat.waitFor({ state: "visible", timeout: 15_000 });
}

export function runtimeChatScope(page: import("@playwright/test").Page) {
  return page.locator("section").filter({ hasText: "Runtime Chat" }).first();
}

export async function sendRuntimeChatPrompt(
  page: Page,
  prompt: string,
  options?: { agentMode?: boolean; skillTitle?: string }
): Promise<void> {
  const chat = runtimeChatScope(page);
  if (options?.agentMode) {
    await chat.getByRole("button", { name: "Agent", exact: true }).click();
  }
  if (options?.skillTitle) {
    await chat.getByTitle(options.skillTitle).click();
  }
  await runtimeChatComposer(page).fill(prompt);
  await chat.getByRole("button", { name: "Senden" }).click();
}
