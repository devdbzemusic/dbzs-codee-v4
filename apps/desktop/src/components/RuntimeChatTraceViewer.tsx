/*
 * DBZS – Division By Zeros
 * Datei: RuntimeChatTraceViewer.tsx
 * Bereich: Runtime Chat Components
 *
 * Zweck:
 *   UI-Komponente zur Inspektion von Chat-Sessions, Context-Proofs und Agent-Handoffs.
 *
 * Warum:
 *   Entwickler müssen nachvollziehen können, welcher Kontext verwendet wurde.
 *
 * Wozu:
 *   Debugging, Review und Compliance-Nachweis.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Button, RiskBadge, SectionCard, StatusPill } from "@/components/ui";
import { observabilityService } from "@/runtime/observability/observabilityService";
import type { ChatSessionTrace } from "@/runtime/observability/chatSessionTrace";
import { resolveStatusVocabulary } from "@/utils/statusVocabulary";

interface TraceViewerProps {
  onClose?: () => void;
}

type TraceTab = "sessions" | "stats";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit"
  });
}

function statusPillFor(rawStatus: string) {
  const resolved = resolveStatusVocabulary(rawStatus);
  return <StatusPill label="Status" tone={resolved.tone} value={resolved.label} />;
}

function traceDuration(trace: ChatSessionTrace): string {
  if (!trace.finishedAt) {
    return "läuft";
  }
  return formatDuration(new Date(trace.finishedAt).getTime() - new Date(trace.startedAt).getTime());
}

export function RuntimeChatTraceViewer({ onClose }: TraceViewerProps) {
  const [activeTab, setActiveTab] = useState<TraceTab>("sessions");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [traces, setTraces] = useState<ChatSessionTrace[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof observabilityService.getStatistics> | null>(null);

  useEffect(() => {
    const load = () => {
      setTraces(observabilityService.getAllTraces());
      setStats(observabilityService.getStatistics());
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const selectedTrace = useMemo(
    () => traces.find((trace) => trace.sessionId === selectedSessionId) ?? traces[0] ?? null,
    [selectedSessionId, traces]
  );

  const exportTrace = (trace: ChatSessionTrace) => {
    const json = observabilityService.exportTrace(trace.sessionId);
    if (!json) {
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trace-${trace.sessionId.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearAllTraces = () => {
    if (!window.confirm("Alle gespeicherten Session-Traces löschen?")) {
      return;
    }
    observabilityService.clearAllTraces();
    setTraces([]);
    setStats(observabilityService.getStatistics());
    setSelectedSessionId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-dbzs-text">Session-Traces</h3>
          <p className="mt-0.5 text-[10px] text-dbzs-muted">
            Observability für Sessions, Kontextbeweise, Agent-Handoffs und Tool-Aufrufe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button active={activeTab === "sessions"} onClick={() => setActiveTab("sessions")}>
            Sessions
          </Button>
          <Button active={activeTab === "stats"} onClick={() => setActiveTab("stats")}>
            Statistiken
          </Button>
          {onClose ? <Button onClick={onClose}>Schließen</Button> : null}
        </div>
      </div>

      {activeTab === "stats" ? (
        <div className="grid gap-2 md:grid-cols-3">
          {stats ? (
            <>
              <SectionCard title="Gesamte Sessions">
                <div className="text-xl font-semibold text-dbzs-text">{stats.totalSessions}</div>
              </SectionCard>
              <SectionCard title="Aktive Sessions">
                <div className="text-xl font-semibold text-dbzs-cyan">{stats.activeSessions}</div>
              </SectionCard>
              <SectionCard title="Abgeschlossene Sessions">
                <div className="text-xl font-semibold text-dbzs-green">{stats.completedSessions}</div>
              </SectionCard>
              <SectionCard title="Fehlgeschlagene Sessions">
                <div className="text-xl font-semibold text-dbzs-red">{stats.failedSessions}</div>
              </SectionCard>
              <SectionCard title="Tool-Aufrufe gesamt">
                <div className="text-xl font-semibold text-dbzs-text">{stats.totalToolCalls}</div>
              </SectionCard>
              <SectionCard title="Agent-Handoffs gesamt">
                <div className="text-xl font-semibold text-dbzs-text">{stats.totalHandoffs}</div>
              </SectionCard>
              <SectionCard title="Ø Session-Dauer">
                <div className="text-xl font-semibold text-dbzs-text">{formatDuration(stats.averageSessionDurationMs)}</div>
              </SectionCard>
              <SectionCard title="Bereinigung">
                <Button variant="danger" onClick={clearAllTraces}>
                  Alle Traces löschen
                </Button>
              </SectionCard>
            </>
          ) : (
            <SectionCard title="Statistiken">
              <div className="text-[10px] text-dbzs-muted">Noch keine Statistik verfügbar.</div>
            </SectionCard>
          )}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
          <SectionCard title={`Sessions (${traces.length})`}>
            <div className="max-h-[520px] space-y-2 overflow-y-auto">
              {traces.length === 0 ? (
                <div className="text-[10px] text-dbzs-muted">Noch keine Traces gespeichert.</div>
              ) : (
                traces.map((trace) => (
                  <button
                    className={`w-full rounded border px-2 py-2 text-left transition-colors ${
                      selectedTrace?.sessionId === trace.sessionId
                        ? "border-dbzs-cyan/50 bg-dbzs-cyan/10"
                        : "border-dbzs-border bg-dbzs-bg/50 hover:border-dbzs-cyan/30"
                    }`}
                    key={trace.sessionId}
                    onClick={() => setSelectedSessionId(trace.sessionId)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] text-dbzs-muted">{trace.sessionId.slice(0, 8)}</div>
                        <div className="truncate text-[11px] font-medium text-dbzs-text">{trace.targetAgent}</div>
                        <div className="mt-0.5 text-[10px] text-dbzs-muted">{formatTime(trace.startedAt)}</div>
                      </div>
                      <div className="shrink-0">{statusPillFor(trace.status)}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title={selectedTrace ? `Trace ${selectedTrace.sessionId.slice(0, 8)}` : "Trace-Details"}
            description={selectedTrace ? `${selectedTrace.targetAgent} · Dauer ${traceDuration(selectedTrace)}` : "Wähle links eine Session aus."}
            actions={
              selectedTrace ? (
                <>
                  {statusPillFor(selectedTrace.status)}
                  <Button onClick={() => exportTrace(selectedTrace)}>Export JSON</Button>
                </>
              ) : undefined
            }
          >
            {selectedTrace ? (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5">
                    <div className="text-[10px] text-dbzs-muted">Modell</div>
                    <div className="text-[11px] text-dbzs-text">{selectedTrace.modelName || selectedTrace.modelId || "n/a"}</div>
                  </div>
                  <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5">
                    <div className="text-[10px] text-dbzs-muted">Provider</div>
                    <div className="text-[11px] text-dbzs-text">{selectedTrace.providerId || "runtime"}</div>
                  </div>
                  <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5">
                    <div className="text-[10px] text-dbzs-muted">Prompt-Anzahl</div>
                    <div className="text-[11px] text-dbzs-text">{selectedTrace.metadata.userPromptCount}</div>
                  </div>
                  <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5">
                    <div className="text-[10px] text-dbzs-muted">Tool-Aufrufe</div>
                    <div className="text-[11px] text-dbzs-text">{selectedTrace.metadata.toolCallCount}</div>
                  </div>
                </div>

                <details className="rounded border border-dbzs-border/60 bg-dbzs-bg/40 p-2" open>
                  <summary className="cursor-pointer text-[11px] font-medium text-dbzs-text">
                    Context Proofs ({selectedTrace.contextProofs.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {selectedTrace.contextProofs.length === 0 ? (
                      <div className="text-[10px] text-dbzs-muted">Keine Context-Proofs erfasst.</div>
                    ) : (
                      selectedTrace.contextProofs.map((proof) => (
                        <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5 text-[10px]" key={proof.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-dbzs-text">{formatTime(proof.timestamp)}</span>
                            <span className="text-dbzs-muted">{proof.workspaceName || proof.workspaceRoot || "Kein Workspace"}</span>
                            {proof.activeFilePath ? <span className="text-dbzs-muted">{proof.activeFilePath}</span> : null}
                          </div>
                          <div className="mt-1 text-dbzs-muted">
                            Geladene Dateien: {proof.sampledFiles.length}
                            {proof.contextMentions.length > 0 ? ` · Mentions: ${proof.contextMentions.join(", ")}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details className="rounded border border-dbzs-border/60 bg-dbzs-bg/40 p-2" open>
                  <summary className="cursor-pointer text-[11px] font-medium text-dbzs-text">
                    Agent-Handoffs ({selectedTrace.handoffLogs.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {selectedTrace.handoffLogs.length === 0 ? (
                      <div className="text-[10px] text-dbzs-muted">Keine Agent-Handoffs erfasst.</div>
                    ) : (
                      selectedTrace.handoffLogs.map((handoff) => (
                        <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5 text-[10px]" key={handoff.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-dbzs-text">
                              {handoff.fromAgent} → {handoff.toAgent}
                            </div>
                            <div>{statusPillFor(handoff.status)}</div>
                          </div>
                          <div className="mt-1 text-dbzs-muted">{handoff.reason}</div>
                          {handoff.durationMs ? (
                            <div className="mt-1 text-dbzs-muted">Dauer: {formatDuration(handoff.durationMs)}</div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details className="rounded border border-dbzs-border/60 bg-dbzs-bg/40 p-2" open>
                  <summary className="cursor-pointer text-[11px] font-medium text-dbzs-text">
                    Tool-Ausführungen ({selectedTrace.toolExecutionLogs.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {selectedTrace.toolExecutionLogs.length === 0 ? (
                      <div className="text-[10px] text-dbzs-muted">Keine Tool-Aufrufe erfasst.</div>
                    ) : (
                      selectedTrace.toolExecutionLogs.map((toolLog) => (
                        <div className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1.5 text-[10px]" key={toolLog.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-dbzs-text">{toolLog.toolName}</div>
                            <div className="flex items-center gap-2">
                              {toolLog.durationMs ? (
                                <span className="text-dbzs-muted">{formatDuration(toolLog.durationMs)}</span>
                              ) : null}
                              {statusPillFor(toolLog.status)}
                            </div>
                          </div>
                          {toolLog.error ? (
                            <div className="mt-1 text-dbzs-red">{toolLog.error}</div>
                          ) : (
                            <div className="mt-1 text-dbzs-muted">Turn {toolLog.turn || "?"}</div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details className="rounded border border-dbzs-border/60 bg-dbzs-bg/40 p-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-dbzs-text">
                    Technische Metadaten
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded border border-dbzs-border/60 bg-[#061018] p-2 text-[9px] leading-4 text-dbzs-muted">
                    {JSON.stringify(selectedTrace.metadata, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="text-[10px] text-dbzs-muted">Noch keine Session ausgewählt.</div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
