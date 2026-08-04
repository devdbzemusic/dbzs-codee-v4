import type { Page } from "@playwright/test";
import type { AppSettings, ModelLabModel, ModelLabScanJob, ModelLabSource, RuntimeStatus, WorkspaceState } from "@dbzs/shared";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { loadFixtureRecords, type FixtureFileRecord } from "../../e2e/helpers/fixture-workspace";
import { resolveMockResponse } from "../../e2e/helpers/scenario-responses";

const FIXTURE = loadFixtureRecords();

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  theme: "dark",
  autoSave: true,
  editorFontSize: 14,
  telemetryEnabled: false,
  modelsPath: "D:/Models",
  backendUrl: "http://127.0.0.1:8876",
  defaultModelId: "coder-test",
  defaultChatModelId: "coder-test",
  defaultPlannerModelId: "coder-test",
  defaultCoderModelId: "coder-test",
  defaultReviewerModelId: "coder-test",
  defaultDebugModelId: "coder-test",
  defaultOrchestratorModelId: "coder-test",
  defaultDocumentationModelId: "coder-test",
  localOnly: true,
  maxFileScanCount: 2500,
  revision: 1
};

const RUNNING_RUNTIME: RuntimeStatus = {
  state: "running",
  provider: "llama.cpp",
  model_id: "coder-test",
  model_name: "Coder Test",
  port: 8081,
  pid: 4242,
  endpoint: "http://127.0.0.1:8081",
  message: "Runtime bereit."
};

const STOPPED_RUNTIME: RuntimeStatus = {
  state: "stopped",
  provider: null,
  model_id: null,
  model_name: null,
  port: null,
  pid: null,
  endpoint: null,
  message: "Runtime gestoppt."
};

const ERROR_RUNTIME: RuntimeStatus = {
  state: "error",
  provider: "llama.cpp",
  model_id: "coder-test",
  model_name: "Coder Test",
  port: null,
  pid: null,
  endpoint: null,
  message: "Runtime konnte llama-server nicht starten."
};

const MODEL_INDEX = {
  summary: {
    total: 1,
    gguf_total: 1,
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
      recommended_use: "chat",
      artifact_type: "model",
      size_bytes: 0,
      size_gb: 0,
      path: "D:/Models/coder-test.gguf",
      capabilities: ["chat", "code"]
    }
  ],
  multimodal_pairs: [],
  support_artifacts: []
};

const MODEL_LAB_SOURCES: ModelLabSource[] = [
  {
    id: "source-1",
    name: "Lokale Modelle",
    path: "D:/Models",
    kind: "filesystem",
    enabled: true,
    trusted: true,
    include_globs: [],
    exclude_globs: [],
    last_scan_at: null,
    last_scan_status: null,
    created_at: "2026-08-04T18:00:00.000Z",
    updated_at: "2026-08-04T18:00:00.000Z"
  }
];

const MODEL_LAB_MODELS: ModelLabModel[] = [
  {
    bundle: {
      bundle_id: "bundle-coder-test",
      source_id: "source-1",
      name: "Coder Test",
      family: "Test",
      format: "gguf",
      status: "READY",
      capabilities: ["chat", "code"],
      tags: ["fixture"],
      metadata: {},
      health: { quantization: "Q4_K_M" },
      created_at: "2026-08-04T18:00:00.000Z",
      updated_at: "2026-08-04T18:00:00.000Z",
      is_favorite: true
    },
    artifacts: [
      {
        artifact_id: "artifact-1",
        bundle_id: "bundle-coder-test",
        artifact_type: "model",
        format: "gguf",
        path: "D:/Models/coder-test.gguf",
        size_bytes: 4096,
        sha256: null,
        metadata: {},
        created_at: "2026-08-04T18:00:00.000Z"
      }
    ],
    readiness: [],
    routing: [],
    assignments: []
  }
];

export interface RealcheckHooks {
  chatCalls: Array<{ prompt: string }>;
  cancelCalls: number;
  openedFiles: string[];
  appliedPatches: string[];
  rolledBackPatches: string[];
  selectedWorkspaceCount: number;
  settingsSaves: number;
  modelLabScans: number;
}

export interface BridgeOptions {
  initialWorkspaceVisible?: boolean;
  initialWorkspaceFiles?: FixtureFileRecord[];
  runtimeState?: "running" | "stopped" | "error";
  bootState?: "ready" | "degraded" | "starting";
  chatMode?: "instant" | "slow-stream" | "patch";
  scanDelayMs?: number;
}

function runtimeFor(state: BridgeOptions["runtimeState"]): RuntimeStatus {
  switch (state) {
    case "stopped":
      return { ...STOPPED_RUNTIME };
    case "error":
      return { ...ERROR_RUNTIME };
    default:
      return { ...RUNNING_RUNTIME };
  }
}

function workspaceStateFor(visible: boolean): WorkspaceState {
  return {
    projectPath: visible ? FIXTURE.root : null,
    projectName: visible ? FIXTURE.name : null,
    lastOpenedAt: visible ? new Date().toISOString() : null,
    maxFileScanCount: 2500
  };
}

function buildBootState(mode: NonNullable<BridgeOptions["bootState"]>) {
  const now = Date.now();
  const finished = mode === "ready" || mode === "degraded";
  return {
    runId: "realcheck-boot",
    status: mode,
    currentPhaseId: finished ? null : "workspace-restore",
    overallProgress: finished ? 100 : 55,
    startedAt: now - 1_000,
    backendPid: 4242,
    backendPort: 8876,
    activeRuntimeSlot: "quality_cpu",
    residentModelId: "coder-test",
    detectedModelCount: 1,
    lastErrorMessage: mode === "degraded" ? "Optionaler Dienst fehlt." : null,
    phases: [
      {
        id: "frontend-bridge",
        label: "Frontend Bridge",
        state: "success",
        progress: 100,
        message: "IPC bereit.",
        dependencies: [],
        optional: false,
        blocksWindowRelease: false,
        pollCount: 0,
        retryCount: 0,
        details: [],
        startedAt: now - 1_000,
        finishedAt: now - 800
      },
      {
        id: "workspace-restore",
        label: "Workspace Restore",
        state: finished ? "success" : "running",
        progress: finished ? 100 : 40,
        message: finished ? "Workspace wiederhergestellt." : "Workspace wird geladen.",
        dependencies: ["frontend-bridge"],
        optional: false,
        blocksWindowRelease: false,
        pollCount: 0,
        retryCount: 0,
        details: [],
        startedAt: now - 700,
        finishedAt: finished ? now - 500 : undefined
      },
      {
        id: "main-window-rendered",
        label: "Main Window Rendered",
        state: finished ? "success" : "pending",
        progress: finished ? 100 : 0,
        message: finished ? "Renderer bereit." : "",
        dependencies: ["workspace-restore"],
        optional: false,
        blocksWindowRelease: true,
        pollCount: 0,
        retryCount: 0,
        details: [],
        startedAt: finished ? now - 400 : undefined,
        finishedAt: finished ? now - 300 : undefined
      },
      {
        id: "main-app-released",
        label: "Main App Released",
        state: finished ? "success" : "pending",
        progress: finished ? 100 : 0,
        message: finished ? "App freigegeben." : "",
        dependencies: ["main-window-rendered"],
        optional: false,
        blocksWindowRelease: true,
        pollCount: 0,
        retryCount: 0,
        details: [],
        startedAt: finished ? now - 250 : undefined,
        finishedAt: finished ? now - 200 : undefined
      }
    ]
  };
}

export async function installRealcheckBridge(page: Page, options: BridgeOptions = {}): Promise<void> {
  const initialFiles = options.initialWorkspaceFiles ?? FIXTURE.files;
  await page.addInitScript(
    ({ fixture, initialFiles, options, baseSettings, modelIndex, modelLabSources, modelLabModels }) => {
      const hooks: RealcheckHooks = {
        chatCalls: [],
        cancelCalls: 0,
        openedFiles: [],
        appliedPatches: [],
        rolledBackPatches: [],
        selectedWorkspaceCount: 0,
        settingsSaves: 0,
        modelLabScans: 0
      };
      (window as unknown as { __dbzsRealcheck: RealcheckHooks }).__dbzsRealcheck = hooks;

      const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const settings = { ...baseSettings };
      let workspaceState = workspaceStateFor(options.initialWorkspaceVisible !== false);
      let runtime = runtimeFor(options.runtimeState ?? "running");
      const bootState = buildBootState(options.bootState ?? "ready");
      let files = [...initialFiles];
      let streamCancelled = false;
      let patchVersion = 0;
      const restorePoints = new Map<string, Array<{ filePath: string; content: string | null }>>();
      const sources = modelLabSources.map((entry: ModelLabSource) => ({ ...entry }));
      const jobs: ModelLabScanJob[] = [];
      const models = modelLabModels.map((entry: ModelLabModel) => ({
        ...entry,
        bundle: { ...entry.bundle },
        artifacts: entry.artifacts.map((artifact) => ({ ...artifact }))
      }));
      const fileMap = new Map<string, string>(files.map((file: FixtureFileRecord) => [file.relativePath, file.content]));

      const toProjectFiles = () =>
        files.map((file: FixtureFileRecord) => ({
          path: `${fixture.root}/${file.relativePath}`,
          relativePath: file.relativePath,
          name: file.relativePath.split("/").pop() ?? file.relativePath,
          language: file.language
        }));

      const toRelativePath = (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const root = fixture.root.replace(/\\/g, "/");
        return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
      };

      const writeFile = (relativePath: string, content: string) => {
        fileMap.set(relativePath, content);
        const record: FixtureFileRecord = {
          relativePath,
          content,
          language:
            relativePath.endsWith(".ts") || relativePath.endsWith(".tsx")
              ? "typescript"
              : relativePath.endsWith(".json")
                ? "json"
                : relativePath.endsWith(".md")
                  ? "markdown"
                  : "plaintext"
        };
        const index = files.findIndex((entry: FixtureFileRecord) => entry.relativePath === relativePath);
        if (index >= 0) {
          files[index] = record;
        } else {
          files.push(record);
          files.sort((left: FixtureFileRecord, right: FixtureFileRecord) => left.relativePath.localeCompare(right.relativePath));
        }
      };

      const patchResponse = () =>
        JSON.parse(resolveMockResponse({ id: "patch-fix", mockResponseType: "patch-calculator-fix" })) as {
          changes: Array<{ filePath: string; proposedContent: string }>;
        };

      const assistantContent = (prompt: string) => {
        if (options.chatMode === "patch" || /patch|prüf|fix subtract/i.test(prompt)) {
          return resolveMockResponse({ id: "patch-fix", mockResponseType: "patch-calculator-fix" });
        }
        return `Mock-Antwort: ${prompt}`;
      };

      const noopSubscription = () => () => undefined;

      window.dbzs = {
        getAppInfo: async () => ({ name: "dbzs-realcheck", version: "0.0.0", platform: "test", backendUrl: settings.backendUrl }),
        getBackendHealth: async () => ({ status: "ok", app: "DBZS", version: "0.0.0" }),
        getBackendStartupStatus: async () => ({
          state: options.bootState === "degraded" ? "degraded" : options.bootState === "starting" ? "starting" : "ready",
          message: options.bootState === "degraded" ? "Optionaler Dienst fehlt." : options.bootState === "starting" ? "Backend startet …" : null,
          port: 8876,
          ownership: "self",
          instanceId: "realcheck-backend"
        }),
        onBackendStartupStatus: noopSubscription,
        getBootState: async () => bootState,
        onBootState: noopSubscription,
        reportBootPhaseState: async () => undefined,
        isBootSafeMode: async () => false,
        getSettings: async () => ({ ...settings }),
        updateSettings: async (next: AppSettings) => {
          Object.assign(settings, next, { revision: (settings.revision ?? 1) + 1 });
          hooks.settingsSaves += 1;
          return { ...settings };
        },
        patchSettings: async (request: { changes: Partial<AppSettings> }) => {
          Object.assign(settings, request.changes, { revision: (settings.revision ?? 1) + 1 });
          hooks.settingsSaves += 1;
          return { settings: { ...settings }, revision: settings.revision ?? 1 };
        },
        getSettingsDiagnostics: async () => ({ profile: "local", source: "mock", writable: true, dirty: false, diagnostics: [] }),
        getWorkspaceState: async () => ({ ...workspaceState }),
        setWorkspaceState: async (next: WorkspaceState) => {
          workspaceState = { ...workspaceState, ...next };
          return { ...workspaceState };
        },
        selectProjectDirectory: async () => {
          hooks.selectedWorkspaceCount += 1;
          workspaceState = { ...workspaceState, projectPath: fixture.root, projectName: fixture.name, lastOpenedAt: new Date().toISOString() };
          return { projectPath: fixture.root, projectName: fixture.name };
        },
        createNewProject: async () => null,
        scanProjectFiles: async () => {
          if (options.scanDelayMs) {
            await wait(options.scanDelayMs);
          }
          return workspaceState.projectPath ? toProjectFiles() : [];
        },
        readProjectFile: async (filePath: string) => {
          const relativePath = toRelativePath(filePath);
          const content = fileMap.get(relativePath);
          if (content == null) {
            return null;
          }
          hooks.openedFiles.push(relativePath);
          return {
            path: `${fixture.root}/${relativePath}`,
            name: relativePath.split("/").pop() ?? relativePath,
            language: relativePath.endsWith(".ts") || relativePath.endsWith(".tsx") ? "typescript" : "plaintext",
            content
          };
        },
        writeProjectFile: async (filePath: string, content: string) => {
          const relativePath = toRelativePath(filePath);
          writeFile(relativePath, content);
          return {
            path: `${fixture.root}/${relativePath}`,
            name: relativePath.split("/").pop() ?? relativePath,
            language: relativePath.endsWith(".ts") || relativePath.endsWith(".tsx") ? "typescript" : "plaintext",
            content
          };
        },
        openFileDialog: async () => null,
        saveFile: async (request: { path: string; content: string }) => {
          const relativePath = toRelativePath(request.path);
          writeFile(relativePath, request.content);
          return {
            path: `${fixture.root}/${relativePath}`,
            name: relativePath.split("/").pop() ?? relativePath,
            language: relativePath.endsWith(".ts") || relativePath.endsWith(".tsx") ? "typescript" : "plaintext",
            content: request.content
          };
        },
        normalizeWorkspaceContextPaths: async (_root: string, candidates: string[]) => candidates.map((entry) => toRelativePath(entry)),
        getModelIndex: async () => structuredClone(modelIndex),
        listModelLabSources: async () => structuredClone(sources),
        listModelLabJobs: async () => structuredClone(jobs),
        listModelLabModels: async () => structuredClone(models),
        runModelLabScan: async () => {
          hooks.modelLabScans += 1;
          const now = new Date().toISOString();
          sources.forEach((source) => {
            source.last_scan_at = now;
            source.last_scan_status = "completed";
            source.updated_at = now;
          });
          jobs.unshift({
            id: `scan-${hooks.modelLabScans}`,
            source_id: "source-1",
            status: "completed",
            progress_message: "Scan abgeschlossen",
            created_at: now,
            updated_at: now,
            completed_at: now,
            total_files: files.length,
            scanned_files: files.length,
            artifact_count: 1,
            bundle_count: 1,
            error: null
          });
          return { status: "queued", job_id: jobs[0].id };
        },
        getRuntimeStatus: async () => ({ ...runtime }),
        startRuntimeModel: async (modelId: string) => {
          runtime = { ...RUNNING_RUNTIME, model_id: modelId, model_name: modelId === "coder-test" ? "Coder Test" : modelId };
          return { ...runtime };
        },
        stopRuntimeModel: async () => {
          runtime = { ...STOPPED_RUNTIME };
          return { ...runtime };
        },
        sendRuntimeChat: async (request: { messages: Array<{ content?: string }> }) => {
          const prompt = String(request.messages.at(-1)?.content ?? "");
          hooks.chatCalls.push({ prompt });
          return {
            message: { role: "assistant", content: assistantContent(prompt) },
            model_id: "coder-test",
            model_name: "Coder Test"
          };
        },
        streamRuntimeChat: async (
          request: { messages: Array<{ content?: string }> },
          onChunk: (payload: { delta: string; totalLength: number }) => void
        ) => {
          const prompt = String(request.messages.at(-1)?.content ?? "");
          const content = assistantContent(prompt);
          hooks.chatCalls.push({ prompt });
          if (options.chatMode === "slow-stream") {
            streamCancelled = false;
            const chunks = [content.slice(0, Math.ceil(content.length / 2)), content.slice(Math.ceil(content.length / 2))];
            let sent = "";
            for (const chunk of chunks) {
              await wait(500);
              if (streamCancelled) {
                return { message: { role: "assistant", content: sent }, model_id: "coder-test", model_name: "Coder Test" };
              }
              sent += chunk;
              onChunk({ delta: chunk, totalLength: sent.length });
            }
            return { message: { role: "assistant", content }, model_id: "coder-test", model_name: "Coder Test" };
          }
          onChunk({ delta: content, totalLength: content.length });
          return { message: { role: "assistant", content }, model_id: "coder-test", model_name: "Coder Test" };
        },
        cancelRuntimeChatStream: async () => {
          streamCancelled = true;
          hooks.cancelCalls += 1;
          return { status: "cancelled" };
        },
        previewAgentPatch: async (proposal: { id: string; changes: Array<{ id: string; filePath: string; proposedContent: string; changeType: string }> }) => {
          patchVersion += 1;
          return {
            proposalId: proposal.id,
            approvalVersion: `v${patchVersion}`,
            state: "WAITING_FOR_APPROVAL",
            createdAt: new Date().toISOString(),
            previews: proposal.changes.map((change) => {
              const relativePath = toRelativePath(change.filePath);
              const beforeContent = fileMap.get(relativePath) ?? "";
              return {
                changeId: change.id,
                filePath: relativePath,
                changeType: change.changeType,
                snapshotId: `snapshot-${change.id}`,
                beforeContent,
                afterContent: change.proposedContent,
                diff: `--- ${relativePath}\n+++ ${relativePath}\n@@`
              };
            })
          };
        },
        approveAgentPatch: async (proposalId: string, approvalVersion: string) => ({
          proposalId,
          approvalVersion,
          state: "APPROVED",
          createdAt: new Date().toISOString(),
          previews: []
        }),
        rejectAgentPatch: async (proposalId: string) => ({
          proposalId,
          approvalVersion: `v${patchVersion}`,
          state: "REJECTED",
          createdAt: new Date().toISOString(),
          previews: []
        }),
        applyAgentPatch: async (proposalId: string) => {
          const applied = patchResponse();
          const restorePointId = `restore-${proposalId}`;
          restorePoints.set(
            restorePointId,
            applied.changes.map((change) => {
              const relativePath = toRelativePath(change.filePath);
              return { filePath: relativePath, content: fileMap.get(relativePath) ?? null };
            })
          );
          for (const change of applied.changes) {
            writeFile(toRelativePath(change.filePath), change.proposedContent);
          }
          hooks.appliedPatches.push(proposalId);
          return {
            proposalId,
            applied: true,
            state: "APPLIED",
            changedFiles: applied.changes.map((change) => toRelativePath(change.filePath)),
            deletedFiles: [],
            restorePointId,
            errors: []
          };
        },
        rollbackAgentPatch: async (restorePointId: string) => {
          for (const entry of restorePoints.get(restorePointId) ?? []) {
            if (entry.content != null) {
              writeFile(entry.filePath, entry.content);
            }
          }
          hooks.rolledBackPatches.push(restorePointId);
          return {
            proposalId: restorePointId,
            applied: true,
            state: "ROLLED_BACK",
            changedFiles: (restorePoints.get(restorePointId) ?? []).map((entry) => entry.filePath),
            deletedFiles: [],
            restorePointId,
            errors: []
          };
        },
        reloadBackend: async () => ({ status: "ok" }),
        openSettingsWindow: async () => ({ status: "ok" }),
        onRuntimeChatWindowState: noopSubscription,
        onRuntimeChatContext: noopSubscription,
        getRuntimeChatContext: async () => null,
        publishRuntimeChatContext: async () => ({ status: "ok" }),
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
        listJobs: async () => [],
        enqueueJob: async (request: { title: string; task_type?: string; priority?: number; assigned_agent_role?: string }) => ({
          id: "job-1",
          title: request.title,
          status: "queued",
          task_type: request.task_type,
          priority: request.priority,
          assigned_agent_role: request.assigned_agent_role,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      };
    },
    {
      fixture: { root: FIXTURE.root, name: FIXTURE.name },
      initialFiles,
      options,
      baseSettings: BASE_SETTINGS,
      modelIndex: MODEL_INDEX,
      modelLabSources: MODEL_LAB_SOURCES,
      modelLabModels: MODEL_LAB_MODELS
    }
  );
}

export async function getRealcheckHooks(page: Page): Promise<RealcheckHooks> {
  return page.evaluate(() => (window as unknown as { __dbzsRealcheck: RealcheckHooks }).__dbzsRealcheck);
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
}

export async function openNotebookTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
}

export function workspaceTree(page: Page) {
  return page.getByRole("tree", { name: "Workspace-Dateibaum" });
}

export function runtimeComposer(page: Page) {
  return page.getByRole("textbox", {
    name: /Analysiere, plane, debugge|Backend verbinden/i
  });
}

export async function sendChat(page: Page, prompt: string): Promise<void> {
  await openNotebookTab(page, "C@dee");
  await runtimeComposer(page).fill(prompt);
  await page.getByRole("button", { name: "Senden" }).click();
}
