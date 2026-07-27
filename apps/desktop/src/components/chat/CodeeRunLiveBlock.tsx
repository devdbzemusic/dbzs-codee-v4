import React, { useMemo, useState, useEffect } from "react";
import {
  workspaceScopeId,
  type RuntimeChatRun,
  type RuntimeChatEvent,
  type RuntimeChatToolCall,
  type RuntimeChatFileChange
} from "@dbzs/shared";
import { useEditorStore } from "@/stores/editorStore";
import { formatModelDisplayLabel } from "@/services/modelSelectionBroker";
import { resolveEffectiveRuntimeDevice } from "@/services/agentTurnBudget";

interface CodeeRunLiveBlockProps {
  run: RuntimeChatRun;
  onCancel: () => void;
  isSending: boolean;
  workspaceRoot?: string | null;
  onFixFindings?: (reviewId: string) => void;
  onRerunReview?: () => void;
}

export function CodeeRunLiveBlock({
  run,
  onCancel,
  isSending,
  workspaceRoot,
  onFixFindings,
  onRerunReview
}: CodeeRunLiveBlockProps) {
  const [elapsed, setElapsed] = useState(0);

  // Der Timer zeigt ausschließlich die tatsächliche Laufzeit. Timeout- und
  // Providerfehler kommen als echte Runtime-Ereignisse, nicht aus UI-Heuristik.
  useEffect(() => {
    if (!isSending || run.finishedAt) return;
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isSending, run.finishedAt]);

  const duration = useMemo(() => {
    const start = new Date(run.startedAt).getTime();
    const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
    return ((end - start) / 1000).toFixed(1);
  }, [run.startedAt, run.finishedAt, isSending, elapsed]);

  // Hat das Modell angefangen, Content/Tokens zu liefern?
  const isSuccessfulCompletion = run.status === "completed" && (run.outcome == null || run.outcome === "success");
  const isFailedTerminal =
    run.status === "failed" ||
    run.status === "timeout" ||
    (run.outcome != null &&
      run.outcome !== "success" &&
      run.outcome !== "needs_user_input" &&
      run.outcome !== "cancelled");
  const isDegradedRun =
    run.degraded === true ||
    run.selectionSource === "explicit_fallback" ||
    run.selectionSource === "resident_continue";

  const activeEvent = useMemo(() => {
    if (run.events.length === 0) return null;
    return run.events[run.events.length - 1];
  }, [run.events]);

  const statusLabel = () => {
    switch (run.status) {
      case "preparing":
        return "Bereitet vor...";
      case "routing":
        return "Routet...";
      case "waiting_first_token":
        return "Warte auf erstes Token...";
      case "streaming":
        return "Empfängt Antwort...";
      case "running_tools":
        return "Führt Tools aus...";
      case "completed":
        return isSuccessfulCompletion ? "Antwort erfolgreich abgeschlossen" : "Abgeschlossen";
      case "cancelled":
        return "Abgebrochen";
      case "failed":
        return "Fehlgeschlagen";
      default:
        return "Wartet...";
    }
  };

  // Hilfsmethoden für Editor-Kopplung
  const handleOpenDiff = async (filePath: string) => {
    await useEditorStore.getState().openWorkspaceFile(filePath);
  };

  const handleApplyChange = async (filePath: string) => {
    try {
      await useEditorStore.getState().applyPendingChange(filePath);
    } catch (e: any) {
      alert(`Fehler beim Übernehmen: ${e.message}`);
    }
  };

  const handleDiscardChange = (id: string, filePath: string) => {
    // Verwerfe über id oder dateipfad
    try {
      useEditorStore.getState().rejectProposedChange(id);
    } catch (e) {
      // Fallback
      useEditorStore.getState().discardPendingChange(filePath);
    }
  };

  // Diagnose-Export als JSON
  const handleExportDiagnostics = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(run, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `codee-run-${run.id || "diagnostic"}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const reviewActionsAllowed =
    Boolean(workspaceRoot && run.repositoryReview) &&
    (!run.repositoryReview?.workspaceId ||
      run.repositoryReview.workspaceId === workspaceScopeId(workspaceRoot!));

  const handleOpenReviewArtifact = async (kind: "report" | "findings") => {
    if (!workspaceRoot || !run.repositoryReview || !window.dbzs.openReviewArtifact) return;
    const file = await window.dbzs.openReviewArtifact(
      workspaceRoot,
      run.repositoryReview.reviewId,
      kind
    );
    await useEditorStore.getState().openWorkspaceFile(file.path);
  };

  return (
    <div className="my-3 rounded-lg border border-dbzs-border bg-dbzs-panel p-3 text-xs leading-relaxed text-dbzs-text shadow-sm">
      {/* Run Header */}
      <div className="flex items-center justify-between border-b border-dbzs-border/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSuccessfulCompletion ? "bg-green-400" : isFailedTerminal ? "bg-red-400" : "bg-dbzs-cyan"}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isSuccessfulCompletion ? "bg-green-500" : isFailedTerminal ? "bg-red-500" : "bg-dbzs-cyan"}`}></span>
          </span>
          <span className="font-bold tracking-wide uppercase text-[10px] text-dbzs-cyan">CODEE RUN</span>
          <span className="text-[10px] text-dbzs-muted">
            · {run.provider ?? "Core"} · Run-Modell: {formatModelDisplayLabel(run.modelName, run.modelId)} · {run.mode === "agent" ? "Agent" : "Auto"}
            {run.slotId ? ` · ${run.slotId}` : ""}
            {run.contextStage !== undefined ? ` · Stufe ${run.contextStage}` : ""}
            {run.outcome ? ` · ${run.outcome}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-dbzs-muted">{duration}s</span>
          {isSending && (
            <button
              onClick={onCancel}
              className="rounded border border-dbzs-red/40 bg-dbzs-red/10 px-2 py-0.5 text-[9px] font-medium text-dbzs-red hover:bg-dbzs-red/20"
              type="button"
            >
              Stopp
            </button>
          )}
        </div>
      </div>

      {(run.workflowLabel ||
        run.phaseLabel ||
        run.targetAgentLabel ||
        run.configuredModelId ||
        run.selectionSource ||
        run.settingsRevision != null ||
        run.warmupStatus) && (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-bg/40 px-2 py-1.5 font-mono text-[9px] text-dbzs-muted space-y-0.5">
          {run.workflowLabel && <div>Workflow: {run.workflowLabel}</div>}
          {run.phaseLabel && <div>Phase: {run.phaseLabel}</div>}
          {run.targetAgentLabel && <div>Agent: {run.targetAgentLabel}</div>}
          {run.configuredModelId && <div>Rollenmodell: {run.configuredModelId}</div>}
          {run.modelId && <div>Modell-ID: {run.modelId}</div>}
          {run.modelName && <div>Modellname: {formatModelDisplayLabel(run.modelName, run.modelId)}</div>}
          {run.slotId && <div>Slot: {run.slotId}</div>}
          {run.slotExecutionState && (() => {
            const device = resolveEffectiveRuntimeDevice({
              configuredSlot: run.slotId ?? "unknown",
              gpuLayers: run.slotExecutionState.gpuLayers
            });
            return (
              <div>
                Ausführung:{" "}
                {device.effectiveDevice === "cpu"
                  ? "CPU-Fallback"
                  : device.effectiveDevice === "hybrid"
                    ? "Hybrid"
                    : "GPU"}
                {device.gpuLayers != null ? ` · GPU-Layer=${device.gpuLayers}` : ""}
              </div>
            );
          })()}
          {run.selectionSource && <div>Quelle: {run.selectionSource}</div>}
          {run.settingsRevision != null && <div>Settings Revision: {run.settingsRevision}</div>}
          {run.warmupStatus && <div>Runtime: {run.warmupStatus === "ready" ? "inference_ready" : run.warmupStatus}</div>}
          {run.readinessStage && <div>Readiness: {run.readinessStage}</div>}
          {run.resourceRisk && <div>Resource Risk: {run.resourceRisk}</div>}
          {run.slotExecutionState && (
            <div>
              Slot Ready: process={run.slotExecutionState.processRunning ? "ja" : "nein"} · endpoint=
              {run.slotExecutionState.endpointReachable ? "ja" : "nein"} · model=
              {run.slotExecutionState.modelLoaded ? "ja" : "nein"} · busy=
              {run.slotExecutionState.slotBusy ? "ja" : "nein"}
            </div>
          )}
          {run.warmupDiagnostics?.firstTokenMs != null && run.warmupDiagnostics.firstTokenMs > 0 && (
            <div>Warmup First Token: {run.warmupDiagnostics.firstTokenMs} ms</div>
          )}
          {run.fallbackReason && <div>Fallback: {run.fallbackReason}</div>}
          {run.outcome && <div>Outcome: {run.outcome}</div>}
        </div>
      )}

      {isDegradedRun && (
        <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
          Run im degradierten Modus fortgesetzt.
          {run.degradedReason || run.fallbackReason ? ` ${run.degradedReason ?? run.fallbackReason}` : ""}
        </div>
      )}

      {run.repositoryReview && (
        <div className="mt-2 rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-1.5 font-mono text-[9px] text-dbzs-muted space-y-0.5">
          <div className="font-medium text-cyan-300/90">Repository Review</div>
          <div>
            Scope:{" "}
            {run.repositoryReview.scope === "full_repository"
              ? "Gesamtes Projekt"
              : run.repositoryReview.scope === "uncommitted_changes"
                ? "Nicht commitete Änderungen"
                : run.repositoryReview.scope === "last_commit"
                  ? "Letzter Commit"
                  : run.repositoryReview.scope === "active_file"
                    ? "Aktive Datei"
                    : run.repositoryReview.scope}
          </div>
          <div>
            Fortschritt: {run.repositoryReview.completedBatches} / {run.repositoryReview.totalBatches}{" "}
            Batches
          </div>
          {isSending && run.repositoryReview.status === "running" && (
            <div className="text-cyan-200">
              Review läuft · {run.repositoryReview.completedBatches}/{run.repositoryReview.totalBatches} Batches ·{" "}
              {Math.floor(Number(duration) / 60)
                .toString()
                .padStart(2, "0")}
              :
              {Math.floor(Number(duration) % 60)
                .toString()
                .padStart(2, "0")}{" "}
              min
            </div>
          )}
          {run.repositoryReview.checks.length > 0 && (
            <div className="space-y-0.5">
              <div>Checks:</div>
              {run.repositoryReview.checks.map((check) => (
                <div key={check.id}>
                  {check.status === "passed"
                    ? "✓"
                    : check.status === "failed"
                      ? "✗"
                      : "○"}{" "}
                  {check.label}
                  {check.status === "not_executed" || check.status === "not_available"
                    ? " nicht ausgeführt"
                    : ""}
                </div>
              ))}
            </div>
          )}
          {run.repositoryReview.currentBatchTitle && (
            <div>Aktueller Batch: {run.repositoryReview.currentBatchTitle}</div>
          )}
          {run.repositoryReview.severityCounts && (
            <div>
              P0: {run.repositoryReview.severityCounts.P0 ?? 0} · P1:{" "}
              {run.repositoryReview.severityCounts.P1 ?? 0} · P2:{" "}
              {run.repositoryReview.severityCounts.P2 ?? 0} · P3:{" "}
              {run.repositoryReview.severityCounts.P3 ?? 0}
            </div>
          )}
          {run.repositoryReview.reportPath && (
            <div>Report: {run.repositoryReview.reportPath}</div>
          )}
          {run.repositoryReview.findingsPath && (
            <div>Findings JSON: {run.repositoryReview.findingsPath}</div>
          )}
          {run.repositoryReview.outcome && <div>Review-Outcome: {run.repositoryReview.outcome}</div>}
          {run.repositoryReview.status === "completed" && (
            <div>
              Abschluss nach {Math.floor(Number(duration) / 60)
                .toString()
                .padStart(2, "0")}:
              {Math.floor(Number(duration) % 60)
                .toString()
                .padStart(2, "0")} min
            </div>
          )}
          {run.repositoryReview.analyzerDiagnostics && (
            <div>
              Analyse: LLM{" "}
              {run.repositoryReview.analyzerDiagnostics.filter((item) => item.llmSucceeded).length}/
              {run.repositoryReview.analyzerDiagnostics.length} · Heuristik{" "}
              {run.repositoryReview.analyzerDiagnostics.filter((item) => item.heuristicExecuted).length}/
              {run.repositoryReview.analyzerDiagnostics.length}
            </div>
          )}
          {run.repositoryReview.quality && (
            <div className={run.repositoryReview.quality.confidence === "low" ? "text-amber-300" : "text-cyan-200"}>
              Qualitätsstatus: {run.repositoryReview.quality.confidence} · Analyzer{" "}
              {Math.round(run.repositoryReview.quality.analyzerCoverage * 100)} % · Dateien{" "}
              {run.repositoryReview.quality.reviewedFileCount}/{run.repositoryReview.quality.plannedFileCount}
            </div>
          )}
          {run.repositoryReview.productionReadiness && (
            <div>
              Production Readiness:{" "}
              {typeof run.repositoryReview.productionReadiness.score === "number"
                ? `${run.repositoryReview.productionReadiness.score}/100`
                : "nicht belastbar"}{" "}
              · Confidence {run.repositoryReview.productionReadiness.confidence}
            </div>
          )}
          {run.repositoryReview.topFindings && run.repositoryReview.topFindings.length > 0 && (
            <div>
              <div>Top Findings:</div>
              {run.repositoryReview.topFindings.map((finding, index) => (
                <div key={finding.id}>
                  {index + 1}. [{finding.severity}] {finding.title} · {finding.path}
                </div>
              ))}
            </div>
          )}
          {run.repositoryReview.quality?.warnings.map((warning) => (
            <div className="text-amber-300" key={warning}>Warnung: {warning}</div>
          ))}
          <div className="mt-1 flex flex-wrap gap-1 font-sans">
            <button
              className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-200 disabled:opacity-40"
              disabled={!reviewActionsAllowed}
              onClick={() => void handleOpenReviewArtifact("report")}
              type="button"
            >
              Report öffnen
            </button>
            <button
              className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-200 disabled:opacity-40"
              disabled={!reviewActionsAllowed}
              onClick={() => void handleOpenReviewArtifact("findings")}
              type="button"
            >
              Findings öffnen
            </button>
            <button
              className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-200 disabled:opacity-40"
              disabled={!reviewActionsAllowed || !workspaceRoot}
              onClick={() =>
                workspaceRoot &&
                void window.dbzs.revealReviewArtifacts?.(
                  workspaceRoot,
                  run.repositoryReview!.reviewId
                )
              }
              type="button"
            >
              Artefaktordner öffnen
            </button>
            {run.repositoryReview.status === "completed" && (
              <>
                <button
                  className="rounded border border-dbzs-amber/40 px-1.5 py-0.5 text-[10px] text-dbzs-amber disabled:opacity-40"
                  disabled={!reviewActionsAllowed || !onFixFindings}
                  onClick={() => onFixFindings?.(run.repositoryReview!.reviewId)}
                  type="button"
                >
                  Findings beheben
                </button>
                <button
                  className="rounded border border-dbzs-border px-1.5 py-0.5 text-[10px] text-dbzs-muted disabled:opacity-40"
                  disabled={!reviewActionsAllowed || !onRerunReview}
                  onClick={onRerunReview}
                  type="button"
                >
                  Review erneut ausführen
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {(run.tokenBudget || run.contextFallbackApplied) && (
        <div className="mt-2 rounded border border-dbzs-border/60 bg-dbzs-bg/40 px-2 py-1.5 font-mono text-[9px] text-dbzs-muted">
          {run.tokenBudget && (
            <div>
              Budget: in {run.tokenBudget.totalInputTokens} + out {run.tokenBudget.outputReserveTokens} ={" "}
              {run.tokenBudget.totalRequiredTokens} / {run.tokenBudget.runtimeContextLimit}
              {run.tokenBudget.overflowTokens > 0 ? ` · overflow ${run.tokenBudget.overflowTokens}` : ""}
            </div>
          )}
          {run.contextFallbackApplied && (
            <div>Fallback: minimal planning · dropped {run.droppedSources?.length ?? 0}</div>
          )}
          {run.outcome === "context_overflow" && (
            <div className="text-red-400">Outcome: context_overflow (kein Erfolg)</div>
          )}
        </div>
      )}

      {/* Steps List */}
      <div className="mt-3 space-y-2">
          {run.events.map((event: RuntimeChatEvent, idx: number) => {
            const isFailure =
              event.type === "chat.failed" ||
              event.type === "chat.timeout" ||
              run.outcome === "context_overflow";
            return (
          <div key={event.id || idx} className="flex items-start gap-2">
            <span className={isFailure ? "text-red-400 font-bold" : "text-green-400 font-bold"}>
              {isFailure ? "!" : "✓"}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-dbzs-text font-medium">{event.message}</span>
              {event.durationMs && (
                <span className="ml-2 font-mono text-[9px] text-dbzs-muted">
                  ({(event.durationMs / 1000).toFixed(2)}s)
                </span>
              )}
            </div>
          </div>
            );
          })}

        {isFailedTerminal && run.finalAnswerDiagnostics?.correlationId ? (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[10px] text-red-300">
            <div className="font-medium">✗ Endantwort nicht verwertbar</div>
            <div className="mt-0.5 opacity-90">Diagnose-ID: {String(run.finalAnswerDiagnostics.correlationId)}</div>
            {run.outcome ? <div className="mt-0.5 opacity-90">Outcome: {run.outcome}</div> : null}
          </div>
        ) : null}

        {isSuccessfulCompletion && !isSending ? (
          <div className="mt-2 text-[10px] font-medium text-green-500/90">
            ✓ Antwort erfolgreich abgeschlossen · Gültige Endantwort ausgeliefert
          </div>
        ) : null}

        {run.tokenBudget &&
        typeof run.tokenBudget.runtimeContextLimit === "number" &&
        run.tokenBudget.runtimeContextLimit > 0 &&
        run.tokenBudget.runtimeContextLimit - run.tokenBudget.totalRequiredTokens <
          Math.ceil(run.tokenBudget.runtimeContextLimit * 0.1) ? (
          <div className="mt-2 text-[10px] text-amber-400">
            Context-Sicherheitsmarge unter 10 % (
            {Math.max(0, run.tokenBudget.runtimeContextLimit - run.tokenBudget.totalRequiredTokens)} Tokens Reserve)
          </div>
        ) : null}

        {isSending && run.status !== "completed" && (
          <div className="flex items-center gap-2 text-dbzs-muted animate-pulse">
            <span className="text-dbzs-cyan">●</span>
            <span>{statusLabel()}</span>
          </div>
        )}
      </div>

      {/* Tool-Aufrufe direkt im Run-Block zeigen */}
      {run.toolCalls && run.toolCalls.length > 0 && (
        <div className="mt-4 border-t border-dbzs-border/50 pt-3">
          <div className="text-[10px] font-bold text-dbzs-muted uppercase tracking-wider mb-2">Ausgeführte Tools</div>
          <div className="space-y-2">
            {run.toolCalls.map((tool: RuntimeChatToolCall) => {
              const borderCol =
                tool.status === "completed"
                  ? "border-green-500/30 bg-green-500/5 text-green-400"
                  : tool.status === "failed"
                  ? "border-red-500/30 bg-red-400/5 text-red-400"
                  : "border-dbzs-cyan/30 bg-dbzs-cyan/5 animate-pulse text-dbzs-cyan";

              return (
                <div key={tool.id} className={`rounded border p-2 text-[10.5px] ${borderCol}`}>
                  <div className="flex items-center justify-between font-mono font-bold uppercase text-[9.5px]">
                    <span>{tool.name}</span>
                    <span>{tool.status}</span>
                  </div>
                  {tool.filePath && (
                    <div className="mt-1 font-mono text-[9px] text-dbzs-text truncate">
                      Pfad: <span className="opacity-80">{tool.filePath}</span>
                    </div>
                  )}
                  {tool.arguments && tool.arguments !== "{}" && (
                    <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-dbzs-bg/50 p-1 font-mono text-[9px] text-dbzs-muted leading-relaxed">
                      {tool.arguments}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Code-Änderungen / Patches */}
      {run.fileChanges && run.fileChanges.length > 0 && (
        <div className="mt-4 border-t border-dbzs-border/50 pt-3">
          <div className="text-[10px] font-bold text-dbzs-muted uppercase tracking-wider mb-2">Vorgeschlagene Dateiänderungen</div>
          <div className="space-y-2">
            {run.fileChanges.map((change: RuntimeChatFileChange) => {
              // Status Styling
              const statusCol =
                change.status === "applied"
                  ? "border-green-500/30 bg-green-500/5 text-green-400"
                  : change.status === "rejected"
                  ? "border-red-500/30 bg-red-500/5 text-red-400 line-through"
                  : "border-dbzs-border bg-dbzs-panel text-dbzs-text";

              return (
                <div key={change.id} className={`rounded border p-2.5 ${statusCol}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold truncate text-[11px] max-w-[200px]">{change.filePath}</span>
                    <span className="text-[10px] font-mono font-medium text-green-400">+{change.additions} Zeilen</span>
                  </div>

                  {change.status === "proposed" && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        onClick={() => handleOpenDiff(change.filePath)}
                        className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] font-medium hover:bg-dbzs-border/40"
                        type="button"
                      >
                        Diff anzeigen
                      </button>
                      <button
                        onClick={() => handleApplyChange(change.filePath)}
                        className="rounded border border-green-500/40 bg-green-500/15 px-2 py-0.5 text-[10px] font-bold text-green-400 hover:bg-green-500/25"
                        type="button"
                      >
                        Anwenden
                      </button>
                      <button
                        onClick={() => handleDiscardChange(change.id, change.filePath)}
                        className="rounded border border-dbzs-border bg-dbzs-bg px-2 py-0.5 text-[10px] font-medium text-dbzs-muted hover:bg-dbzs-border/40"
                        type="button"
                      >
                        Verwerfen
                      </button>
                    </div>
                  )}

                  {change.status === "applied" && (
                    <div className="mt-1.5 text-[10px] text-green-500/80 font-medium">✓ Erfolgreich auf Workspace angewendet</div>
                  )}
                  {change.status === "rejected" && (
                    <div className="mt-1.5 text-[10px] text-red-500/80 font-medium">✗ Vorschlag verworfen</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer-Actions: Diagnose exportieren */}
      <div className="mt-4 flex items-center justify-between border-t border-dbzs-border/40 pt-2 text-[10px] text-dbzs-muted">
        <span>Run-ID: <span className="font-mono text-[9px] opacity-70">{run.id.slice(0, 8)}...</span></span>
        <button
          onClick={handleExportDiagnostics}
          className="underline hover:text-dbzs-cyan transition-colors"
          type="button"
        >
          Diagnose-Protokoll exportieren (JSON)
        </button>
      </div>
    </div>
  );
}
