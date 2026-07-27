import {
  type BackendStartupStatus,
  type RuntimeChatMessage,
  type RuntimeStatus,
  type WorkspaceFile,
  type WorkspaceProjectFile,
  workspaceScopeId
} from "@dbzs/shared";
import React, { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useRuntimeChatApprovalStore } from "@/stores/runtimeChatApprovalStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { closeRuntimeChatWindow, openRuntimeChatWindow } from "@/utils/runtimeChatWindow";
import { RuntimeChatApprovals, useRuntimeChatPendingApprovalCount } from "@/components/RuntimeChatApprovals";
import { RuntimeChatActivityPanel } from "@/components/RuntimeChatActivityPanel";
import { RuntimeChatPatchPanel } from "@/components/RuntimeChatPatchPanel";
import { RuntimeChatResearchPanel } from "@/components/RuntimeChatResearchPanel";
import { RuntimeChatToolCardList } from "@/components/RuntimeChatToolCard";
import { RuntimeModelTestPanel } from "@/components/RuntimeModelTestPanel";
import { RuntimeChatToolsBar } from "@/components/RuntimeChatToolsBar";
import { RuntimeSlotPanel } from "@/components/RuntimeSlotPanel";
import {
  getRuntimeAgentActionsForMessage,
  getTransportActionTone,
  getTransportChatActions,
  hasPendingRuntimeActionKind,
  isRejectTransportAction
} from "@/services/runtimeChatActionSelectors";
import { buildWorkspaceContext } from "@/services/runtimeChatContext";
import { insertMention, suggestMentionPaths } from "@/services/runtimeChatContextMentions";
import { agentLabel } from "@/services/runtimeChatActivityHelpers";
import { useEditorStore } from "@/stores/editorStore";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import { CodeeRunLiveBlock } from "@/components/chat/CodeeRunLiveBlock";
import { codeIndexService } from "@/services/codeIndexService";
import { RoutingDiagnosticsCard } from "@/components/RoutingDiagnosticsCard";
import {
  formatLazyRuntimeStatusLabel,
  isWorkModelLoaded,
  looksLikeOrchestratorModel
} from "@/services/lazyRuntimePolicy";
import {
  detachActiveTaskContract,
  restoreActiveTaskContract
} from "@/services/activeTaskContract";
import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";
import { formatBootStateForUi } from "@/services/bootUiFormatter";
import { TokenBudgetVisualizer } from "./TokenBudgetVisualizer";

interface RuntimeChatTabProps {
  activeFile: WorkspaceFile | null;
  status: RuntimeStatus | null;
  backendStartupStatus?: BackendStartupStatus | null;
  workspaceRoot: string | null;
  workspaceName: string | null;
  workspaceFiles: WorkspaceProjectFile[];
  contextHint?: string | null;
  compact?: boolean;
  detached?: boolean;
}

export function RuntimeChatTab({
  activeFile,
  compact = false,
  contextHint = null,
  detached = false,
  status,
  backendStartupStatus = null,
  workspaceRoot,
  workspaceName,
  workspaceFiles
}: RuntimeChatTabProps) {
  const {
    cancelSend,
    clear,
    compactConversation,
    currentActivity,
    error,
    isSending,
    isStreaming,
    lastRouting,
    messages,
    sendMessage,
    sendPresetPrompt,
    toolProfile,
    setToolProfile,
    activeRun,
    historicalRuns
  } = useRuntimeChatStore();
  const [draft, setDraft] = useState("");
  const [contextNote, setContextNote] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showPanels, setShowPanels] = useState(false);
  const [showSlotPanel, setShowSlotPanel] = useState(false);
  const [chatMode, setChatMode] = useState<"auto" | "agent">("auto");
  const [selectedProvider, setSelectedProvider] = useState("llama.cpp");
  const [availableProviders, setAvailableProviders] = useState<string[]>(["llama.cpp", "ollama", "antigravity"]);
  const [includeWorkspaceContext, setIncludeWorkspaceContext] = useState(true);
  const mentionSuggestions = useMemo(() => {
    const at = draft.lastIndexOf("@");
    if (at < 0) return [];
    const token = draft.slice(at + 1).split(/\s/)[0] ?? "";
    if (!token || !workspaceFiles.length) return [];
    const query = token.replace(/^file:|^folder:/, "");
    return suggestMentionPaths(query, workspaceFiles, 6);
  }, [draft, workspaceFiles]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const queueProposedChanges = useEditorStore((state) => state.queueProposedChanges);
  const requestTakeoverApproval = useRuntimeChatApprovalStore((state) => state.requestTakeoverApproval);
  const pendingApprovalCount = useRuntimeChatPendingApprovalCount(workspaceRoot);
  const previousWorkspaceRootRef = useRef(workspaceRoot);

  useEffect(() => {
    // Rückfragen (inkl. Resource-Risk A/B/C) liegen im Panel — bei offenen Fragen automatisch einblenden.
    if (pendingApprovalCount > 0) {
      setShowPanels(true);
    }
  }, [pendingApprovalCount]);
  const settings = useSettingsStore((state) => state.settings);
  const activeActivity = useRuntimeChatStore((state) => state.currentActivity ?? state.lastActivity);
  const workspaceContextStep = activeActivity?.steps.find((step) => step.id === "workspace-context");

  const lastBrokerDecision = useRuntimeChatStore((state) => state.lastBrokerDecision);
  // Lazy Runtime: Chat darf senden sobald Backend-Status bekannt ist (auch stopped).
  const runtimeReady = status != null;
  const workModelReady = isWorkModelLoaded(status) && !looksLikeOrchestratorModel(status);

  const workspaceChipLabel = useMemo(() => {
    if (!workspaceRoot) {
      return "—";
    }
    const name = workspaceName ?? "WS";
    if (workspaceFiles.length === 0) {
      return `${name} · 0 Dateien im Scan`;
    }
    return `${name} · ${workspaceFiles.length} Dateien im Scan`;
  }, [workspaceFiles.length, workspaceName, workspaceRoot]);

  const contextReadinessHint = useMemo(() => {
    if (!includeWorkspaceContext) {
      return "Kontext aus";
    }
    if (!workspaceRoot) {
      return "Kein Workspace geoeffnet";
    }
    if (workspaceFiles.length === 0) {
      return detached
        ? "Detached: Dateiliste nicht synchronisiert — Hauptfenster fokussieren oder Chat im Panel nutzen"
        : "Dateiscan leer — Projekt neu oeffnen oder scannen";
    }
    return null;
  }, [detached, includeWorkspaceContext, workspaceFiles.length, workspaceRoot]);

  const statusLabel = useMemo(() => {
    // PRIORITÄT 6: Backend-Status vereinheitlichen.
    // Der Status wird nun ausschließlich aus dem zentralen Boot-State abgeleitet.
    const bootStateLabel = formatBootStateForUi(backendStartupStatus);

    if (isSending && activeRun && !activeRun.firstTokenAt) {
      const currentStep = activeRun.events[activeRun.events.length - 1];
      return currentStep?.message ?? "Wird ausgeführt...";
    }

    if (lastRouting?.modelName) {
      const agent = agentLabel(lastRouting.targetAgent);
      return `${bootStateLabel} · ${agent} · ${lastRouting.modelName}`;
    }

    return bootStateLabel;
  }, [activeRun, backendStartupStatus, isSending, lastRouting]);

  const sendOptions = {
    includeWorkspaceContext,
    workspaceRoot,
    workspaceName,
    workspaceFiles,
    contextHint,
    indexedFileCount: codeIndexService.getIndexedFiles().length,
    toolProfile,
    agentMode: chatMode,
    provider: selectedProvider
  };

  useEffect(() => {
    useRuntimeChatApprovalStore.getState().switchWorkspace(workspaceRoot);
  }, []);

  useEffect(() => {
    if (previousWorkspaceRootRef.current === workspaceRoot) return;
    const previousRoot = previousWorkspaceRootRef.current;
    previousWorkspaceRootRef.current = workspaceRoot;
    cancelSend();
    clear();
    detachActiveTaskContract(previousRoot);
    restoreActiveTaskContract(workspaceRoot);
    useRuntimeChatApprovalStore.getState().switchWorkspace(workspaceRoot);
    setShowPanels(false);
    setContextNote(null);
  }, [cancelSend, clear, workspaceRoot]);

  useEffect(() => {
    if (status?.provider && ["llama.cpp", "ollama", "antigravity"].includes(status.provider)) {
      setSelectedProvider(status.provider);
    }
  }, [status?.provider]);

  useEffect(() => {
    let cancelled = false;
    const backendUrl = settings.backendUrl?.trim() || "http://127.0.0.1:8876";

    const loadProviders = async () => {
      try {
        const response = await fetch(`${backendUrl}/runtime/providers`);
        if (!response.ok) {
          throw new Error(`Provider request failed: ${response.status}`);
        }
        const data = await response.json();
        if (Array.isArray(data)) {
          const normalized = data.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
          if (!cancelled) {
            setAvailableProviders(normalized);
          }
        }
      } catch {
        if (!cancelled) {
          setAvailableProviders(["llama.cpp", "ollama", "antigravity"]);
        }
      }
    };

    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, [settings.backendUrl]);

  useEffect(() => {
    if (availableProviders.length > 0 && !availableProviders.includes(selectedProvider)) {
      setSelectedProvider(availableProviders[0]);
    }
  }, [availableProviders, selectedProvider]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const anchor = messagesEndRef.current;
    if (!container || !anchor) {
      return;
    }
    const isNearBottom = anchor.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom < 120;
    if (isNearBottom || isSending || isStreaming) {
      anchor.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth", block: "end" });
    }
  }, [currentActivity?.steps.length, isSending, isStreaming, messages.length]);

  const submitMessage = () => {
    const text = draft;
    if (text.trim().length === 0) return;
    setDraft("");
    setShowPanels(true);

    void (async () => {
      const payload = chatMode === "agent" ? `[Agent Mode]\n${text}` : text;
      const sent = await sendMessage(
        payload,
        status,
        activeFile,
        null,
        contextHint,
        chatMode === "agent" ? "coder" : "runtime_chat",
        sendOptions
      );
      if (sent) {
        const activity = useRuntimeChatStore.getState().lastActivity;
        const workspaceStep = activity?.steps.find((step) => step.id === "workspace-context");
        if (workspaceStep) {
          const detail = workspaceStep.detail?.split("\n").find(Boolean) ?? workspaceStep.label;
          setContextNote(`Kontext: ${detail}`);
        } else {
          setContextNote("Anfrage gesendet.");
        }
      }
    })();
  };

  const applyAssistantProposal = (proposal: string) => {
    if (isSending || !workspaceRoot) {
      return;
    }
    void (async () => {
      const contextResult = includeWorkspaceContext
        ? await buildWorkspaceContext(workspaceRoot, workspaceName, workspaceFiles, activeFile)
        : { context: null, sampledCount: 0, failedCount: 0 };
      requestTakeoverApproval({
        proposal,
        workspaceRoot,
        workspaceContext: contextResult.context,
        activeFile
      });
      setContextNote("Freigabe angefordert.");
      setShowPanels(true);
    })();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!isSending && runtimeReady && draft.trim().length > 0) {
      submitMessage();
    }
  };

  const embeddedInPanel = compact && !detached;
  const shellClass = embeddedInPanel
    ? "border border-dbzs-border bg-dbzs-panelSoft"
    : compact
    ? "flex h-full min-h-0 flex-col overflow-hidden border border-dbzs-border bg-dbzs-panelSoft"
    : "mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden border border-dbzs-border bg-dbzs-panelSoft";

  const chatContent = (
    <>
          {/* Kompakte Kopfzeile */}
          <div className="flex items-center gap-2 border-b border-dbzs-border bg-dbzs-panel px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-dbzs-text">Runtime Chat</div>
            <div className="truncate text-[10px] text-dbzs-muted">{statusLabel}</div>
            {activeActivity ? (
              <div className="mt-0.5 flex items-center gap-1 text-[9px] text-dbzs-cyan">
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-dbzs-cyan" />
                <span>{workspaceContextStep?.detail ?? activeActivity.steps.find((step) => step.status === "running")?.label ?? activeActivity.summary ?? "Aktivität läuft"}</span>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <select
              className="rounded border border-dbzs-border bg-dbzs-panelSoft px-1.5 py-0.5 text-[10px] text-dbzs-text"
              onChange={(event) => setSelectedProvider(event.target.value)}
              value={selectedProvider}
              title="Provider für die Chat-Anfrage"
            >
              {availableProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
            {pendingApprovalCount > 0 ? (
              <span className="rounded border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-1.5 py-0.5 text-[10px] text-dbzs-cyan">
                {pendingApprovalCount}
              </span>
            ) : null}
            <button
              className={`border px-1.5 py-0.5 text-[10px] ${showPanels ? "border-dbzs-cyan/50 text-dbzs-cyan" : "border-dbzs-border text-dbzs-muted"}`}
              onClick={() => setShowPanels((v) => !v)}
              type="button"
            >
              Panel
            </button>
            <button
              className={`border px-1.5 py-0.5 text-[10px] ${showSlotPanel ? "border-dbzs-cyan/50 text-dbzs-cyan" : "border-dbzs-border text-dbzs-muted"}`}
              onClick={() => setShowSlotPanel((v) => !v)}
              type="button"
              title="Runtime Slots verwalten"
            >
              Slots
            </button>
            {!compact ? (
              <button
                className={`border px-1.5 py-0.5 text-[10px] ${showDiagnostics ? "border-dbzs-cyan/50 text-dbzs-cyan" : "border-dbzs-border text-dbzs-muted"}`}
                onClick={() => setShowDiagnostics((v) => !v)}
                type="button"
              >
                Diagnose
              </button>
            ) : null}
            {detached ? (
              <button className="border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted" onClick={() => void closeRuntimeChatWindow()} type="button">
                ✕
              </button>
            ) : (
              <button className="border border-dbzs-cyan/40 bg-dbzs-cyan/10 px-1.5 py-0.5 text-[10px] text-dbzs-cyan" onClick={() => void openRuntimeChatWindow()} type="button">
                ↗
              </button>
            )}
            <button className="border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted disabled:opacity-40" disabled={messages.length < 6 || isSending} onClick={compactConversation} type="button">
              Kompakt
            </button>
            <button className="border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted disabled:opacity-40" disabled={messages.length === 0 || isSending} onClick={clear} type="button">
              Leeren
            </button>
          </div>
        </div>

        {activeActivity && activeActivity.steps.length > 0 ? (
          <div className="border-b border-dbzs-border bg-dbzs-panel/70 px-2 py-1.5">
            <div className="mb-1 text-[9px] uppercase tracking-wide text-dbzs-muted">Aktivität</div>
            <div className="space-y-1">
              {activeActivity.steps.slice(0, 4).map((step) => (
                <div key={step.id} className="flex items-start gap-2 rounded border border-dbzs-border/60 bg-dbzs-bg/60 px-2 py-1 text-[10px]">
                  <span className={`mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full ${step.status === "running" ? "bg-dbzs-cyan animate-pulse" : step.status === "done" ? "bg-dbzs-cyan" : step.status === "error" ? "bg-dbzs-red" : "bg-dbzs-border"}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-dbzs-text">{step.label}</div>
                    {step.detail ? <div className="truncate text-dbzs-muted">{step.detail}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-b border-dbzs-border bg-dbzs-bg/70 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-dbzs-muted">
            <span className="rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-1.5 py-0.5">
              {workspaceRoot ? `${workspaceName ?? "WS"} · ${workspaceFiles.length} Dateien` : "Kein Workspace"}
            </span>
            <span className="rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-1.5 py-0.5">
              {activeFile?.name ?? "Keine aktive Datei"}
            </span>
            <span className="rounded border border-dbzs-border/70 bg-dbzs-panelSoft px-1.5 py-0.5">
              {contextReadinessHint ?? "Kontext bereit"}
            </span>
          </div>
        </div>

        {/* Presets + Kontext-Chips */}
        <div className="flex flex-wrap items-center gap-1 border-b border-dbzs-border bg-dbzs-bg px-2 py-1">
          {(["plan", "refactor", "review", "summarize", "next_steps"] as const).map((preset) => (
            <button
              className="rounded border border-dbzs-border bg-dbzs-panelSoft px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-cyan disabled:opacity-40"
              disabled={!runtimeReady || isSending}
              key={preset}
              onClick={() => void sendPresetPrompt(preset, status, activeFile, null, contextHint, sendOptions)}
              type="button"
            >
              {preset === "next_steps" ? "Next" : preset.charAt(0).toUpperCase() + preset.slice(1, 4)}
            </button>
          ))}
          <span className="ml-auto truncate text-[10px] text-dbzs-muted" title={contextReadinessHint ?? undefined}>
            {activeFile?.name ?? "keine Datei"} · {workspaceChipLabel}
          </span>
        </div>

        {contextReadinessHint ? (
          <p className="border-b border-dbzs-amber/30 bg-dbzs-amber/5 px-2 py-1 text-[10px] leading-4 text-dbzs-amber">
            {contextReadinessHint}
          </p>
        ) : null}

        {mentionSuggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-dbzs-border bg-dbzs-panel px-2 py-1">
            <span className="text-[10px] uppercase tracking-wide text-dbzs-muted">Mentions</span>
            {mentionSuggestions.map((mention) => (
              <button
                key={`${mention.type}:${mention.path}`}
                className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-cyan"
                type="button"
                onClick={() => setDraft((prev) => insertMention(prev, mention))}
              >
                @{mention.type}:{mention.path}
              </button>
            ))}
          </div>
        ) : null}

        <RuntimeChatToolsBar compact={compact} />

        {showPanels ? (
          <div className="border-b border-dbzs-border">
            <RuntimeChatActivityPanel />
            <RuntimeChatApprovals
              onStatusNote={setContextNote}
              queueProposedChanges={queueProposedChanges}
              workspaceRoot={workspaceRoot}
            />
            <RuntimeChatPatchPanel />
            <RuntimeChatResearchPanel />
          </div>
        ) : null}

        {showSlotPanel ? (
          <div className="border-b border-dbzs-border">
            <RuntimeSlotPanel compact={false} autoStart={false} />
          </div>
        ) : null}

        {showDiagnostics && !compact ? (
          <div className="border-b border-dbzs-border">
            {lastRouting || activeRun?.fallbackRejection || activeRun?.warmupDiagnostics ? (
              <RoutingDiagnosticsCard
                diagnostics={
                  {
                    decision: {
                      decidedAt: lastBrokerDecision?.decidedAt ?? activeRun?.startedAt ?? new Date().toISOString(),
                      taskType: lastBrokerDecision?.taskType ?? activeRun?.taskType ?? "unknown",
                      targetAgent: lastRouting?.targetAgent ?? activeRun?.targetAgentLabel ?? "unknown",
                      slotId: lastRouting?.slotId || "unknown",
                      modelId: lastRouting?.modelId ?? "unknown",
                      modelName: lastRouting?.modelName ?? "unknown",
                      reason: lastBrokerDecision?.reason ?? `Provider: ${lastRouting?.providerId || "runtime"}`,
                      source: lastRouting?.selectionSource ?? "automatic"
                    },
                    validation: {
                      slotReady: status?.state === "running" && !!status?.endpoint,
                      slotMessage: status?.state === "running" ? "Ready" : "Not running",
                      memoryAvailable: true, // Platzhalter, sollte durch echte Prüfung ersetzt werden
                      memoryMessage: "Available",
                      canStart: status?.state === "running"
                    },
                    errorClassification: error ? { errorType: "chat_error", errorMessage: error, retryable: false, retryCount: 0 } : undefined,
                    // PRIORITÄT 5: Zeige an, warum ein Fallback abgelehnt wurde.
                    fallbackRejection: activeRun?.fallbackRejection,
                    // PRIORITÄT 3: Zeige detaillierte Warm-up-Fehler an.
                    warmup: activeRun?.warmupDiagnostics
                  } as RoutingDiagnostics
                }
              />
            ) : (
              <div className="p-2 text-[10px] text-dbzs-muted">No routing decision yet</div>
            )}
            <TokenBudgetVisualizer budget={activeRun?.tokenBudget} />
            <RuntimeModelTestPanel runtimeReady={runtimeReady} />
          </div>
        ) : null}

        {/* Nachrichten */}
        <div className="bg-dbzs-bg px-2 py-2">
          {messages.length === 0 ? (
            <p className="px-2 py-4 text-[11px] leading-5 text-dbzs-muted">
              Frage zum Modell, Workspace oder Code. Skills oben aktivieren, Tools fuer Dateiscan.
            </p>
          ) : (
            <div className="space-y-2">
              {messages.map((message, index) => {
                // Finde Run zu dieser Nachricht (User-Nachricht → Run → Assistant-Nachricht)
                const userRun = message.role === "user" && message.id 
                  ? Object.values(historicalRuns).find(r => r.userMessageId === message.id) || (activeRun?.userMessageId === message.id ? activeRun : null)
                  : null;
                
                return (
                  <React.Fragment key={`${message.role}-${index}`}>
                    <ChatMessageCard
                      compact={compact}
                      message={message}
                      canApply={!isSending}
                      isStreaming={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                      onApply={applyAssistantProposal}
                    />
                    {/* Render Run direkt nach User-Nachricht */}
                    {userRun && (
                      <CodeeRunLiveBlock 
                        run={userRun} 
                        onCancel={() => cancelSend(userRun.id)} 
                        isSending={isSending && activeRun?.id === userRun.id} 
                        workspaceRoot={workspaceRoot}
                        onFixFindings={(reviewId) =>
                          void sendMessage(
                            `Findings beheben\nReview-ID: ${reviewId}`,
                            status,
                            activeFile,
                            null,
                            contextHint,
                            "runtime_chat",
                            sendOptions
                          )
                        }
                        onRerunReview={() =>
                          void sendMessage(
                            "Mache einen vollständigen Repository Review.",
                            status,
                            activeFile,
                            null,
                            contextHint,
                            "runtime_chat",
                            sendOptions
                          )
                        }
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {/* Aktiver Run falls keine User-Nachricht zugeordnet (Fallback) */}
          {activeRun && !messages.some(m => activeRun.userMessageId === m.id) && (
            <CodeeRunLiveBlock
              run={activeRun}
              onCancel={() => cancelSend(activeRun.id)}
              isSending={isSending}
              workspaceRoot={workspaceRoot}
              onFixFindings={(reviewId) =>
                void sendMessage(
                  `Findings beheben\nReview-ID: ${reviewId}`,
                  status,
                  activeFile,
                  null,
                  contextHint,
                  "runtime_chat",
                  sendOptions
                )
              }
              onRerunReview={() =>
                void sendMessage(
                  "Mache einen vollständigen Repository Review.",
                  status,
                  activeFile,
                  null,
                  contextHint,
                  "runtime_chat",
                  sendOptions
                )
              }
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        {error ? (
          <div
            className="border-t border-dbzs-red/40 bg-dbzs-red/10 px-3 py-2 text-xs leading-5 text-dbzs-red"
            role="alert"
          >
            <strong className="font-medium">Chat-Fehler:</strong> {error}
          </div>
        ) : null}

        {/* Composer — scrollt mit dem Rest */}
        <form
          className="border-t border-dbzs-border bg-dbzs-panel p-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitMessage();
          }}
        >
          <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
            <button
              className={`rounded border px-1.5 py-0.5 ${chatMode === "auto" ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border text-dbzs-muted"}`}
              onClick={() => setChatMode("auto")}
              type="button"
            >
              Auto
            </button>
            <button
              className={`rounded border px-1.5 py-0.5 ${chatMode === "agent" ? "border-dbzs-cyan/60 bg-dbzs-cyan/10 text-dbzs-cyan" : "border-dbzs-border text-dbzs-muted"}`}
              onClick={() => setChatMode("agent")}
              type="button"
            >
              Agent
            </button>
            <select
              className="rounded border border-dbzs-border bg-dbzs-bg px-1.5 py-0.5 text-[10px] text-dbzs-muted"
              disabled={isSending}
              value={toolProfile}
              onChange={(e) => setToolProfile(e.currentTarget.value as "ask" | "agent" | "full")}
            >
              <option value="ask">Ask</option>
              <option value="agent">Agent</option>
              <option value="full">Full</option>
            </select>
            <label className="inline-flex items-center gap-1 text-dbzs-muted">
              <input checked={includeWorkspaceContext} className="h-3 w-3" onChange={(e) => setIncludeWorkspaceContext(e.currentTarget.checked)} type="checkbox" />
              Kontext
            </label>
            <span className="ml-auto truncate text-dbzs-muted">{contextNote ?? "Enter senden · Shift+Enter Zeile"}</span>
          </div>
          <div className="flex gap-2">
            <textarea
              className="min-h-[56px] flex-1 resize-y border border-dbzs-border bg-dbzs-bg px-2 py-1.5 text-[11px] leading-5 text-dbzs-text outline-none focus:border-dbzs-cyan/60"
              disabled={!runtimeReady || isSending}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                runtimeReady
                  ? "Analysiere, plane oder implementiere …"
                  : "Backend verbinden …"
              }
              rows={compact ? 2 : 3}
              value={draft}
            />
            <div className="flex shrink-0 flex-col gap-1">
              {isSending || isStreaming ? (
                <button className="border border-red-400/50 bg-red-400/10 px-2 py-1 text-[10px] text-red-400" onClick={(e) => { e.preventDefault(); cancelSend(); }} type="button">
                  Stopp
                </button>
              ) : null}
              <button
                className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[10px] font-medium text-dbzs-cyan disabled:opacity-40"
                disabled={!runtimeReady || isSending || draft.trim().length === 0}
                type="submit"
              >
                {isSending ? "…" : "Senden"}
              </button>
            </div>
          </div>
        </form>
    </>
  );

  if (embeddedInPanel) {
    return <section className={shellClass}>{chatContent}</section>;
  }

  return (
    <section className={`flex h-full min-h-0 flex-col ${compact ? "" : "bg-[#091017] p-3"}`}>
      <div className={shellClass}>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" ref={scrollContainerRef}>
          {chatContent}
        </div>
      </div>
    </section>
  );
}

function ChatMessageCard({
  message,
  canApply,
  compact = false,
  isStreaming = false,
  onApply
}: {
  message: RuntimeChatMessage;
  canApply: boolean;
  compact?: boolean;
  isStreaming?: boolean;
  onApply: (proposal: string) => void;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const isAnalysisProtocol = isSystem && message.content.startsWith("[Analyse-Protokoll]");
  const isCollapsedSystem = isSystem && !isAnalysisProtocol && message.content.length > 280;

  const settings = useSettingsStore((state) => state.settings);
  const reasoningDisplayMode = settings.reasoningDisplayMode ?? "summary";
  const reasoning = message.reasoningSummary;
  const patchProposal = useRuntimeChatStore((state) =>
    message.patchProposalId ? state.patchProposalsById[message.patchProposalId] ?? null : null
  );
  const patchPreview = useRuntimeChatStore((state) =>
    message.patchPreviewId ? state.patchPreviewsById[message.patchPreviewId] ?? null : null
  );
  const patchValidation = useRuntimeChatStore((state) =>
    message.patchProposalId ? state.patchValidationResult?.proposalId === message.patchProposalId ? state.patchValidationResult : null : null
  );
  const patchApplyResult = useRuntimeChatStore((state) =>
    message.patchProposalId ? state.patchApplyResult?.proposalId === message.patchProposalId ? state.patchApplyResult : null : null
  );
  const handleChatAction = useRuntimeChatStore((state) => state.handleChatAction);
  const agentActionsById = useRuntimeChatStore((state) => state.agentActionsById);
  const transportChatActions = useMemo(() => getTransportChatActions(message), [message.actions]);
  const runtimeAgentActions = useMemo(
    () => getRuntimeAgentActionsForMessage(message, agentActionsById),
    [agentActionsById, message.actionIds]
  );
  const planProposal = useRuntimeChatStore((state) =>
    message.planProposalId ? state.planProposalsById[message.planProposalId] ?? null : null
  );
  const patchState = useRuntimeChatStore((state) =>
    message.patchProposalId ? (state.patchState === "APPLYING" || state.patchState === "VALIDATING" ? state.patchState : null) : null
  );
  const workspaceRoot = useWorkspaceStore((state) => state.state.projectPath);
  const openSource = (filePath: string, line = 1) => {
    const absolute = workspaceRoot && !/^(?:[A-Za-z]:[\\/]|\/)/.test(filePath)
      ? `${workspaceRoot.replace(/[\\/]+$/, "")}/${filePath}`
      : filePath;
    void useEditorStore.getState().openWorkspaceConflictFile(absolute, line);
  };
  const hasPendingCommandApproval = hasPendingRuntimeActionKind(runtimeAgentActions, "command");
  const hasPendingWebApproval = hasPendingRuntimeActionKind(runtimeAgentActions, "web");
  const hasTransportChatActions = transportChatActions.length > 0;

  if (isCollapsedSystem && compact) {
    return (
      <details className="rounded border border-dbzs-border/60 bg-dbzs-panelSoft px-2 py-1 text-[10px] text-dbzs-muted">
        <summary className="cursor-pointer">System-Kontext</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[9px] leading-4">{message.content.slice(0, 1200)}</pre>
      </details>
    );
  }

  const cleanContent = isAssistant ? stripPrivateReasoning(message.content) : message.content;

  const cardClass = isUser
    ? "border border-dbzs-border/60 bg-dbzs-panel"
    : isAssistant
    ? "border border-dbzs-cyan/40 bg-dbzs-cyan/5"
    : "border border-dbzs-border/60 bg-dbzs-panelSoft";
  const retrievalDroppedItems = message.retrievalManifest?.droppedItems ?? [];
  const contextSections = message.contextManifest?.sections ?? [];
  const contextDroppedSections = message.contextManifest?.droppedSections ?? [];
  const contextCoverage = message.retrievalManifest
    ? message.retrievalManifest.candidateCount > 0
      ? Math.round((message.retrievalManifest.selectedCount / message.retrievalManifest.candidateCount) * 100)
      : 0
    : contextSections.length + contextDroppedSections.length > 0
      ? Math.round((contextSections.length / (contextSections.length + contextDroppedSections.length)) * 100)
      : 0;
  const duplicateContextRemoved =
    message.contextManifest?.duplicateContextRemoved ??
    retrievalDroppedItems.filter((item) => item.reason === "duplicate").length;
  const budgetDropCount =
    retrievalDroppedItems.filter((item) => item.reason === "token_budget").length + contextDroppedSections.length;

  return (
    <div className={`rounded ${cardClass} px-2 py-1.5`}>
      <div className="mb-0.5 flex items-center gap-2 text-[10px]">
        <span className={`rounded px-1 py-0.5 font-medium ${
          isUser ? "bg-dbzs-border/40 text-dbzs-text" :
          isAssistant ? "bg-dbzs-cyan/20 text-dbzs-cyan" :
          "bg-dbzs-muted/20 text-dbzs-muted"
        }`}>
          {isUser ? "Du" : isAssistant ? "Assistent" : "System"}
        </span>
      </div>

      {message.safeReasoningSummary && reasoningDisplayMode !== "hidden" && (
        <details
          className="mb-1 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 px-2 py-1 text-[10px]"
          open={reasoningDisplayMode === "expanded"}
        >
          <summary className="cursor-pointer select-none font-bold text-dbzs-cyan" aria-label="CODEE Ablauf anzeigen/ausblenden">
            CODEE Ablauf · {message.safeReasoningSummary.summary}
          </summary>
          <div className="mt-1 space-y-1 text-dbzs-textSoft">
            {reasoningDisplayMode === "expanded" && message.traceEvents?.map((event) => (
              <div className="flex gap-2" key={event.id}>
                <span>{event.status === "completed" ? "✓" : event.status === "failed" ? "✗" : "⏳"}</span>
                <span><strong>{event.title}</strong> · {event.summary}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {message.retrievalManifest || message.contextManifest ? (
        <details className="mb-1 rounded border border-dbzs-border/60 bg-dbzs-bg/40 px-2 py-1 text-[10px]">
          <summary className="cursor-pointer text-dbzs-textSoft">
            Kontext & Quellen · {message.retrievalManifest ? `${message.retrievalManifest.selectedCount} von ${message.retrievalManifest.candidateCount} Treffern · ${message.retrievalManifest.totalTokens} Tokens` : `${contextSections.length} Kontextsektionen · ${message.contextManifest?.inputTokens ?? 0} Tokens`}
          </summary>
          <div className="mt-1 grid gap-1">
            {(message.sourceReferences ?? []).map((source) => (
              <button className="text-left text-dbzs-cyan hover:underline" key={source.id} onClick={() => source.filePath && openSource(source.filePath, source.startLine)} type="button">
                {source.title}{source.filePath ? ` · ${source.filePath}` : ""}{source.startLine ? `:${source.startLine}` : ""}
              </button>
            ))}
            <span className="text-dbzs-muted">
              Context Coverage: {contextCoverage}% · Duplicate entfernt: {duplicateContextRemoved} · Tokenersparnis: {message.contextManifest?.duplicateTokenSavings ?? 0} · Budget-Drops: {budgetDropCount}
            </span>
            <span className="text-dbzs-muted">Cache: {message.retrievalManifest?.cacheHits ?? message.contextManifest?.cacheHits ?? 0} Hits / {message.retrievalManifest?.cacheMisses ?? message.contextManifest?.cacheMisses ?? 0} Misses</span>
            {message.retrievalManifest?.fallbackReason ? <span className="text-dbzs-warning">Kontextlücke: {message.retrievalManifest.fallbackReason}</span> : null}
          </div>
        </details>
      ) : null}

      {!message.safeReasoningSummary && reasoning && reasoningDisplayMode !== "hidden" && (
        <p className="mb-1 text-[10px] text-dbzs-muted">Ablaufdaten für diese ältere Nachricht sind nicht verfügbar.</p>
      )}

      {cleanContent ? (
        <MessageMarkdown
          className="prose-invert max-w-none text-[11px] leading-5 text-dbzs-text"
          content={cleanContent}
          onApply={canApply && isAssistant ? onApply : undefined}
          isStreaming={isStreaming}
        />
      ) : null}

      {planProposal ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-cyan">Geplanter Ablauf</div>
            <span className="rounded border border-dbzs-border px-1.5 py-0.5 text-[9px] text-dbzs-muted">{planProposal.state}</span>
          </div>
          <div className="mb-1 font-medium text-dbzs-text">{planProposal.title}</div>
          <div className="mb-2 text-dbzs-textSoft">{planProposal.summary}</div>
          <ol className="mb-2 list-decimal space-y-1 pl-4 text-dbzs-textSoft">
            {planProposal.steps.slice(0, 4).map((step) => (
              <li key={step.id}>
                <span className="font-medium text-dbzs-text">{step.title}</span>
                {step.description ? ` · ${step.description}` : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {patchProposal ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-dbzs-cyan">CODEE möchte {patchProposal.changes.length} Datei{patchProposal.changes.length === 1 ? "" : "en"} ändern</div>
              <div className="text-dbzs-muted">{patchProposal.title}</div>
            </div>
            <span className="rounded border border-dbzs-border px-1.5 py-0.5 text-[9px] text-dbzs-muted">
              {patchPreview?.state ?? "PREVIEW_READY"}
            </span>
          </div>
          <div className="mb-2 text-dbzs-textSoft">{patchProposal.summary}</div>
          <div className="mb-2 space-y-1">
            {patchProposal.changes.slice(0, 3).map((change) => (
              <div className="rounded border border-dbzs-border/70 bg-dbzs-bg/60 px-2 py-1" key={change.id}>
                <div className="font-medium text-dbzs-text">{change.filePath}</div>
                <div className="text-dbzs-muted">{change.changeType} · Risiko: {change.riskLevel}</div>
              </div>
            ))}
          </div>
          {patchPreview?.previews?.[0]?.diff ? (
            <details className="mb-2 rounded border border-dbzs-border bg-dbzs-bg/70">
              <summary className="cursor-pointer px-2 py-1 text-dbzs-cyan">Diff anzeigen</summary>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-dbzs-border p-2 text-[9px] leading-4 text-dbzs-text">
                {patchPreview.previews[0].diff}
              </pre>
            </details>
          ) : null}
          {workspaceRoot ? (
            <div className="text-[9px] text-dbzs-muted">Workspace: {workspaceRoot}</div>
          ) : null}
        </div>
      ) : null}

      {patchValidation ? (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-text">Validierung</div>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] ${patchValidation.success ? "border-dbzs-cyan/40 text-dbzs-cyan" : "border-dbzs-red/40 text-dbzs-red"}`}>
              {patchValidation.success ? "BESTANDEN" : "FEHLER"}
            </span>
          </div>
          <div className="space-y-1">
            {patchValidation.commands.map((command) => (
              <div key={command.commandId} className="rounded border border-dbzs-border/60 bg-dbzs-bg/60 px-2 py-1">
                <div className="font-medium text-dbzs-text">{command.commandId}</div>
                <div className="text-dbzs-muted">
                  Exit {command.exitCode ?? "?"}
                  {command.stderr ? ` · ${command.stderr}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasPendingCommandApproval ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 font-semibold text-dbzs-cyan">Terminal-Freigabe</div>
          <div className="text-dbzs-textSoft">CODEE wartet auf Ihre Freigabe für einen sicheren Terminalbefehl.</div>
        </div>
      ) : null}

      {hasPendingWebApproval ? (
        <div className="mt-2 rounded border border-dbzs-cyan/30 bg-dbzs-cyan/5 p-2 text-[10px]">
          <div className="mb-1 font-semibold text-dbzs-cyan">Web-Freigabe</div>
          <div className="text-dbzs-textSoft">CODEE wartet auf Ihre Freigabe für eine Websuche oder einen Web-Fetch.</div>
        </div>
      ) : null}

      {patchState ? (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-text">Änderung</div>
            <span className="rounded border border-dbzs-cyan/40 px-1.5 py-0.5 text-[9px] text-dbzs-cyan">
              {patchState === "APPLYING" ? "WIRD ANGEWENDET…" : patchState === "VALIDATING" ? "WIRD VALIDIERT…" : "WIRD GENEHMIGT…"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-dbzs-textSoft">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-dbzs-cyan" />
            <span>Der Patch wird gerade verarbeitet.</span>
          </div>
        </div>
      ) : null}

      {patchApplyResult ? (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-panelSoft p-2 text-[10px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-semibold text-dbzs-text">Änderung</div>
            <span className={`rounded border px-1.5 py-0.5 text-[9px] ${patchApplyResult.applied ? "border-dbzs-cyan/40 text-dbzs-cyan" : "border-dbzs-red/40 text-dbzs-red"}`}>
              {patchApplyResult.applied ? "ANGEWENDET" : "ROLLBACK"}
            </span>
          </div>
          <div className="text-dbzs-textSoft">
            {patchApplyResult.applied
              ? `Änderungen in ${patchApplyResult.changedFiles.length} Datei(en) angewendet.`
              : `Patch wurde zurückgerollt${patchApplyResult.errors[0] ? `: ${patchApplyResult.errors[0]}` : "."}`}
          </div>
          {patchApplyResult.changedFiles.length > 0 ? (
            <div className="mt-1 text-dbzs-muted">Geänderte Dateien: {patchApplyResult.changedFiles.join(", ")}</div>
          ) : null}
        </div>
      ) : null}

      {hasTransportChatActions && (
        <div
          className="mt-2 p-2 rounded bg-dbzs-panelSoft border border-dbzs-border/60 flex flex-wrap gap-2 items-center"
          aria-label="Erforderliche Freigabe oder Aktion"
        >
          {transportChatActions.map((act) => {
            const isPending = act.state === "pending";
            const isApproved = act.state === "approved";
            const isCompleted = act.state === "completed";
            const isRejected = act.state === "rejected";
            const isFailed = act.state === "failed";
            let { colorClass, statusBadgeClass } = getTransportActionTone(act);

            if (isApproved || isCompleted) {
              colorClass = "border-dbzs-cyan text-dbzs-cyan bg-dbzs-cyan/15 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]";
              statusBadgeClass = "text-dbzs-cyan";
            } else if (isRejected) {
              colorClass = "border-dbzs-red text-dbzs-red bg-dbzs-red/10 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]";
              statusBadgeClass = "text-dbzs-red";
            } else if (isFailed) {
              colorClass = "border-dbzs-red text-dbzs-red bg-dbzs-red/10 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]";
              statusBadgeClass = "text-dbzs-red";
            }

            return (
              <div key={act.id} className="flex flex-col gap-1">
                <button
                  onClick={() => isPending && workspaceRoot && handleChatAction(
                    act.id,
                    message.id,
                    !isRejectTransportAction(act),
                    workspaceScopeId(workspaceRoot)
                  )}
                  disabled={!isPending}
                  className={`border px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer transition-colors duration-150 flex items-center gap-1.5 ${colorClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                  aria-label={`${act.title} - Risiko: ${act.riskLevel ?? "niedrig"}`}
                >
                  {isApproved && (
                    <span className={`h-2.5 w-2.5 rounded-full bg-current ${isApproved ? "animate-ping" : ""}`} />
                  )}
                  {isRejected && (
                    <span className={`h-2.5 w-2.5 rounded-full border border-current ${statusBadgeClass}`} />
                  )}
                  {isCompleted && (
                    <span className={`h-2.5 w-2.5 rounded-full bg-current`} />
                  )}
                  <span className={isPending ? "" : statusBadgeClass}>{act.title}</span>
                  {isCompleted && " ✓"}
                  {isRejected && " ✗"}
                </button>
                {isFailed && act.description && (
                  <span className="text-[9px] text-dbzs-red mt-0.5">{act.description}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function stripPrivateReasoning(content: string): string {
  return content
    .replace(/<(thought|think|analysis|chain-of-thought|reasoning-summary)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(thought|think|analysis|chain-of-thought|reasoning-summary)\b[^>]*>[\s\S]*$/gi, "")
    .trim();
}

export default RuntimeChatTab;
