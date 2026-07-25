import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { streamRuntimeChatViaBackend } from "./runtimeChatStream.js";
import { classifyRuntimeStreamError, shouldAttemptNonStreamFallback } from "./runtimeChatFallbackPolicy.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import type {
  AgentCreateRequest,
  AgentUpdateRequest,
  AppSettings,
  CommitAssistantContext,
  CommitMessageSuggestion,
  CommitRequest,
  CommitResult,
  DocsGenerateRequest,
  GitCommitSuggestion,
  GitDiffSummary,
  GitRepositoryStatus,
  GitStatusEntry,
  JobArtifactCreateRequest,
  JobClaimRequest,
  JobEnqueueRequest,
  JobStatus,
  JobVerifyRequest,
  JobWaypointRequest,
  ProjectMemoryUpsertRequest,
  TaskCreateRequest,
  TaskUpdateRequest,
  RuntimeChatRequest,
  RestorePoint,
  RestorePointReason,
  RestoreResult,
  ReviewArtifactSummary,
  SaveFileRequest,
  SaveFileAsRequest,
  ProjectCreationResult,
  WorkspaceFile,
  WorkspaceProjectFile,
  WorkspaceState,
  AgentWebSearchRequest,
  AgentWebFetchRequest,
  TerminalCommandRequest
} from "@dbzs/shared";
import {
  createProjectWorkflow,
  ensurePathInsideWorkspace,
  loadWorkspaceState,
  normalizeContextPathsForActiveWorkspace,
  saveWorkspaceState,
  scanProjectFiles,
  toResolvedPath,
  workspaceDefaults
} from "./workspaceService.js";
import { FileChangeService } from "./fileChangeService.js";
import { PatchPipelineService } from "./patchPipelineService.js";
import { CommandExecutionService } from "./commandExecutionService.js";
import { GitService } from "./gitService.js";
import { resolveCanonicalWorkspacePath } from "./workspacePathGuard.js";
import { CommitAssistantService } from "./commitAssistantService.js";
import { RestorePointService } from "./restorePointService.js";
import { AgentPatchCoordinator } from "./agentPatchCoordinator.js";
import { AgentWebResearchService } from "./webResearchService.js";
import {
  mergeFullSettingsUpdateForBackend,
  sanitizeSettingsForRenderer,
  sanitizeSettingsPatchResponse,
  stripRendererOnlySettings
} from "./settingsSecurity.js";
import { configureWindowSecurity } from "./windowSecurity.js";
import {
  BackendStartupService
} from "./backendStartupService.js";
import { promptTextInput as promptTextInputDialog } from "./promptInput.js";
import { SkillPackageService } from "./skillPackageService.js";
import { SkillRunPersistenceService } from "./skillRunPersistenceService.js";
import {
  buildToolFreeRuntimeChatFallbackRequest,
  shouldDisableNonStreamFallbackForRequest
} from "./runtimeChatFallback.js";
import { cleanupLingeringRuntimeArtifacts } from "./runtimeProcessCleanup.js";
import {
  listReviewArtifacts,
  resolveReviewArtifactFile,
  resolveReviewArtifactFolder
} from "./reviewArtifactService.js";
import type {
  ActiveSkillCapsule,
  CodeeSkillManifestV1,
  SkillArtifactWriteRequest,
  SkillRun,
  SkillRunValidation
} from "../src/runtime/skill/skillContracts.js";
import { BOOT_PHASE_DEFINITIONS } from "./boot/bootPhaseDefinitions.js";
import { BootOrchestrator } from "./boot/bootOrchestrator.js";
import { BackendReadinessProbe } from "./boot/backendReadinessProbe.js";
import { createPhaseRunners } from "./boot/phaseRunners.js";
import { registerBootEventBridge } from "./boot/bootEventBridge.js";
import { WindowCoordinator } from "./boot/windowCoordinator.js";
import { exportBootDiagnosticsToFile } from "./boot/bootDiagnosticExport.js";

const BACKEND_PORT = Number(process.env.DBZS_BACKEND_PORT ?? "8876");
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let runtimeChatWindow: BrowserWindow | null = null;
let platformDiagnosticsWindow: BrowserWindow | null = null;
let windowCoordinator: WindowCoordinator | undefined;
let orchestrator: BootOrchestrator | undefined;
let safeModeRequested = false;

interface RuntimeChatContextSnapshot {
  activeFile: WorkspaceFile | null;
  contextHint: string | null;
  workspaceRoot: string | null;
  workspaceName: string | null;
  workspaceFiles: WorkspaceProjectFile[];
}

let runtimeChatContext: RuntimeChatContextSnapshot | null = null;
let currentWorkspaceState: WorkspaceState = workspaceDefaults();
const restorePointService = new RestorePointService();
const fileChangeService = new FileChangeService({ restorePointService });
const patchPipelineService = new PatchPipelineService({ fileChangeService, restorePointService });
const agentPatchCoordinator = new AgentPatchCoordinator({ patchPipelineService, restorePointService });
const commandExecutionService = new CommandExecutionService();
const gitService = new GitService();
const commitAssistantService = new CommitAssistantService({ gitService, restorePointService });
const webResearchService = new AgentWebResearchService();
const skillRunPersistenceService = new SkillRunPersistenceService();
let lastDeletedWorkspacePath: { originalPath: string; trashedPath: string } | null = null;

function workspaceStatePath(): string {
  return path.join(app.getPath("userData"), "workspace-state.json");
}

function skillPackageService(): SkillPackageService {
  return new SkillPackageService(path.join(app.getPath("userData"), "skills"));
}


let backendStartup: BackendStartupService | undefined;

function initBackendStartup(): BackendStartupService {
  backendStartup = new BackendStartupService({
    port: BACKEND_PORT,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    devBackendCwd: backendCwd()
  });
  backendStartup.onStatusChange(() => {
    broadcastBackendStartupStatus();
  });
  return backendStartup;
}

function broadcastBackendStartupStatus(): void {
  if (!backendStartup) {
    return;
  }
  const status = backendStartup.getStatus();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("dbzs:backend:startup-status", status);
    }
  }
}

ipcMain.handle("dbzs:backend:reload", async () => {
  if (!backendStartup) {
    throw new Error("Backend-Startup ist noch nicht initialisiert.");
  }
  backendStartup.stop();
  await cleanupLingeringRuntimeArtifacts({
    backendPort: BACKEND_PORT,
    devUserDataDir: app.getPath("userData"),
    pruneTransientDirectories: false,
    log: (line) => console.log(`[runtime-cleanup] ${line}`)
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const result = await backendStartup.ensureStarted({ waitUntilReady: true });
  if (result.state !== "ready") {
    throw new Error(result.message ?? "Backend konnte nicht neu geladen werden.");
  }
  // Resident-model autostart now runs inside the backend's own lifespan
  // startup (boot phase 11), so the freshly (re)spawned process re-triggers
  // it itself — no separate Electron-side call needed here anymore.

  return { status: "reloaded", port: BACKEND_PORT };
});

ipcMain.handle("dbzs:frontend:restart", async () => {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.length === 0) {
    return { status: "noop", windows: 0 };
  }

  for (const window of windows) {
    setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.reloadIgnoringCache();
      }
    }, 100);
  }

  return { status: "reloading", windows: windows.length };
});

ipcMain.handle("dbzs:backend:startup-status", () => {
  if (!backendStartup) {
    return { state: "idle", message: null, port: BACKEND_PORT } as const;
  }
  return backendStartup.getStatus();
});

ipcMain.handle("dbzs:boot:is-safe-mode", () => safeModeRequested);

function configureDevStoragePaths(): void {
  if (app.isPackaged) {
    return;
  }

  const configuredDir = process.env.DBZS_DEV_USER_DATA_DIR?.trim();
  const devUserDataDir =
    configuredDir && configuredDir.length > 0
      ? configuredDir
      : path.join(app.getPath("temp"), "dbzs-codee-dev-user-data");

  app.setPath("userData", devUserDataDir);
  app.setPath("sessionData", path.join(devUserDataDir, "session"));
  app.setPath("cache", path.join(devUserDataDir, "cache"));
}

function backendCwd(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "backend");
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../backend");
}

type NodeFetchError = Error & { cause?: { code?: string } };

function isTransientBackendFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const nodeError = error as NodeFetchError;
  const code = nodeError.cause?.code;
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EPIPE") {
    return true;
  }

  return error.message.includes("fetch failed");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * P0 Phase 2: Endpoint-specific timeouts for Backend requests
 * - Status/health/info endpoints: 5s (quick checks)
 * - Runtime doctor: 60s (model index + launch plans for all models)
 * - Chat requests: no timeout (Frontend handles timeout via AbortSignal)
 * - Benchmark/long-running: 30m (generous for heavy workloads)
 * - Default: 10s
 */
function getEndpointTimeout(pathname: string): number {
  // Chat endpoints handled via Frontend timeout, no backend timeout
  if (pathname.includes("/runtime/chat")) {
    return 0; // 0 = no timeout, Frontend controls via AbortSignal
  }

  // Doctor builds full model index + per-model launch plans (can be slow on large catalogs).
  if (pathname.includes("/doctor")) {
    return 60_000;
  }

  // Status/health endpoints are quick
  if (pathname.includes("/status") || pathname.includes("/health")) {
    return 5_000; // 5s
  }

  // Benchmark/model-test is heavy
  if (pathname.includes("/benchmark") || pathname.includes("/model-test")) {
    return 30 * 60 * 1_000; // 30 minutes
  }

  // Default safe timeout
  return 10_000; // 10s
}

async function requestBackend<T>(pathname: string, init?: RequestInit): Promise<T> {
  let response: Response | null = null;
  let lastError: unknown = null;
  const endpointTimeout = getEndpointTimeout(pathname);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const fetchInit: RequestInit = {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {})
        }
      };

      // Only set timeout if > 0 (0 means no timeout, handled by Frontend)
      if (endpointTimeout > 0) {
        fetchInit.signal = AbortSignal.timeout(endpointTimeout);
      }

      response = await fetch(`${BACKEND_URL}${pathname}`, fetchInit);
      break;
    } catch (error) {
      lastError = error;
      if (!isTransientBackendFetchError(error) || attempt === 4) {
        throw error;
      }
      await delay(250);
    }
  }

  if (!response) {
    throw lastError instanceof Error ? lastError : new Error("Backend request failed.");
  }

  if (!response.ok) {
    let details = "";
    try {
      details = await response.text();
    } catch {
      details = "";
    }

    throw new Error(
      `Backend request failed: ${response.status} ${response.statusText}${details ? ` | ${details}` : ""}`
    );
  }

  return response.json() as Promise<T>;
}

async function gitTimeoutMs(): Promise<number> {
  const settings = await requestBackend<AppSettings>("/settings");
  return Math.max(1000, settings.maxAgentRuntimeSeconds * 1000);
}

function requireActiveWorkspace(workspaceRoot: string): string {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const resolvedRequested = toResolvedPath(workspaceRoot);
  const resolvedActive = toResolvedPath(currentWorkspaceState.projectPath);
  if (resolvedRequested !== resolvedActive) {
    throw new Error("[WORKSPACE_INVALID] Workspace-Zugriff ausserhalb des aktiven Workspace ist blockiert.");
  }

  return resolvedActive;
}

function isPathOutsideWorkspaceError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Path is outside of current workspace") ||
    error.message.includes("[WORKSPACE_INVALID]")
  );
}

function isRuntimeToolPayloadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (isRuntimeContextOverflowError(error)) {
    return false;
  }

  return (
    error.message.includes("HTTP Error 400") ||
    error.message.includes("llama-server request failed")
  );
}

function isRuntimeContextOverflowError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("exceeds the available context size") ||
    message.includes("context size") ||
    message.includes("n_ctx") ||
    message.includes("too many tokens")
  );
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
}

function buildRuntimeContextOverflowResponse(): {
  message: { id: string; role: "assistant"; content: string };
  model_id: string | null;
  model_name: string | null;
  safe_fallback: true;
  provider_error: {
    kind: "provider_error";
    code: string;
    stage: string;
    userMessage: string;
    retryable: boolean;
    correlationId: string;
  };
} {
  return buildRuntimeChatSafeResponse(
    "Die Anfrage ist größer als das aktuelle Runtime-Kontextfenster. Bitte weniger Datei-/Workspace-Kontext senden oder ein Runtime-Profil mit größerem Kontext starten.",
    "context_overflow"
  );
}

function buildRuntimeChatFallbackRequest(chatRequest: RuntimeChatRequest): RuntimeChatRequest {
  return buildToolFreeRuntimeChatFallbackRequest(chatRequest);
}

function buildRuntimeChatMinimalRequest(chatRequest: RuntimeChatRequest): RuntimeChatRequest {
  const lastUser = [...chatRequest.messages].reverse().find((message) => message.role === "user");
  const fallbackUserMessage = lastUser ?? { id: `msg-${Date.now().toString(36)}-fallback`, role: "user", content: "Bitte antworte kurz und direkt." };

  return {
    messages: [fallbackUserMessage],
    max_tokens: 256,
    temperature: 0.2,
    file_context: null,
    model_id: chatRequest.model_id,
    slot_id: chatRequest.slot_id,
    fallback_policy: chatRequest.fallback_policy,
    provider: chatRequest.provider,
    routing_reason: chatRequest.routing_reason,
    decision_id: chatRequest.decision_id,
  };
}

function buildRuntimeChatSafeResponse(
  message: string,
  code:
    | "context_overflow"
    | "model_unavailable"
    | "slot_busy"
    | "invalid_request"
    | "connection_failed"
    | "provider_internal_error"
    | "timeout" = "provider_internal_error"
): {
  message: { id: string; role: "assistant"; content: string };
  model_id: string | null;
  model_name: string | null;
  safe_fallback: true;
  provider_error: {
    kind: "provider_error";
    code: string;
    stage: string;
    userMessage: string;
    retryable: boolean;
    correlationId: string;
  };
} {
  return {
    message: {
      id: `msg-${Date.now().toString(36)}-safe`,
      role: "assistant",
      content: message,
    },
    model_id: null,
    model_name: null,
    safe_fallback: true,
    provider_error: {
      kind: "provider_error",
      code,
      stage: "stream_read",
      userMessage: message,
      retryable: false,
      correlationId: `safe-${Date.now().toString(36)}`,
    },
  };
}

function stopBackend(): void {
  backendStartup?.stop();
}

function rendererFileRootUrl(): string {
  return pathToFileURL(path.join(__dirname, "../renderer")).toString().replace(/\/?$/, "/");
}

function configureDbzsWindowSecurity(window: BrowserWindow): void {
  configureWindowSecurity(
    window,
    {
      allowedFileRoot: rendererFileRootUrl(),
      devRendererUrl: process.env.ELECTRON_RENDERER_URL
    },
    (url) => shell.openExternal(url)
  );
}

async function getRendererSafeSettings(settings?: AppSettings): Promise<AppSettings> {
  const rawSettings = settings ?? await requestBackend<AppSettings>("/settings");
  const diagnostics = await requestBackend<{
    effectiveSources?: Record<string, string>;
  }>("/settings/diagnostics").catch(() => null);
  return sanitizeSettingsForRenderer({
    ...rawSettings,
    openaiConfigured: diagnostics?.effectiveSources?.openaiApiKey !== undefined
      && diagnostics.effectiveSources.openaiApiKey !== "default",
    anthropicConfigured: diagnostics?.effectiveSources?.anthropicApiKey !== undefined
      && diagnostics.effectiveSources.anthropicApiKey !== "default"
  });
}

function getWindowCoordinator(): WindowCoordinator {
  if (!windowCoordinator) {
    windowCoordinator = new WindowCoordinator({
      preloadPath: path.join(__dirname, "../preload/preload.js"),
      rendererIndexPath: path.join(__dirname, "../renderer/index.html"),
      devRendererUrl: process.env.ELECTRON_RENDERER_URL,
      configureWindowSecurity: configureDbzsWindowSecurity
    });
  }
  return windowCoordinator;
}

/**
 * Creates the main window HIDDEN and starts it loading immediately in the
 * background. It is only ever shown by windowCoordinator.releaseMainWindow(),
 * once the BootOrchestrator run resolves "ready"/"degraded" — this used to
 * show the window unconditionally and immediately (bug: the app appeared
 * "live" long before the backend had even been spawned).
 */
function createWindow(): void {
  getWindowCoordinator().createMainWindowHidden();
  mainWindow = getWindowCoordinator().getMainWindow();
}

function broadcastRuntimeChatWindowState(open: boolean): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("dbzs:runtime-chat:window-state", { open });
    }
  }
}

function broadcastRuntimeChatContext(context: RuntimeChatContextSnapshot | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("dbzs:runtime-chat:context", context);
    }
  }
}

function openRuntimeChatWindow(): void {
  if (runtimeChatWindow && !runtimeChatWindow.isDestroyed()) {
    runtimeChatWindow.show();
    runtimeChatWindow.focus();
    return;
  }

  runtimeChatWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    useContentSize: true,
    backgroundColor: "#070b10",
    title: "DBZS Runtime Chat",
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  configureDbzsWindowSecurity(runtimeChatWindow);

  runtimeChatWindow.on("closed", () => {
    runtimeChatWindow = null;
    broadcastRuntimeChatWindowState(false);
  });

  runtimeChatWindow.once("ready-to-show", () => {
    runtimeChatWindow?.show();
    runtimeChatWindow?.focus();
  });

  runtimeChatWindow.webContents.on("did-finish-load", () => {
    broadcastRuntimeChatWindowState(true);
    if (runtimeChatContext) {
      runtimeChatWindow?.webContents.send("dbzs:runtime-chat:context", runtimeChatContext);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.split("#")[0]?.split("?")[0] ?? process.env.ELECTRON_RENDERER_URL;
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    void runtimeChatWindow.loadURL(`${normalizedBase}/?view=runtime-chat#runtime-chat`);
  } else {
    void runtimeChatWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      query: { view: "runtime-chat" },
      hash: "runtime-chat"
    });
  }
}

function closeRuntimeChatWindow(): void {
  if (runtimeChatWindow && !runtimeChatWindow.isDestroyed()) {
    runtimeChatWindow.close();
  }
}

function openPlatformDiagnosticsWindow(): void {
  if (platformDiagnosticsWindow && !platformDiagnosticsWindow.isDestroyed()) {
    platformDiagnosticsWindow.show();
    platformDiagnosticsWindow.focus();
    return;
  }

  platformDiagnosticsWindow = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    useContentSize: true,
    backgroundColor: "#070b10",
    title: "DBZS Plattform-Diagnose",
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  configureDbzsWindowSecurity(platformDiagnosticsWindow);

  platformDiagnosticsWindow.on("closed", () => {
    platformDiagnosticsWindow = null;
  });

  platformDiagnosticsWindow.once("ready-to-show", () => {
    platformDiagnosticsWindow?.show();
    platformDiagnosticsWindow?.focus();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.split("#")[0]?.split("?")[0] ?? process.env.ELECTRON_RENDERER_URL;
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    void platformDiagnosticsWindow.loadURL(`${normalizedBase}/?view=platform-diagnostics#platform-diagnostics`);
  } else {
    void platformDiagnosticsWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      query: { view: "platform-diagnostics" },
      hash: "platform-diagnostics"
    });
  }
}

function closePlatformDiagnosticsWindow(): void {
  if (platformDiagnosticsWindow && !platformDiagnosticsWindow.isDestroyed()) {
    platformDiagnosticsWindow.close();
  }
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 860,
    minWidth: 720,
    minHeight: 600,
    useContentSize: true,
    backgroundColor: "#070b10",
    title: "DBZS Settings",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  configureDbzsWindowSecurity(settingsWindow);

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#settings`);
  } else {
    void settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      hash: "settings"
    });
  }
}

function sendMenuAction(action: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("dbzs:menu:action", action);
  }
}

function configureAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Datei",
      submenu: [
        {
          label: "Neues Projekt…",
          accelerator: "CommandOrControl+Shift+N",
          click: () => sendMenuAction("new-project")
        },
        {
          label: "Projekt öffnen…",
          accelerator: "CommandOrControl+Shift+O",
          click: () => sendMenuAction("open-project")
        },
        { type: "separator" },
        {
          label: "Neue Datei…",
          accelerator: "CommandOrControl+N",
          click: () => sendMenuAction("new-file")
        },
        {
          label: "Neuer Ordner…",
          accelerator: "CommandOrControl+Shift+Alt+N",
          click: () => sendMenuAction("new-folder")
        },
        { type: "separator" },
        {
          label: "Datei öffnen…",
          accelerator: "CommandOrControl+O",
          click: () => sendMenuAction("open-file")
        },
        { type: "separator" },
        {
          label: "Speichern",
          accelerator: "CommandOrControl+S",
          click: () => sendMenuAction("save-file")
        },
        {
          label: "Speichern unter…",
          accelerator: "CommandOrControl+Shift+S",
          click: () => sendMenuAction("save-file-as")
        },
        { type: "separator" },
        {
          label: "Workspace speichern",
          click: () => sendMenuAction("save-workspace")
        },
        { type: "separator" },
        {
          label: "Runtime Chat",
          accelerator: "CommandOrControl+Shift+R",
          click: () => openRuntimeChatWindow()
        },
        {
          label: "Plattform-Diagnose",
          accelerator: "CommandOrControl+Shift+D",
          click: () => openPlatformDiagnosticsWindow()
        },
        {
          label: "Einstellungen",
          accelerator: "CommandOrControl+,",
          click: () => openSettingsWindow()
        },
        {
          role: "quit"
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".css": "css",
    ".html": "html",
    ".js": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".py": "python",
    ".tsx": "typescript",
    ".ts": "typescript",
    ".toml": "ini",
    ".yaml": "yaml",
    ".yml": "yaml"
  };

  return map[extension] ?? "plaintext";
}

async function readWorkspaceFile(filePath: string): Promise<WorkspaceFile> {
  const content = await fs.readFile(filePath, "utf-8");
  return {
    path: filePath,
    name: path.basename(filePath),
    content,
    language: detectLanguage(filePath)
  };
}

async function promptTextInput(request: { title: string; label: string; value: string; confirmText?: string; cancelText?: string }): Promise<string | null> {
  return promptTextInputDialog(request, mainWindow);
}

ipcMain.handle("dbzs:app-info", () => ({
  name: "DBZS Code Assistant",
  version: app.getVersion(),
  backendUrl: BACKEND_URL
}));

ipcMain.handle("dbzs:backend-health", () => requestBackend("/health"));
ipcMain.handle("dbzs:settings:get", async () => {
  return getRendererSafeSettings();
});
ipcMain.handle("dbzs:settings:update", async (_event, settings: AppSettings) => {
  const current = await requestBackend<AppSettings>("/settings");
  const update = mergeFullSettingsUpdateForBackend(settings, current);
  const saved = await requestBackend<AppSettings>("/settings", {
    method: "PUT",
    body: JSON.stringify(update)
  });
  return getRendererSafeSettings(saved);
});
ipcMain.handle("dbzs:settings:patch", async (_event, request: unknown) => {
  const body =
    request && typeof request === "object" && "changes" in request
      ? {
          ...(request as Record<string, unknown>),
          changes: stripRendererOnlySettings((request as { changes: AppSettings }).changes)
        }
      : request;
  const response = await requestBackend<{
    settings: AppSettings;
    revision: number;
    appliedKeys: string[];
    restartRequirements: Record<string, string>;
  }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  const safeSettings = await getRendererSafeSettings(response.settings);
  return sanitizeSettingsPatchResponse({ ...response, settings: safeSettings });
});
ipcMain.handle("dbzs:settings:diagnostics", () => requestBackend("/settings/diagnostics"));
ipcMain.handle("dbzs:models:index", () => requestBackend("/models/index"));
ipcMain.handle("dbzs:runtime:status", () => requestBackend("/runtime/status"));
ipcMain.handle("dbzs:runtime:start", (_event, modelId: string) =>
  requestBackend("/runtime/start", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId })
  })
);
ipcMain.handle("dbzs:runtime:stop", () =>
  requestBackend("/runtime/stop", {
    method: "POST",
    body: JSON.stringify({})
  })
);

const activeRuntimeChatAbortControllers = new Map<string, AbortController>();

ipcMain.handle("dbzs:runtime:chat", async (_event, chatRequest: RuntimeChatRequest, requestId?: string) => {
  const normalizedRequestId =
    typeof requestId === "string" && requestId.trim().length > 0
      ? requestId.trim()
      : `runtime-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const abortController = new AbortController();
  activeRuntimeChatAbortControllers.set(normalizedRequestId, abortController);
  try {
    return await requestBackend("/runtime/chat", {
      method: "POST",
      body: JSON.stringify(chatRequest),
      signal: abortController.signal,
    });
  } catch (error) {
    if (abortController.signal.aborted || isAbortError(error)) {
      throw error;
    }

    if (isRuntimeContextOverflowError(error)) {
      return buildRuntimeContextOverflowResponse();
    }

    if (!isRuntimeToolPayloadError(error)) {
      return buildRuntimeChatSafeResponse(
        "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen."
      );
    }

    const fallbackRequest = buildRuntimeChatFallbackRequest(chatRequest);
    try {
      return await requestBackend("/runtime/chat", {
        method: "POST",
        body: JSON.stringify(fallbackRequest),
        signal: abortController.signal,
      });
    } catch {
      if (abortController.signal.aborted) {
        throw new Error("aborted");
      }

      try {
        const minimalRequest = buildRuntimeChatMinimalRequest(chatRequest);
        return await requestBackend("/runtime/chat", {
          method: "POST",
          body: JSON.stringify(minimalRequest),
          signal: abortController.signal,
        });
      } catch (minimalError) {
        if (abortController.signal.aborted || isAbortError(minimalError)) {
          throw minimalError;
        }
        return buildRuntimeChatSafeResponse("Runtime hat die Anfrage abgelehnt (HTTP 400). Bitte kuerzere Eingabe oder Runtime-Profil pruefen.");
      }
    }
  } finally {
    activeRuntimeChatAbortControllers.delete(normalizedRequestId);
  }
});

let activeChatStreamAbortController: AbortController | null = null;

ipcMain.handle("dbzs:runtime:chat-stream:cancel", () => {
  if (activeChatStreamAbortController) {
    activeChatStreamAbortController.abort();
    activeChatStreamAbortController = null;
  }
  return { status: "ok" };
});

ipcMain.handle("dbzs:runtime:chat:cancel", (_event: Electron.IpcMainInvokeEvent, requestId: string) => {
  const normalizedRequestId = typeof requestId === "string" ? requestId.trim() : "";
  if (!normalizedRequestId) {
    return { status: "invalid_request_id" };
  }

  const active = activeRuntimeChatAbortControllers.get(normalizedRequestId);
  if (!active) {
    return { status: "not_found" };
  }

  active.abort();
  activeRuntimeChatAbortControllers.delete(normalizedRequestId);
  return { status: "cancelled" };
});

ipcMain.handle("dbzs:runtime:chat-stream", async (event, chatRequest: RuntimeChatRequest) => {
  // Requirement 4: Streaming Abort over Electron
  if (activeChatStreamAbortController) {
    activeChatStreamAbortController.abort();
  }
  activeChatStreamAbortController = new AbortController();
  const streamSignal = activeChatStreamAbortController.signal;
  const sendStreamChunk = (payload: { delta: string; totalLength: number }) => {
    if (!streamSignal.aborted) {
      event.sender.send("dbzs:runtime:chat-stream-chunk", payload);
    }
  };

  try {
    try {
      const result = await streamRuntimeChatViaBackend(BACKEND_URL, chatRequest, (chunk) => {
        sendStreamChunk(chunk);
      }, streamSignal);
      return result;
    } catch (error) {
      // P0 Phase 3: Explicit error classification and retry policy
      if (streamSignal.aborted) {
        return {
          message: { id: `msg-${Date.now().toString(36)}-cancelled`, role: "assistant", content: "" },
          model_id: null,
          model_name: null
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const streamErrorMeta = classifyRuntimeStreamError(error);
      const isToolError = streamErrorMeta.isToolError;
      const isContextOverflow = streamErrorMeta.isContextOverflow || isRuntimeContextOverflowError(error);
      const isTimeout = streamErrorMeta.isTimeout || errorMessage.includes("Timeout") || errorMessage.includes("timeout");
      const isTransport = streamErrorMeta.isTransport;

      // 1. Timeout errors: NO RETRY (Frontend already waited 60s)
      // Never stream error text as model deltas — return structured safe_fallback only.
      if (isTimeout) {
        return buildRuntimeChatSafeResponse(
          "Modell antwortet nicht (Timeout). Bitte später erneut versuchen oder kürzere Anfrage stellen.",
          "timeout"
        );
      }

      if (isContextOverflow) {
        return buildRuntimeContextOverflowResponse();
      }

      // 2. Transport errors: TRY ONCE without tools (HTTP 400 or connection issues)
      if (
        shouldAttemptNonStreamFallback(streamErrorMeta) &&
        !shouldDisableNonStreamFallbackForRequest(chatRequest)
      ) {
        try {
          const fallbackRequest = buildRuntimeChatFallbackRequest(chatRequest);
          const fallback = await requestBackend<{
            message: { role: "assistant"; content: string };
            model_id: string | null;
            model_name: string | null;
          }>("/runtime/chat", {
            method: "POST",
            body: JSON.stringify(fallbackRequest),
            signal: streamSignal
          });

          if (fallback.message.content) {
            sendStreamChunk({
              delta: fallback.message.content,
              totalLength: fallback.message.content.length,
            });
          }

          return fallback;
        } catch (fallbackError) {
          if (streamSignal.aborted || isAbortError(fallbackError)) {
            throw fallbackError;
          }

          // Fallback failed: give up, send safe response (no error-as-delta)
          return buildRuntimeChatSafeResponse(
            isToolError
              ? "Runtime hat die Anfrage abgelehnt. Bitte ohne Tools oder mit weniger Kontext erneut senden."
              : "Verbindung unterbrochen. Bitte Nachricht erneut senden.",
            isToolError ? "invalid_request" : "connection_failed"
          );
        }
      }

      // 3. Other errors: NO RETRY, structured safe response only (no stream delta)
      return buildRuntimeChatSafeResponse(
        "Runtime konnte die Anfrage nicht ausführen. Bitte Diagnose-Log prüfen.",
        "provider_internal_error"
      );
    }
  } finally {
    if (activeChatStreamAbortController?.signal === streamSignal) {
      activeChatStreamAbortController = null;
    }
  }
});

ipcMain.handle("dbzs:runtime:benchmark", () =>
  requestBackend("/runtime/benchmark", {
    method: "POST",
    body: JSON.stringify({})
  })
);

ipcMain.handle("dbzs:runtime:model-test", () =>
  requestBackend("/runtime/model-test", {
    method: "POST",
    body: JSON.stringify({})
  })
);
ipcMain.handle("dbzs:runtime:doctor", () => requestBackend("/runtime/doctor"));
ipcMain.handle("dbzs:runtime:doctor-dry-run", (_event, payload: { model_id: string; profile_name?: string | null }) =>
  requestBackend("/runtime/doctor/dry-run", {
    method: "POST",
    body: JSON.stringify(payload)
  })
);
ipcMain.handle("dbzs:runtime:doctor-probe", (_event, payload: { allow_start: boolean; model_id?: string | null }) =>
  requestBackend("/runtime/doctor/probe", {
    method: "POST",
    body: JSON.stringify(payload)
  })
);
ipcMain.handle("dbzs:runtime:logs", () => requestBackend("/runtime/logs"));
ipcMain.handle("dbzs:orchestration:tools", () => requestBackend("/orchestration/tools"));
ipcMain.handle("dbzs:orchestration:prepare", (_event, request: unknown) =>
  requestBackend("/orchestration/context/prepare", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:orchestration:execute", (_event, request: unknown) =>
  requestBackend("/orchestration/tools/execute", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:job-spooler:list", (_event, status?: JobStatus, limit?: number) => {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  const query = params.toString();
  return requestBackend(`/job-spooler${query ? `?${query}` : ""}`);
});
ipcMain.handle("dbzs:job-spooler:enqueue", (_event, request: JobEnqueueRequest) =>
  requestBackend("/job-spooler/enqueue", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:job-spooler:claim", (_event, request: JobClaimRequest) =>
  requestBackend("/job-spooler/claim", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:job-spooler:detail", (_event, jobId: string) =>
  requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/detail`)
);
ipcMain.handle("dbzs:job-spooler:waypoint", (_event, jobId: string, request: JobWaypointRequest) =>
  requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/waypoints`, {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:job-spooler:artifact", (_event, jobId: string, request: JobArtifactCreateRequest) =>
  requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/artifacts`, {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:job-spooler:verify", (_event, jobId: string, request: JobVerifyRequest) =>
  requestBackend(`/job-spooler/${encodeURIComponent(jobId)}/verify`, {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:job-spooler:requeue-stale", () =>
  requestBackend("/job-spooler/requeue-stale", {
    method: "POST",
    body: JSON.stringify({})
  })
);
ipcMain.handle("dbzs:job-spooler:clear-all", () =>
  requestBackend("/job-spooler/clear-all", {
    method: "POST",
    body: JSON.stringify({})
  })
);
ipcMain.handle("dbzs:job-spooler:prune-finished", () =>
  requestBackend("/job-spooler/prune-finished", {
    method: "POST",
    body: JSON.stringify({})
  })
);
ipcMain.handle("dbzs:trajectories:job", (_event, jobId: string) =>
  requestBackend(`/trajectories/jobs/${encodeURIComponent(jobId)}`)
);
ipcMain.handle("dbzs:trajectories:recent", (_event, limit = 100) =>
  requestBackend(`/trajectories/recent?limit=${encodeURIComponent(String(limit))}`)
);
ipcMain.handle("dbzs:agent-runner:status", () => requestBackend("/agent-runner/status"));
ipcMain.handle(
  "dbzs:agent-runner:run-once",
  (
    _event,
    request: { agent_id: string; workspace_root?: string | null; supported_roles?: string[] }
  ) =>
    requestBackend("/agent-runner/run-once", {
      method: "POST",
      body: JSON.stringify(request)
    })
);
ipcMain.handle("dbzs:agents:list", () => requestBackend("/agents"));
ipcMain.handle("dbzs:agents:get", (_event, agentId: string) => requestBackend(`/agents/${agentId}`));
ipcMain.handle("dbzs:agents:create", (_event, request: AgentCreateRequest) =>
  requestBackend("/agents", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:agents:update", (_event, agentId: string, request: AgentUpdateRequest) =>
  requestBackend(`/agents/${agentId}`, {
    method: "PUT",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:agents:start", (_event, agentId: string) =>
  requestBackend(`/agents/${agentId}/start`, {
    method: "POST",
    body: JSON.stringify({})
  })
);
ipcMain.handle("dbzs:agents:stop", (_event, agentId: string) =>
  requestBackend(`/agents/${agentId}/stop`, {
    method: "POST",
    body: JSON.stringify({})
  })
);
ipcMain.handle("dbzs:agents:delete", (_event, agentId: string) =>
  requestBackend(`/agents/${agentId}`, {
    method: "DELETE"
  })
);
ipcMain.handle("dbzs:agents:logs", (_event, agentId: string, limit = 100) =>
  requestBackend(`/agents/${agentId}/logs?limit=${encodeURIComponent(String(limit))}`)
);
ipcMain.handle("dbzs:project-memory:list", (_event, workspace: string) =>
  requestBackend(`/project-memory?workspace=${encodeURIComponent(workspace)}`)
);
ipcMain.handle("dbzs:project-memory:upsert", (_event, request: ProjectMemoryUpsertRequest) =>
  requestBackend("/project-memory", {
    method: "PUT",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:project-memory:delete", (_event, entryId: number) =>
  requestBackend(`/project-memory/${entryId}`, {
    method: "DELETE"
  })
);
ipcMain.handle("dbzs:task-board:list", () => requestBackend("/task-board"));
ipcMain.handle("dbzs:task-board:create", (_event, request: TaskCreateRequest) =>
  requestBackend("/task-board", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:task-board:update", (_event, taskId: string, request: TaskUpdateRequest) =>
  requestBackend(`/task-board/${taskId}`, {
    method: "PUT",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:task-board:delete", (_event, taskId: string) =>
  requestBackend(`/task-board/${taskId}`, {
    method: "DELETE"
  })
);
ipcMain.handle("dbzs:docs:analyze", (_event, workspaceRoot: string, maxFiles = 5) =>
  requestBackend(`/docs/analyze?workspace_root=${encodeURIComponent(workspaceRoot)}&max_files=${encodeURIComponent(String(maxFiles))}`)
);
ipcMain.handle("dbzs:docs:generate", (_event, request: DocsGenerateRequest) =>
  requestBackend("/docs/generate", {
    method: "POST",
    body: JSON.stringify(request)
  })
);
ipcMain.handle("dbzs:settings:open-window", () => {
  openSettingsWindow();
  return { status: "ok" };
});

ipcMain.handle("dbzs:runtime-chat:open-window", () => {
  openRuntimeChatWindow();
  return { status: "ok" };
});

ipcMain.handle("dbzs:runtime-chat:close-window", () => {
  closeRuntimeChatWindow();
  return { status: "ok" };
});

ipcMain.handle("dbzs:platform-diagnostics:open-window", () => {
  openPlatformDiagnosticsWindow();
  return { status: "ok" };
});

ipcMain.handle("dbzs:platform-diagnostics:close-window", () => {
  closePlatformDiagnosticsWindow();
  return { status: "ok" };
});

ipcMain.handle("dbzs:runtime-chat:publish-context", (_event, context: RuntimeChatContextSnapshot) => {
  runtimeChatContext = context;
  broadcastRuntimeChatContext(context);
  return { status: "ok" };
});

ipcMain.handle("dbzs:runtime-chat:get-context", () => runtimeChatContext);

ipcMain.handle("dbzs:skills:reload", async (_event, workspaceRoot?: string) => {
  const activeRoot = workspaceRoot ? requireActiveWorkspace(workspaceRoot) : undefined;
  return skillPackageService().reload(activeRoot);
});

ipcMain.handle("dbzs:skills:import", async () => {
  if (!mainWindow) throw new Error("Main window is not available.");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Skill-Ordner importieren",
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  return skillPackageService().importDirectory(result.filePaths[0]!);
});

ipcMain.handle(
  "dbzs:skill-runs:save",
  async (
    _event,
    workspaceRoot: string,
    run: SkillRun,
    manifest: CodeeSkillManifestV1,
    capsules: ActiveSkillCapsule[],
    instructions: string,
    validation?: SkillRunValidation
  ) => skillRunPersistenceService.save(
    requireActiveWorkspace(workspaceRoot),
    run,
    manifest,
    capsules,
    instructions,
    validation
  )
);

ipcMain.handle("dbzs:skill-runs:list", (_event, workspaceRoot: string) =>
  skillRunPersistenceService.list(requireActiveWorkspace(workspaceRoot))
);

ipcMain.handle(
  "dbzs:skill-runs:artifact",
  (_event, workspaceRoot: string, request: SkillArtifactWriteRequest) =>
    skillRunPersistenceService.writeArtifact(requireActiveWorkspace(workspaceRoot), request)
);

ipcMain.handle(
  "dbzs:skill-runs:approve-artifacts",
  (_event, workspaceRoot: string, skillRunId: string) =>
    skillRunPersistenceService.approveArtifactWrites(
      requireActiveWorkspace(workspaceRoot),
      skillRunId
    )
);

ipcMain.handle(
  "dbzs:skill-runs:set-status",
  (
    _event,
    workspaceRoot: string,
    skillRunId: string,
    status: "awaiting_user" | "cancelled"
  ) => skillRunPersistenceService.setStatus(
    requireActiveWorkspace(workspaceRoot),
    skillRunId,
    status
  )
);

ipcMain.handle("dbzs:workspace:select-project-directory", async () => {
  if (!mainWindow) {
    throw new Error("Main window is not available.");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Projektordner oeffnen",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectPath = toResolvedPath(result.filePaths[0]);
  return {
    projectPath,
    projectName: path.basename(projectPath)
  };
});

ipcMain.handle("dbzs:workspace:create-new-project", async () => {
  if (!mainWindow) {
    throw new Error("Main window is not available.");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Neues Projekt - Zielordner waehlen",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectName = (await promptTextInput({
    title: "Neues Projekt",
    label: "Projektname",
    value: "dbzs-neues-projekt"
  }))?.trim();

  if (!projectName) {
    return null;
  }

  const workflow = await promptTextInput({
    title: "Projekt-Workflow",
    label: "Workflow: dbzs-typescript, python-runtime oder empty",
    value: "dbzs-typescript"
  });

  if (workflow === null) {
    return null;
  }

  return createProjectWorkflow(result.filePaths[0], projectName, workflow);
});

ipcMain.handle("dbzs:workspace:scan-project-files", async (_event, projectPath: string) => {
  const resolvedProjectPath = toResolvedPath(projectPath);
  if (currentWorkspaceState.projectPath && toResolvedPath(currentWorkspaceState.projectPath) !== resolvedProjectPath) {
    throw new Error("Scan denied for non-active workspace.");
  }

  return scanProjectFiles(resolvedProjectPath, currentWorkspaceState.maxFileScanCount);
});

ipcMain.handle("dbzs:workspace:normalize-context-paths", (event, workspaceRoot: string, candidates: string[]) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const trustedWindows = [mainWindow, runtimeChatWindow, platformDiagnosticsWindow, settingsWindow]
    .filter((window): window is BrowserWindow => Boolean(window) && !window!.isDestroyed());
  if (!senderWindow || senderWindow.isDestroyed() || !trustedWindows.includes(senderWindow)) {
    throw new Error("[WORKSPACE_INVALID] Context path normalization denied for unknown window.");
  }
  return normalizeContextPathsForActiveWorkspace(currentWorkspaceState.projectPath, workspaceRoot, candidates);
});

ipcMain.handle("dbzs:workspace:read-project-file", async (_event, filePath: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const safePath = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, filePath);
  try {
    return await readWorkspaceFile(safePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
});

ipcMain.handle(
  "dbzs:reviews:list-artifacts",
  async (_event, workspaceRoot: string): Promise<ReviewArtifactSummary[]> =>
    listReviewArtifacts(currentWorkspaceState.projectPath, workspaceRoot)
);

ipcMain.handle(
  "dbzs:reviews:open-artifact",
  async (
    _event,
    workspaceRoot: string,
    reviewId: string,
    kind: "report" | "findings"
  ): Promise<WorkspaceFile> => {
    const filePath = await resolveReviewArtifactFile(
      currentWorkspaceState.projectPath,
      workspaceRoot,
      reviewId,
      kind
    );
    return readWorkspaceFile(filePath);
  }
);

ipcMain.handle(
  "dbzs:reviews:reveal-artifacts",
  async (_event, workspaceRoot: string, reviewId: string): Promise<{ status: string }> => {
    const folder = await resolveReviewArtifactFolder(
      currentWorkspaceState.projectPath,
      workspaceRoot,
      reviewId
    );
    const error = await shell.openPath(folder);
    if (error) throw new Error(`[REVIEW_ARTIFACT_OPEN_FAILED] ${error}`);
    return { status: "ok" };
  }
);

ipcMain.handle("dbzs:workspace:write-project-file", async (_event, filePath: string, content: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const lexicalPath = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, filePath);
  await fs.mkdir(path.dirname(lexicalPath), { recursive: true });
  const safePath = await resolveCanonicalWorkspacePath(
    currentWorkspaceState.projectPath,
    lexicalPath,
    { allowMissing: true }
  );
  const temporaryPath = `${safePath}.codee-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf-8", flag: "wx" });
    await fs.rename(temporaryPath, safePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return readWorkspaceFile(safePath);
});

ipcMain.handle("dbzs:workspace:create-folder", async (_event, folderPath: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const safePath = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, folderPath);
  await fs.mkdir(safePath, { recursive: true });
  return { path: safePath };
});

ipcMain.handle("dbzs:workspace:rename-path", async (_event, sourcePath: string, destinationPath: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const safeSource = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, sourcePath);
  const safeDestination = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, destinationPath);

  await fs.mkdir(path.dirname(safeDestination), { recursive: true });
  await fs.rename(safeSource, safeDestination);
  return { from: safeSource, to: safeDestination };
});

ipcMain.handle("dbzs:workspace:delete-path", async (_event, targetPath: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const safeTarget = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, targetPath);
  const trashRoot = path.join(app.getPath("userData"), "workspace-trash");
  await fs.mkdir(trashRoot, { recursive: true });
  const trashedPath = path.join(trashRoot, `${Date.now()}-${path.basename(safeTarget)}`);
  await fs.rename(safeTarget, trashedPath);
  lastDeletedWorkspacePath = {
    originalPath: safeTarget,
    trashedPath
  };

  return { hasUndo: true };
});

ipcMain.handle("dbzs:workspace:restore-last-deleted", async () => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  if (!lastDeletedWorkspacePath) {
    return { restoredPath: null };
  }

  const restoreTarget = ensurePathInsideWorkspace(currentWorkspaceState.projectPath, lastDeletedWorkspacePath.originalPath);
  await fs.mkdir(path.dirname(restoreTarget), { recursive: true });
  await fs.rename(lastDeletedWorkspacePath.trashedPath, restoreTarget);
  lastDeletedWorkspacePath = null;
  return { restoredPath: restoreTarget };
});

ipcMain.handle("dbzs:workspace:undo-last-write", async (_event, filePath: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  return fileChangeService.undoPatch(currentWorkspaceState.projectPath, filePath);
});

ipcMain.handle("dbzs:shell:open-in-explorer", async (_event, targetPath?: string) => {
  const pathToOpen = targetPath && targetPath.length > 0
    ? targetPath
    : currentWorkspaceState.projectPath;
  if (!pathToOpen) {
    throw new Error("No path available to open.");
  }

  const resolvedTarget = await resolveCanonicalWorkspacePath(
    currentWorkspaceState.projectPath ?? pathToOpen,
    pathToOpen,
    { allowMissing: true }
  );
  await shell.openPath(resolvedTarget);
  return { status: "ok" };
});

ipcMain.handle("dbzs:ui:prompt-text-input", async (_event, request: { title: string; label: string; value: string }) => {
  return promptTextInput(request);
});

ipcMain.handle("dbzs:terminal:exec", async (_event, request: TerminalCommandRequest) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const run = await commandExecutionService.executeStructuredCommand(currentWorkspaceState.projectPath, request);
  const logs = commandExecutionService.streamCommandLogs(run.runId);
  return {
    stdout: logs.stdout,
    stderr: logs.stderr,
    code: run.exitCode ?? 1
  };
});

const terminalSessions = new Map<string, ChildProcessWithoutNullStreams>();

ipcMain.handle("dbzs:terminal:session:start", async (_event, sessionId: string, cwd?: string) => {
  if (terminalSessions.has(sessionId)) {
    return { started: false, reason: "session_exists" };
  }

  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
  const requestedCwd = cwd && cwd.length > 0 ? cwd : (currentWorkspaceState.projectPath ?? process.cwd());
  const safeCwd = await resolveCanonicalWorkspacePath(
    currentWorkspaceState.projectPath ?? requestedCwd,
    requestedCwd,
    { allowMissing: true }
  );

  const child = spawn(shell, [], {
    cwd: safeCwd,
    shell: false,
    windowsHide: true,
    env: { ...process.env, TERM: "xterm-256color" }
  }) as ChildProcessWithoutNullStreams;

  terminalSessions.set(sessionId, child);

  child.stdout.on("data", (chunk: Buffer) => {
    mainWindow?.webContents.send("dbzs:terminal:output", sessionId, chunk.toString("utf-8"), "stdout");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    mainWindow?.webContents.send("dbzs:terminal:output", sessionId, chunk.toString("utf-8"), "stderr");
  });
  child.on("exit", (code) => {
    terminalSessions.delete(sessionId);
    mainWindow?.webContents.send("dbzs:terminal:exit", sessionId, code ?? -1);
  });

  return { started: true };
});

ipcMain.handle("dbzs:terminal:session:write", (_event, sessionId: string, input: string) => {
  const child = terminalSessions.get(sessionId);
  if (!child) {
    return { written: false };
  }
  child.stdin.write(input);
  return { written: true };
});

ipcMain.handle("dbzs:terminal:session:kill", (_event, sessionId: string) => {
  const child = terminalSessions.get(sessionId);
  if (child) {
    child.kill();
    terminalSessions.delete(sessionId);
  }
  return { killed: true };
});

ipcMain.handle("dbzs:commands:allowed", () => {
  commandExecutionService.setWorkspaceRoot(currentWorkspaceState.projectPath);
  return commandExecutionService.listAllowedCommands();
});

ipcMain.handle("dbzs:commands:execute", async (_event, workspaceRoot: string, commandId: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  const resolvedRequested = toResolvedPath(workspaceRoot);
  const resolvedActive = toResolvedPath(currentWorkspaceState.projectPath);
  if (resolvedRequested !== resolvedActive) {
    throw new Error("[WORKSPACE_INVALID] Command execution outside active workspace is blocked.");
  }

  commandExecutionService.setWorkspaceRoot(currentWorkspaceState.projectPath);
  const settings = await requestBackend<AppSettings>("/settings");
  const timeoutMs = Math.max(1000, settings.maxAgentRuntimeSeconds * 1000);
  return commandExecutionService.executeCommand(currentWorkspaceState.projectPath, commandId, timeoutMs);
});

ipcMain.handle("dbzs:commands:cancel", (_event, runId: string) => {
  commandExecutionService.setWorkspaceRoot(currentWorkspaceState.projectPath);
  return commandExecutionService.cancelCommand(runId);
});

ipcMain.handle("dbzs:commands:status", (_event, runId: string) => {
  commandExecutionService.setWorkspaceRoot(currentWorkspaceState.projectPath);
  return commandExecutionService.getCommandRunStatus(runId);
});

ipcMain.handle("dbzs:commands:logs", (_event, runId: string) => {
  commandExecutionService.setWorkspaceRoot(currentWorkspaceState.projectPath);
  return commandExecutionService.streamCommandLogs(runId);
});

ipcMain.handle("dbzs:research:search", async (_event, request: AgentWebSearchRequest) => {
  return webResearchService.search(request);
});

ipcMain.handle("dbzs:research:fetch", async (_event, request: AgentWebFetchRequest) => {
  return webResearchService.fetch(request);
});

ipcMain.handle("dbzs:git:repository-status", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return gitService.getRepositoryStatus(workspace, await gitTimeoutMs()) as Promise<GitRepositoryStatus>;
});

ipcMain.handle("dbzs:git:current-branch", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  const isRepo = await gitService.validateGitRepository(workspace, await gitTimeoutMs());
  if (!isRepo) return "";
  return gitService.getCurrentBranch(workspace, await gitTimeoutMs());
});

ipcMain.handle("dbzs:git:changed-files", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  const isRepo = await gitService.validateGitRepository(workspace, await gitTimeoutMs());
  if (!isRepo) return [];
  return gitService.getChangedFiles(workspace, await gitTimeoutMs()) as Promise<GitStatusEntry[]>;
});

ipcMain.handle("dbzs:git:diff", async (_event, workspaceRoot: string, filePath?: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  const isRepo = await gitService.validateGitRepository(workspace, await gitTimeoutMs());
  if (!isRepo) return "";
  try {
    return await gitService.getDiff(workspace, await gitTimeoutMs(), filePath);
  } catch (error) {
    if (isPathOutsideWorkspaceError(error)) {
      return "";
    }
    throw error;
  }
});

ipcMain.handle("dbzs:git:diff-summary", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return gitService.getDiffSummary(workspace, await gitTimeoutMs()) as Promise<GitDiffSummary[]>;
});

ipcMain.handle("dbzs:git:commit-suggestion", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  const isRepo = await gitService.validateGitRepository(workspace, await gitTimeoutMs());
  if (!isRepo) return null;
  const diffSummary = await gitService.getDiffSummary(workspace, await gitTimeoutMs());
  return gitService.suggestCommitMessage(diffSummary) as Promise<GitCommitSuggestion>;
});

ipcMain.handle("dbzs:git:validate-repository", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return gitService.validateGitRepository(workspace, await gitTimeoutMs());
});

ipcMain.handle(
  "dbzs:commit-assistant:suggestions",
  async (_event, workspaceRoot: string, context?: CommitAssistantContext) => {
    const workspace = requireActiveWorkspace(workspaceRoot);
    return commitAssistantService.suggestCommitMessages(workspace, context) as Promise<CommitMessageSuggestion[]>;
  }
);

ipcMain.handle("dbzs:commit-assistant:validate", async (_event, workspaceRoot: string, request: CommitRequest) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  await commitAssistantService.validateCommitRequest(workspace, request);
  return { valid: true };
});

ipcMain.handle("dbzs:commit-assistant:create", async (_event, workspaceRoot: string, request: CommitRequest) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return commitAssistantService.createCommit(workspace, request) as Promise<CommitResult>;
});

ipcMain.handle(
  "dbzs:restore-points:create",
  async (
    _event,
    workspaceRoot: string,
    filePaths: string[],
    reason: RestorePointReason,
    label: string,
    options?: { relatedRunId?: string; relatedChangeIds?: string[] }
  ) => {
    const workspace = requireActiveWorkspace(workspaceRoot);
    return restorePointService.createRestorePoint(workspace, filePaths, reason, label, options) as Promise<RestorePoint>;
  }
);

ipcMain.handle("dbzs:restore-points:list", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return restorePointService.listRestorePoints(workspace) as Promise<RestorePoint[]>;
});

ipcMain.handle("dbzs:restore-points:restore", async (_event, workspaceRoot: string, restorePointId: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return restorePointService.restorePoint(workspace, restorePointId) as Promise<RestoreResult>;
});

ipcMain.handle("dbzs:restore-points:delete", async (_event, workspaceRoot: string, restorePointId: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return restorePointService.deleteRestorePoint(workspace, restorePointId);
});

ipcMain.handle("dbzs:restore-points:cleanup", async (_event, workspaceRoot: string) => {
  const workspace = requireActiveWorkspace(workspaceRoot);
  return restorePointService.cleanupOldRestorePoints(workspace);
});

ipcMain.handle("dbzs:workspace:file-change:create-snapshot", async (_event, filePath: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  return fileChangeService.createSnapshot(currentWorkspaceState.projectPath, filePath);
});

ipcMain.handle("dbzs:workspace:file-change:create-diff", async (_event, filePath: string, proposedContent: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  return fileChangeService.createDiff(currentWorkspaceState.projectPath, filePath, proposedContent);
});

ipcMain.handle(
  "dbzs:workspace:file-change:apply-patch",
  async (
    _event,
    filePath: string,
    newContent: string,
    snapshotId?: string,
    restoreOptions?: {
      reason?: RestorePointReason;
      label?: string;
      relatedRunId?: string;
      relatedChangeIds?: string[];
    }
  ) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

    return fileChangeService.applyChange(
      currentWorkspaceState.projectPath,
      filePath,
      newContent,
      snapshotId,
      restoreOptions
    );
  }
);

ipcMain.handle("dbzs:workspace:file-change:restore-snapshot", async (_event, snapshotId: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }

  return fileChangeService.restoreSnapshot(currentWorkspaceState.projectPath, snapshotId);
});

ipcMain.handle(
  "dbzs:workspace:patch-pipeline:preview",
  async (_event, filePath: string, proposedContent: string) => {
    if (!currentWorkspaceState.projectPath) {
      throw new Error("No active workspace configured.");
    }
    return patchPipelineService.createPatchPreview(
      currentWorkspaceState.projectPath,
      filePath,
      proposedContent
    );
  }
);

ipcMain.handle(
  "dbzs:workspace:patch-pipeline:apply",
  async (
    _event,
    filePath: string,
    proposedContent: string,
    reason?: RestorePointReason
  ) => {
    if (!currentWorkspaceState.projectPath) {
      throw new Error("No active workspace configured.");
    }
    return patchPipelineService.applyPatchWithRestorePoint(
      currentWorkspaceState.projectPath,
      filePath,
      proposedContent,
      reason ?? "before_patch"
    );
  }
);

ipcMain.handle(
  "dbzs:workspace:patch-pipeline:rollback",
  async (_event, restorePointId: string) => {
    if (!currentWorkspaceState.projectPath) {
      throw new Error("No active workspace configured.");
    }
    return patchPipelineService.rollbackPatch(currentWorkspaceState.projectPath, restorePointId);
  }
);

ipcMain.handle("dbzs:agent-patch:preview", async (_event, proposal) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }
  return agentPatchCoordinator.createPreview(currentWorkspaceState.projectPath, proposal);
});

ipcMain.handle("dbzs:agent-patch:approve", async (_event, proposalId: string, approvalVersion: string) =>
  agentPatchCoordinator.approveProposal(proposalId, approvalVersion)
);

ipcMain.handle("dbzs:agent-patch:reject", async (_event, proposalId: string) =>
  agentPatchCoordinator.rejectProposal(proposalId)
);

ipcMain.handle("dbzs:agent-patch:apply", async (_event, proposalId: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }
  return agentPatchCoordinator.applyApprovedProposal(currentWorkspaceState.projectPath, proposalId);
});

ipcMain.handle("dbzs:agent-patch:rollback", async (_event, restorePointId: string) => {
  if (!currentWorkspaceState.projectPath) {
    throw new Error("No active workspace configured.");
  }
  return agentPatchCoordinator.rollback(currentWorkspaceState.projectPath, restorePointId);
});

ipcMain.handle("dbzs:workspace:get-state", () => currentWorkspaceState);
ipcMain.handle("dbzs:workspace:set-state", async (_event, state: WorkspaceState) => {
  const nextState: WorkspaceState = {
    ...currentWorkspaceState,
    ...state,
    projectPath: state.projectPath ? toResolvedPath(state.projectPath) : null,
    projectName: state.projectName ?? (state.projectPath ? path.basename(state.projectPath) : null),
    maxFileScanCount: state.maxFileScanCount > 0 ? state.maxFileScanCount : currentWorkspaceState.maxFileScanCount
  };

  currentWorkspaceState = nextState;
  commandExecutionService.setWorkspaceRoot(nextState.projectPath);
  await saveWorkspaceState(workspaceStatePath(), currentWorkspaceState);
  return currentWorkspaceState;
});

ipcMain.handle("dbzs:file:open-dialog", async () => {
  if (!mainWindow) {
    throw new Error("Main window is not available.");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Datei oeffnen",
    properties: ["openFile"],
    filters: [
      { name: "Code und Text", extensions: ["ts", "tsx", "js", "json", "py", "md", "txt", "css", "html", "toml", "yaml", "yml"] },
      { name: "Alle Dateien", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return readWorkspaceFile(result.filePaths[0]);
});

ipcMain.handle("dbzs:file:save", async (_event, request: SaveFileRequest) => {
  await fs.writeFile(request.path, request.content, "utf-8");
  return readWorkspaceFile(request.path);
});

ipcMain.handle("dbzs:file:save-as-dialog", async (_event, request: SaveFileAsRequest) => {
  if (!mainWindow) {
    throw new Error("Main window is not available.");
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Speichern unter",
    defaultPath: request.defaultPath,
    filters: [
      { name: "Code und Text", extensions: ["ts", "tsx", "js", "json", "py", "md", "txt", "css", "html", "toml", "yaml", "yml"] },
      { name: "Alle Dateien", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  const targetPath = toResolvedPath(result.filePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, request.content, "utf-8");
  return readWorkspaceFile(targetPath);
});

configureDevStoragePaths();

app.whenReady().then(async () => {
  const cleanupReport = await cleanupLingeringRuntimeArtifacts({
    backendPort: BACKEND_PORT,
    devUserDataDir: app.getPath("userData"),
    pruneTransientDirectories: true,
    log: (line) => console.log(`[runtime-cleanup] ${line}`)
  });
  if (cleanupReport.killedPids.length > 0 || cleanupReport.prunedDirectories.length > 0) {
    console.log(
      `[runtime-cleanup] startup killed=${cleanupReport.killedPids.join(",") || "-"} pruned=${cleanupReport.prunedDirectories.length}`
    );
  }
  const startup = initBackendStartup();
  const probe = new BackendReadinessProbe(BACKEND_URL);
  configureAppMenu();

  // Loaded eagerly (not only inside the "local-config" phase runner) so it is
  // available the instant the hidden main window's renderer starts firing
  // IPC calls — the renderer begins loading in parallel with the boot
  // sequence below, it does not wait for phase 2 to reach it first.
  currentWorkspaceState = await loadWorkspaceState(workspaceStatePath());
  commandExecutionService.setWorkspaceRoot(currentWorkspaceState.projectPath);

  const coordinator = getWindowCoordinator();
  coordinator.createSplashWindow();
  createWindow(); // hidden — starts loading in the background immediately

  const runners = createPhaseRunners({
    backendStartup: startup,
    probe,
    userDataDir: app.getPath("userData"),
    loadLocalConfig: async () => {
      // Work already performed above, eagerly — this phase just confirms it.
    },
    onBackendPid: (pid) => orchestrator?.patchHud({ backendPid: pid }),
    onDetectedModelCount: (count) => orchestrator?.patchHud({ detectedModelCount: count }),
    onResidentModelId: (id) => orchestrator?.patchHud({ residentModelId: id })
  });

  orchestrator = new BootOrchestrator(BOOT_PHASE_DEFINITIONS, runners);
  orchestrator.patchHud({ backendPort: BACKEND_PORT });

  registerBootEventBridge({
    orchestrator,
    getWindows: () => coordinator.getAllWindows(),
    backendPort: BACKEND_PORT,
    restartBackendProcess: async () => {
      startup.stop();
      await cleanupLingeringRuntimeArtifacts({
        backendPort: BACKEND_PORT,
        devUserDataDir: app.getPath("userData"),
        pruneTransientDirectories: false,
        log: (line) => console.log(`[runtime-cleanup] ${line}`)
      });
    },
    exportDiagnostics: () =>
      exportBootDiagnosticsToFile(
        coordinator.getSplashWindow() ?? coordinator.getMainWindow(),
        orchestrator!.getState(),
        app.getVersion()
      ),
    requestSafeMode: () => {
      safeModeRequested = true;
    },
    quitApp: () => app.quit()
  });

  const finalState = await orchestrator.run();
  if (finalState.status === "ready" || finalState.status === "degraded") {
    await coordinator.releaseMainWindow();
  }
  // "failed": splash stays open — BootErrorPanel (driven by pushed BootState) shows the failure and retry/diagnostic actions instead of releasing the main window.

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void getWindowCoordinator().releaseMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let isQuitting = false;

app.on("before-quit", async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;

    try {
      const settings = await requestBackend<AppSettings>("/settings").catch(() => null);
      if (backendStartup && backendStartup.getStatus().state === "ready" && settings?.stopDesktopRuntimesOnExit !== false) {
        console.log("[Electron] Initiating clean shutdown of backend runtimes...");
        // Stop model profiles if any
        await requestBackend("/model-profiles/stop", { method: "POST" }).catch(() => {});
        // Stop default runtime if any
        await requestBackend("/runtime/stop", { method: "POST" }).catch(() => {});
        // Wait a moment for processes to exit
        await delay(500);
      }
    } catch (error) {
      console.error("[Electron] Error during clean backend shutdown:", error);
    } finally {
      stopBackend();
      await cleanupLingeringRuntimeArtifacts({
        backendPort: BACKEND_PORT,
        devUserDataDir: app.getPath("userData"),
        pruneTransientDirectories: false,
        log: (line) => console.log(`[runtime-cleanup] ${line}`)
      });
      app.quit();
    }
  }
});
