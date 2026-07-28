import {
  type BackendStartupStatus,
  type RuntimeStatus,
  type WorkspaceFile,
  type WorkspaceProjectFile,
} from "@dbzs/shared";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { useRuntimeChatApprovalStore } from "@/stores/runtimeChatApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { closeRuntimeChatWindow, openRuntimeChatWindow } from "@/utils/runtimeChatWindow";
import { useRuntimeChatPendingApprovalCount } from "@/components/RuntimeChatApprovals";
import { buildWorkspaceContext } from "@/services/runtimeChatContext";
import { insertMention, suggestMentionPaths } from "@/services/runtimeChatContextMentions";
import { agentLabel } from "@/services/runtimeChatActivityHelpers";
import { useEditorStore } from "@/stores/editorStore";
import { codeIndexService } from "@/services/codeIndexService";
import {
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
import {
  stripPrivateReasoning
} from "@/components/runtime-chat/RuntimeChatMessageCard";
import { RuntimeChatConversationFeed } from "@/components/runtime-chat/RuntimeChatConversationFeed";
import { RuntimeChatComposer } from "@/components/runtime-chat/RuntimeChatComposer";
import { RuntimeChatHeader } from "@/components/runtime-chat/RuntimeChatHeader";
import { RuntimeChatSecondaryPanels } from "@/components/runtime-chat/RuntimeChatSecondaryPanels";

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
  const activePatchProposal = useRuntimeChatStore((state) => state.activePatchProposal);
  const previousWorkspaceRootRef = useRef(workspaceRoot);

  useEffect(() => {
    // Rückfragen (inkl. Resource-Risk A/B/C) liegen im Panel — bei offenen Fragen automatisch einblenden.
    if (pendingApprovalCount > 0) {
      setShowPanels(true);
    }
  }, [pendingApprovalCount]);

  useEffect(() => {
    // Ein neuer Patch-Vorschlag darf nicht unsichtbar bleiben, bis der Nutzer
    // zufällig auf "Werkzeuge & Freigaben" klickt.
    if (activePatchProposal) {
      setShowPanels(true);
    }
  }, [activePatchProposal]);
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

  const embeddedInPanel = compact && !detached;
  const shellClass = embeddedInPanel
    ? "border border-dbzs-border bg-dbzs-panelSoft"
    : compact
    ? "flex h-full min-h-0 flex-col overflow-hidden border border-dbzs-border bg-dbzs-panelSoft"
    : "mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden border border-dbzs-border bg-dbzs-panelSoft";

  const chatContent = (
    <>
      <RuntimeChatHeader
        title="Runtime Chat"
        subtitle={statusLabel}
        activityHint={
          activeActivity
            ? workspaceContextStep?.detail ??
              activeActivity.steps.find((step) => step.status === "running")?.label ??
              activeActivity.summary ??
              "Aktivität läuft"
            : null
        }
        selectedProvider={selectedProvider}
        availableProviders={availableProviders}
        pendingApprovalCount={pendingApprovalCount}
        showPanels={showPanels}
        showSlotPanel={showSlotPanel}
        showDiagnostics={showDiagnostics}
        compact={compact}
        detached={detached}
        onProviderChange={setSelectedProvider}
        onTogglePanels={() => setShowPanels((value) => !value)}
        onToggleSlots={() => setShowSlotPanel((value) => !value)}
        onToggleDiagnostics={() => setShowDiagnostics((value) => !value)}
        onDetach={() => void openRuntimeChatWindow()}
        onClose={() => void closeRuntimeChatWindow()}
        onCompactConversation={compactConversation}
        onClearConversation={clear}
        canCompactConversation={messages.length >= 6 && !isSending}
        canClearConversation={messages.length > 0 && !isSending}
        workspaceLabel={workspaceRoot ? `${workspaceName ?? "WS"} · ${workspaceFiles.length} Dateien` : "Kein Workspace"}
        activeFileLabel={activeFile?.name ?? "Keine aktive Datei"}
        contextLabel={contextReadinessHint ?? "Kontext bereit"}
      />

        <details className="border-b border-dbzs-border bg-dbzs-bg px-2 py-1">
          <summary className="cursor-pointer text-[10px] text-dbzs-muted">
            Schnellaktionen & erweiterte Optionen
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-1">
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
        </details>

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

      <RuntimeChatSecondaryPanels
        compact={compact}
        showPanels={showPanels}
        showSlotPanel={showSlotPanel}
        showDiagnostics={showDiagnostics}
        queueProposedChanges={queueProposedChanges}
        workspaceRoot={workspaceRoot}
        onStatusNote={setContextNote}
        diagnostics={
          lastRouting || activeRun?.fallbackRejection || activeRun?.warmupDiagnostics
            ? ({
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
                  memoryAvailable: true,
                  memoryMessage: "Available",
                  canStart: status?.state === "running"
                },
                errorClassification: error
                  ? { errorType: "chat_error", errorMessage: error, retryable: false, retryCount: 0 }
                  : undefined,
                fallbackRejection: activeRun?.fallbackRejection,
                warmup: activeRun?.warmupDiagnostics
              } as RoutingDiagnostics)
            : null
        }
        tokenBudget={activeRun?.tokenBudget}
        runtimeReady={runtimeReady}
      />

      <RuntimeChatConversationFeed
        messages={messages}
        historicalRuns={historicalRuns}
        activeRun={activeRun}
        compact={compact}
        isSending={isSending}
        isStreaming={isStreaming}
        workspaceRoot={workspaceRoot}
        onApplyAssistantProposal={applyAssistantProposal}
        onCancelRun={cancelSend}
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

        {error ? (
          <div
            className="border-t border-dbzs-red/40 bg-dbzs-red/10 px-3 py-2 text-xs leading-5 text-dbzs-red"
            role="alert"
          >
            <strong className="font-medium">Chat-Fehler:</strong> {error}
          </div>
        ) : null}

      <div ref={messagesEndRef} />

      <RuntimeChatComposer
        draft={draft}
        runtimeReady={runtimeReady}
        isSending={isSending}
        isStreaming={isStreaming}
        chatMode={chatMode}
        toolProfile={toolProfile}
        includeWorkspaceContext={includeWorkspaceContext}
        contextNote={contextNote}
        onDraftChange={setDraft}
        onSubmit={submitMessage}
        onCancel={() => cancelSend()}
        setChatMode={setChatMode}
        setToolProfile={setToolProfile}
        setIncludeWorkspaceContext={setIncludeWorkspaceContext}
      />
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

export default RuntimeChatTab;
export { stripPrivateReasoning };
