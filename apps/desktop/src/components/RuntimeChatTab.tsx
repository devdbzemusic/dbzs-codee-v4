import {
  type BackendStartupStatus,
  type RuntimeChatAttachment,
  type RuntimeStatus,
  type WorkspaceFile,
  type WorkspaceProjectFile
} from "@dbzs/shared";
import React, { type ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRuntimeChatPendingApprovalCount } from "@/components/RuntimeChatApprovals";
import { RuntimeChatCapabilitiesOverlay } from "@/components/runtime-chat/RuntimeChatCapabilitiesOverlay";
import { RuntimeChatComposer } from "@/components/runtime-chat/RuntimeChatComposer";
import { RuntimeChatConversationFeed } from "@/components/runtime-chat/RuntimeChatConversationFeed";
import { RuntimeChatHeader } from "@/components/runtime-chat/RuntimeChatHeader";
import {
  stripPrivateReasoning
} from "@/components/runtime-chat/RuntimeChatMessageCard";
import { RuntimeChatSecondaryPanels } from "@/components/runtime-chat/RuntimeChatSecondaryPanels";
import {
  detachActiveTaskContract,
  restoreActiveTaskContract
} from "@/services/activeTaskContract";
import { agentLabel } from "@/services/runtimeChatActivityHelpers";
import { buildWorkspaceContext } from "@/services/runtimeChatContext";
import { insertMention, suggestMentionPaths } from "@/services/runtimeChatContextMentions";
import { listRuntimeChatSkills } from "@/services/runtimeChatSkills";
import { codeIndexService } from "@/services/codeIndexService";
import {
  isWorkModelLoaded,
  looksLikeOrchestratorModel
} from "@/services/lazyRuntimePolicy";
import { formatBootStateForUi } from "@/services/bootUiFormatter";
import { observabilityService } from "@/runtime/observability/observabilityService";
import {
  attachmentRequiresVision,
  defaultPromptForAttachments,
  mergeRuntimeChatAttachments,
  summarizeAttachmentImport
} from "@/services/runtimeChatAttachments";
import { useCommandPaletteStore } from "@/stores/commandPaletteStore";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRuntimeChatApprovalStore } from "@/stores/runtimeChatApprovalStore";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { PRESET_MESSAGES } from "@/stores/runtimeChatStoreRuntimeHelpers";
import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";
import { closeRuntimeChatWindow, openRuntimeChatWindow } from "@/utils/runtimeChatWindow";

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

const PRESET_LABELS = {
  plan: "Plan",
  refactor: "Refactor",
  review: "Review",
  summarize: "Zusammenfassen",
  next_steps: "Nächste Schritte"
} as const;

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
  const [attachments, setAttachments] = useState<RuntimeChatAttachment[]>([]);
  const [contextNote, setContextNote] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showPanels, setShowPanels] = useState(false);
  const [showSlotPanel, setShowSlotPanel] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [chatMode, setChatMode] = useState<"auto" | "agent">("auto");
  const [selectedProvider, setSelectedProvider] = useState("llama.cpp");
  const [availableProviders, setAvailableProviders] = useState<string[]>(["llama.cpp", "ollama", "antigravity"]);
  const [includeWorkspaceContext, setIncludeWorkspaceContext] = useState(true);
  const [traceCount, setTraceCount] = useState(() => observabilityService.getAllTraces().length);
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
  const attachmentsRef = useRef<RuntimeChatAttachment[]>([]);
  const previousWorkspaceRootRef = useRef(workspaceRoot);
  const handledCapabilitiesRequestRef = useRef(0);
  const handledPresetRequestRef = useRef(0);
  const queueProposedChanges = useEditorStore((state) => state.queueProposedChanges);
  const requestTakeoverApproval = useRuntimeChatApprovalStore((state) => state.requestTakeoverApproval);
  const pendingApprovalCount = useRuntimeChatPendingApprovalCount(workspaceRoot);
  const activePatchProposal = useRuntimeChatStore((state) => state.activePatchProposal);
  const settings = useSettingsStore((state) => state.settings);
  const activeActivity = useRuntimeChatStore((state) => state.currentActivity ?? state.lastActivity);
  const workspaceContextStep = activeActivity?.steps.find((step) => step.id === "workspace-context");
  const lastBrokerDecision = useRuntimeChatStore((state) => state.lastBrokerDecision);
  const capabilityRequestId = useCommandPaletteStore((state) => state.runtimeChatCapabilitiesRequestId);
  const presetRequest = useCommandPaletteStore((state) => state.runtimeChatPresetRequest);
  const runtimeReady = status != null;
  const workModelReady = isWorkModelLoaded(status) && !looksLikeOrchestratorModel(status);
  const skills = useMemo(() => listRuntimeChatSkills(), []);
  const presetEntries = useMemo(
    () =>
      (Object.keys(PRESET_MESSAGES) as Array<keyof typeof PRESET_MESSAGES>).map((preset) => ({
        id: preset,
        label: PRESET_LABELS[preset],
        description: PRESET_MESSAGES[preset]
      })),
    []
  );

  useEffect(() => {
    if (pendingApprovalCount > 0) {
      setShowPanels(true);
    }
  }, [pendingApprovalCount]);

  useEffect(() => {
    if (activePatchProposal) {
      setShowPanels(true);
    }
  }, [activePatchProposal]);

  useEffect(() => {
    const refresh = () => setTraceCount(observabilityService.getAllTraces().length);
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

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
      return "Kein Workspace geöffnet";
    }
    if (workspaceFiles.length === 0) {
      return detached
        ? "Detached: Dateiliste nicht synchronisiert — Hauptfenster fokussieren oder Chat im Panel nutzen"
        : "Dateiscan leer — Projekt neu öffnen oder scannen";
    }
    return null;
  }, [detached, includeWorkspaceContext, workspaceFiles.length, workspaceRoot]);

  const statusLabel = useMemo(() => {
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

  const appendAttachments = (nextAttachments: RuntimeChatAttachment[]) => {
    if (nextAttachments.length === 0) {
      return { addedCount: 0, duplicateCount: 0, errorCount: 0 };
    }
    const result = mergeRuntimeChatAttachments(attachmentsRef.current, nextAttachments);
    attachmentsRef.current = result.attachments;
    setAttachments(result.attachments);
    return {
      addedCount: result.addedCount,
      duplicateCount: result.duplicateCount,
      errorCount: result.errorCount
    };
  };

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

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
    attachmentsRef.current = [];
    setAttachments([]);
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

  useEffect(() => {
    if (detached) {
      return;
    }
    if (capabilityRequestId > handledCapabilitiesRequestRef.current) {
      handledCapabilitiesRequestRef.current = capabilityRequestId;
      setShowCapabilities(true);
    }
  }, [capabilityRequestId, detached]);

  useEffect(() => {
    if (detached || !presetRequest || presetRequest.id <= handledPresetRequestRef.current) {
      return;
    }
    handledPresetRequestRef.current = presetRequest.id;
    if (runtimeReady && !isSending) {
      void sendPresetPrompt(presetRequest.preset, status, activeFile, null, contextHint, sendOptions);
      setContextNote(`Preset gestartet: ${PRESET_LABELS[presetRequest.preset]}`);
    } else {
      setDraft(PRESET_MESSAGES[presetRequest.preset]);
      setContextNote(`Preset eingefügt: ${PRESET_LABELS[presetRequest.preset]}`);
    }
  }, [activeFile, contextHint, detached, isSending, presetRequest, runtimeReady, sendOptions, sendPresetPrompt, status]);

  const submitMessage = () => {
    const text = draft;
    const trimmedText = text.trim();
    const hasImageInput = attachmentRequiresVision(attachments);
    if (trimmedText.length === 0 && attachments.length === 0) return;
    setDraft("");

    void (async () => {
      const basePayload = trimmedText.length > 0 ? text : defaultPromptForAttachments(attachments);
      const payload = chatMode === "agent" ? `[Agent Mode]\n${basePayload}` : basePayload;
      const sent = await sendMessage(
        payload,
        status,
        activeFile,
        null,
        contextHint,
        chatMode === "agent" ? "coder" : "runtime_chat",
        {
          ...sendOptions,
          attachments,
          hasImageInput,
          requiresVision: hasImageInput
        }
      );
      if (sent) {
        attachmentsRef.current = [];
        setAttachments([]);
        const activity = useRuntimeChatStore.getState().lastActivity;
        const workspaceStep = activity?.steps.find((step) => step.id === "workspace-context");
        if (workspaceStep) {
          const detail = workspaceStep.detail?.split("\n").find(Boolean) ?? workspaceStep.label;
          setContextNote(`Kontext: ${detail}`);
        } else {
          setContextNote("Anfrage gesendet.");
        }
      } else {
        setDraft(text);
        setContextNote("Anfrage konnte nicht gesendet werden.");
      }
    })();
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void (async () => {
      try {
        if (!window.dbzs.prepareClipboardChatAttachments) {
          setContextNote("Clipboard-Dateianhaenge sind in dieser Umgebung nicht verfuegbar.");
          return;
        }
        const prepared = await Promise.all(
          files.map(
            (file) =>
              new Promise<{ name: string; mimeType: string; sizeBytes?: number; dataUrl: string }>(
                (resolve, reject) => {
                  const reader = new FileReader();
                  reader.onerror = () => reject(new Error(`Datei konnte nicht gelesen werden: ${file.name}`));
                  reader.onload = () => {
                    if (typeof reader.result === "string") {
                      resolve({
                        name: file.name,
                        mimeType: file.type || "application/octet-stream",
                        sizeBytes: file.size,
                        dataUrl: reader.result
                      });
                      return;
                    }
                    reject(new Error(`Datei konnte nicht gelesen werden: ${file.name}`));
                  };
                  reader.readAsDataURL(file);
                }
              )
          )
        );
        const nextAttachments = await window.dbzs.prepareClipboardChatAttachments(prepared);
        const result = appendAttachments(nextAttachments);
        setContextNote(
          summarizeAttachmentImport({
            ...result,
            sourceLabel: "aus der Zwischenablage eingefuegt"
          })
        );
      } catch (error) {
        setContextNote(error instanceof Error ? error.message : "Dateien aus Zwischenablage konnten nicht gelesen werden.");
      }
    })();
  };

  const handleOpenAttachmentDialog = () => {
    void (async () => {
      try {
        if (!window.dbzs.openChatAttachmentDialog) {
          setContextNote("Dateidialog ist in dieser Umgebung nicht verfuegbar.");
          return;
        }
        const nextAttachments = await window.dbzs.openChatAttachmentDialog();
        if (nextAttachments.length === 0) {
          return;
        }
        const result = appendAttachments(nextAttachments);
        setContextNote(
          summarizeAttachmentImport({
            ...result,
            sourceLabel: "hinzugefuegt"
          })
        );
      } catch (error) {
        setContextNote(error instanceof Error ? error.message : "Dateien konnten nicht hinzugefuegt werden.");
      }
    })();
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      attachmentsRef.current = next;
      return next;
    });
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

  const runPreset = (preset: keyof typeof PRESET_MESSAGES) => {
    setShowCapabilities(false);
    void sendPresetPrompt(preset, status, activeFile, null, contextHint, sendOptions);
  };

  const embeddedInPanel = compact && !detached;
  const shellClass = embeddedInPanel
    ? "relative border border-dbzs-border bg-dbzs-panelSoft"
    : compact
      ? "relative flex h-full min-h-0 flex-col overflow-hidden border border-dbzs-border bg-dbzs-panelSoft"
      : "relative mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden border border-dbzs-border bg-dbzs-panelSoft";

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
        traceCount={traceCount}
        showPanels={showPanels}
        showSlotPanel={showSlotPanel}
        showDiagnostics={showDiagnostics}
        compact={compact}
        detached={detached}
        onProviderChange={setSelectedProvider}
        onOpenCapabilities={() => setShowCapabilities(true)}
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
          {presetEntries.map((preset) => (
            <button
              className="rounded border border-dbzs-border bg-dbzs-panelSoft px-1.5 py-0.5 text-[10px] text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-cyan disabled:opacity-40"
              disabled={!runtimeReady || isSending}
              key={preset.id}
              onClick={() => runPreset(preset.id)}
              title={preset.description}
              type="button"
            >
              {preset.label}
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
        onSelectExample={setDraft}
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
        attachments={attachments}
        onDraftChange={setDraft}
        onSubmit={submitMessage}
        onCancel={() => cancelSend()}
        onPasteAttachments={handleComposerPaste}
        onOpenAttachmentDialog={handleOpenAttachmentDialog}
        onRemoveAttachment={handleRemoveAttachment}
        setChatMode={setChatMode}
        setToolProfile={setToolProfile}
        setIncludeWorkspaceContext={setIncludeWorkspaceContext}
      />

      <RuntimeChatCapabilitiesOverlay
        open={showCapabilities}
        presetEntries={presetEntries}
        skills={skills}
        onClose={() => setShowCapabilities(false)}
        onSelectPreset={runPreset}
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
