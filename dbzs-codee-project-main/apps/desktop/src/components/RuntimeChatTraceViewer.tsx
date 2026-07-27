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

import React, { useState, useEffect, useMemo } from "react";
import { observabilityService } from "@/runtime/observability/observabilityService";
import type {
  ChatSessionTrace,
  ContextProof,
  AgentHandoffLog,
  ToolExecutionLog
} from "@/runtime/observability/chatSessionTrace";

interface TraceViewerProps {
  onClose?: () => void;
}

type TabType = "sessions" | "context" | "handoffs" | "tools" | "stats";

export function RuntimeChatTraceViewer({ onClose }: TraceViewerProps) {
  const [activeTab, setActiveTab] = useState<TabType>("sessions");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [traces, setTraces] = useState<ChatSessionTrace[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof observabilityService.getStatistics> | null>(null);
  const [expandedProofs, setExpandedProofs] = useState<Set<string>>(new Set());
  const [expandedHandoffs, setExpandedHandoffs] = useState<Set<string>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadTraces();
    loadStats();

    const interval = setInterval(() => {
      loadTraces();
      loadStats();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const loadTraces = () => {
    const allTraces = observabilityService.getAllTraces();
    setTraces(allTraces);
  };

  const loadStats = () => {
    setStats(observabilityService.getStatistics());
  };

  const selectedTrace = useMemo(
    () => traces.find((t) => t.sessionId === selectedSessionId) || null,
    [traces, selectedSessionId]
  );

  const toggleProofExpand = (proofId: string) => {
    setExpandedProofs((prev) => {
      const next = new Set(prev);
      if (next.has(proofId)) {
        next.delete(proofId);
      } else {
        next.add(proofId);
      }
      return next;
    });
  };

  const toggleHandoffExpand = (handoffId: string) => {
    setExpandedHandoffs((prev) => {
      const next = new Set(prev);
      if (next.has(handoffId)) {
        next.delete(handoffId);
      } else {
        next.add(handoffId);
      }
      return next;
    });
  };

  const toggleToolExpand = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const exportTrace = (trace: ChatSessionTrace) => {
    const json = observabilityService.exportTrace(trace.sessionId);
    if (json) {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trace-${trace.sessionId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const clearAllTraces = () => {
    if (confirm("Alle gespeicherten Traces löschen?")) {
      observabilityService.clearAllTraces();
      loadTraces();
      loadStats();
      setSelectedSessionId(null);
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (isoString: string): string => {
    return new Date(isoString).toLocaleString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit"
    });
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "completed":
      case "ok":
      case "done":
        return "text-green-400";
      case "failed":
      case "error":
        return "text-red-400";
      case "active":
      case "running":
      case "pending":
        return "text-yellow-400";
      case "cancelled":
      case "skipped":
        return "text-gray-400";
      default:
        return "text-gray-300";
    }
  };

  const renderSessionsTab = () => (
    <div className="flex h-full">
      {/* Session List */}
      <div className="w-80 border-r border-gray-700 overflow-y-auto">
        <div className="p-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200">Sessions ({traces.length})</h3>
        </div>
        <div className="divide-y divide-gray-800">
          {traces.map((trace) => (
            <button
              key={trace.sessionId}
              onClick={() => setSelectedSessionId(trace.sessionId)}
              className={`w-full text-left p-3 hover:bg-gray-800 transition-colors ${
                selectedSessionId === trace.sessionId ? "bg-gray-800" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-gray-500">{trace.sessionId.slice(0, 8)}</span>
                <span className={`text-xs ${getStatusColor(trace.status)}`}>{trace.status}</span>
              </div>
              <div className="text-sm text-gray-300 truncate">{trace.targetAgent}</div>
              <div className="text-xs text-gray-500 mt-1">{formatTime(trace.startedAt)}</div>
              {trace.finishedAt && (
                <div className="text-xs text-gray-600">
                  Dauer: {formatDuration(new Date(trace.finishedAt).getTime() - new Date(trace.startedAt).getTime())}
                </div>
              )}
            </button>
          ))}
          {traces.length === 0 && (
            <div className="p-4 text-center text-gray-500 text-sm">Keine Sessions gespeichert</div>
          )}
        </div>
      </div>

      {/* Session Details */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedTrace ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-200">Session Details</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => exportTrace(selectedTrace)}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded text-white"
                >
                  Export JSON
                </button>
                <button
                  onClick={() => setSelectedSessionId(null)}
                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white"
                >
                  Schließen
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-500">Agent</div>
                <div className="text-sm text-gray-200">{selectedTrace.targetAgent}</div>
              </div>
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-500">Status</div>
                <div className={`text-sm ${getStatusColor(selectedTrace.status)}`}>{selectedTrace.status}</div>
              </div>
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-500">Modell</div>
                <div className="text-sm text-gray-200">
                  {selectedTrace.modelName || selectedTrace.modelId || "N/A"}
                </div>
              </div>
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-500">Provider</div>
                <div className="text-sm text-gray-200">{selectedTrace.providerId || "runtime"}</div>
              </div>
            </div>

            <div className="bg-gray-800 rounded p-3 mb-4">
              <div className="text-xs text-gray-500 mb-2">Metadaten</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">User:</span>{" "}
                  <span className="text-gray-200">{selectedTrace.metadata.userPromptCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">Assistant:</span>{" "}
                  <span className="text-gray-200">{selectedTrace.metadata.assistantResponseCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">System:</span>{" "}
                  <span className="text-gray-200">{selectedTrace.metadata.systemMessageCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tools:</span>{" "}
                  <span className="text-gray-200">{selectedTrace.metadata.toolCallCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">Handoffs:</span>{" "}
                  <span className="text-gray-200">{selectedTrace.handoffLogs.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Zeichen:</span>{" "}
                  <span className="text-gray-200">{selectedTrace.metadata.totalCharacters.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Context Proofs */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-2">
                Context Proofs ({selectedTrace.contextProofs.length})
              </h4>
              {selectedTrace.contextProofs.map((proof, idx) => (
                <div key={proof.id} className="bg-gray-800 rounded mb-2">
                  <button
                    onClick={() => toggleProofExpand(proof.id)}
                    className="w-full p-3 text-left hover:bg-gray-700 rounded transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">Proof #{idx + 1}</span>
                      <span className="text-xs text-gray-500">{formatTime(proof.timestamp)}</span>
                    </div>
                  </button>
                  {expandedProofs.has(proof.id) && (
                    <div className="p-3 border-t border-gray-700 text-xs space-y-2">
                      <div>
                        <span className="text-gray-500">Workspace:</span>{" "}
                        <span className="text-gray-300">{proof.workspaceName || proof.workspaceRoot || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Aktive Datei:</span>{" "}
                        <span className="text-gray-300">{proof.activeFilePath || "Keine"}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Geladene Dateien:</span>{" "}
                        <span className="text-gray-300">{proof.sampledFiles.length}</span>
                      </div>
                      {proof.sampledFiles.length > 0 && (
                        <div className="mt-2">
                          <div className="text-gray-500 mb-1">Dateien:</div>
                          <ul className="list-disc list-inside text-gray-400">
                            {proof.sampledFiles.map((f) => (
                              <li key={f.relativePath}>
                                {f.relativePath} ({f.contentLength} chars)
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {proof.contextMentions.length > 0 && (
                        <div>
                          <span className="text-gray-500">Mentions:</span>{" "}
                          <span className="text-gray-300">{proof.contextMentions.join(", ")}</span>
                        </div>
                      )}
                      {proof.enabledSkillIds.length > 0 && (
                        <div>
                          <span className="text-gray-500">Skills:</span>{" "}
                          <span className="text-gray-300">{proof.enabledSkillIds.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {selectedTrace.contextProofs.length === 0 && (
                <div className="text-sm text-gray-500 italic">Keine Context-Proofs erfasst</div>
              )}
            </div>

            {/* Agent Handoffs */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-2">
                Agent Handoffs ({selectedTrace.handoffLogs.length})
              </h4>
              {selectedTrace.handoffLogs.map((handoff, idx) => (
                <div key={handoff.id} className="bg-gray-800 rounded mb-2">
                  <button
                    onClick={() => toggleHandoffExpand(handoff.id)}
                    className="w-full p-3 text-left hover:bg-gray-700 rounded transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">
                        {handoff.fromAgent} → {handoff.toAgent}
                      </span>
                      <span className={`text-xs ${getStatusColor(handoff.status)}`}>{handoff.status}</span>
                    </div>
                  </button>
                  {expandedHandoffs.has(handoff.id) && (
                    <div className="p-3 border-t border-gray-700 text-xs space-y-2">
                      <div>
                        <span className="text-gray-500">Grund:</span>{" "}
                        <span className="text-gray-300">{handoff.reason}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Input:</span>{" "}
                        <span className="text-gray-300">{handoff.inputSummary.slice(0, 100)}...</span>
                      </div>
                      {handoff.actualOutput && (
                        <div>
                          <span className="text-gray-500">Output:</span>{" "}
                          <span className="text-gray-300">{handoff.actualOutput.slice(0, 100)}...</span>
                        </div>
                      )}
                      {handoff.durationMs && (
                        <div>
                          <span className="text-gray-500">Dauer:</span>{" "}
                          <span className="text-gray-300">{formatDuration(handoff.durationMs)}</span>
                        </div>
                      )}
                      {handoff.error && (
                        <div className="text-red-400">Fehler: {handoff.error}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {selectedTrace.handoffLogs.length === 0 && (
                <div className="text-sm text-gray-500 italic">Keine Agent-Handoffs erfasst</div>
              )}
            </div>

            {/* Tool Executions */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-2">
                Tool Executions ({selectedTrace.toolExecutionLogs.length})
              </h4>
              {selectedTrace.toolExecutionLogs.map((toolLog, idx) => (
                <div key={toolLog.id} className="bg-gray-800 rounded mb-2">
                  <button
                    onClick={() => toggleToolExpand(toolLog.id)}
                    className="w-full p-3 text-left hover:bg-gray-700 rounded transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">{toolLog.toolName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Turn {toolLog.turn || "?"}</span>
                        <span className={`text-xs ${getStatusColor(toolLog.status)}`}>{toolLog.status}</span>
                      </div>
                    </div>
                  </button>
                  {expandedTools.has(toolLog.id) && (
                    <div className="p-3 border-t border-gray-700 text-xs space-y-2">
                      <div>
                        <span className="text-gray-500">Input:</span>
                        <pre className="mt-1 bg-gray-900 rounded p-2 text-gray-300 overflow-auto max-h-32">
                          {JSON.stringify(toolLog.input, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <span className="text-gray-500">Output:</span>
                        <pre className="mt-1 bg-gray-900 rounded p-2 text-gray-300 overflow-auto max-h-32">
                          {JSON.stringify(toolLog.output, null, 2)}
                        </pre>
                      </div>
                      {toolLog.durationMs && (
                        <div>
                          <span className="text-gray-500">Dauer:</span>{" "}
                          <span className="text-gray-300">{formatDuration(toolLog.durationMs)}</span>
                        </div>
                      )}
                      {toolLog.error && (
                        <div className="text-red-400">Fehler: {toolLog.error}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {selectedTrace.toolExecutionLogs.length === 0 && (
                <div className="text-sm text-gray-500 italic">Keine Tool-Aufrufe erfasst</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-500 mt-8">
            Wähle eine Session aus der Liste
          </div>
        )}
      </div>
    </div>
  );

  const renderStatsTab = () => (
    <div className="p-4">
      <h3 className="text-lg font-semibold text-gray-200 mb-4">Statistiken</h3>
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Gesamte Sessions</div>
            <div className="text-2xl font-bold text-gray-200">{stats.totalSessions}</div>
          </div>
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Aktive Sessions</div>
            <div className="text-2xl font-bold text-yellow-400">{stats.activeSessions}</div>
          </div>
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Abgeschlossene Sessions</div>
            <div className="text-2xl font-bold text-green-400">{stats.completedSessions}</div>
          </div>
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Fehlgeschlagene Sessions</div>
            <div className="text-2xl font-bold text-red-400">{stats.failedSessions}</div>
          </div>
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Tool-Aufrufe gesamt</div>
            <div className="text-2xl font-bold text-blue-400">{stats.totalToolCalls}</div>
          </div>
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Agent-Handoffs gesamt</div>
            <div className="text-2xl font-bold text-purple-400">{stats.totalHandoffs}</div>
          </div>
          <div className="bg-gray-800 rounded p-4">
            <div className="text-xs text-gray-500">Ø Session-Dauer</div>
            <div className="text-2xl font-bold text-gray-200">
              {formatDuration(stats.averageSessionDurationMs)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={clearAllTraces}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
        >
          Alle Traces löschen
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <h2 className="text-lg font-semibold">Observability Trace Viewer</h2>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
            >
              Schließen
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab("sessions")}
          className={`px-4 py-2 text-sm ${
            activeTab === "sessions"
              ? "bg-gray-800 text-white border-b-2 border-blue-500"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Sessions
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={`px-4 py-2 text-sm ${
            activeTab === "stats"
              ? "bg-gray-800 text-white border-b-2 border-blue-500"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Statistiken
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "sessions" && renderSessionsTab()}
        {activeTab === "stats" && renderStatsTab()}
      </div>
    </div>
  );
}
