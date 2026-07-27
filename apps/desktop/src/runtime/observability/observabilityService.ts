/*
 * DBZS – Division By Zeros
 * Datei: observabilityService.ts
 * Bereich: Runtime Observability
 *
 * Zweck:
 *   Zentrales Service für Sammlung, Speicherung und Export von Observability-Daten.
 *
 * Warum:
 *   Traces müssen persistent gespeichert werden für spätere Analyse und Debugging.
 *
 * Wozu:
 *   Ermöglicht Nachvollziehbarkeit von Chat-Sessions, Agent-Handoffs und Tool-Aufrufen.
 *
 * Input:
 *   Observability-Events aus allen Runtime-Komponenten
 *
 * Output:
 *   Gespeicherte Traces, Export-Files, Statistik
 *
 * Eltern:
 *   runtimeChatStore, runtimeChatAgentRunner, toolExecutor
 *
 * Kinder:
 *   localStorage / IndexedDB / File-System (je nach Umgebung)
 *
 * Hinweise:
 *   - Speichert Traces persistent im localStorage (max. 100 Sessions)
 *   - Export als JSON möglich
 *   - Keine Secrets speichern
 */

import type {
  ChatSessionTrace,
  ContextProof,
  AgentHandoffLog,
  ToolExecutionLog,
  ObservabilityEvent
} from "@/runtime/observability/chatSessionTrace";

const STORAGE_KEY_PREFIX = "dbzs-observability-";
const TRACES_INDEX_KEY = "dbzs-observability-traces-index";
const MAX_TRACES = 100;

interface TraceIndexEntry {
  sessionId: string;
  startedAt: string;
  finishedAt?: string;
  targetAgent: string;
  status: string;
  workspaceRoot: string | null;
}

class ObservabilityServiceClass {
  private traceStore: Map<string, ChatSessionTrace> = new Map();
  private eventListeners: Set<(event: ObservabilityEvent) => void> = new Set();
  private initialized = false;

  /**
   * Initialisiert das Service und lädt gespeicherte Traces.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (typeof localStorage === "undefined") {
      console.warn("[ObservabilityService] localStorage nicht verfügbar – nur In-Memory-Speicherung");
      this.initialized = true;
      return;
    }

    try {
      const indexJson = localStorage.getItem(TRACES_INDEX_KEY);
      if (indexJson) {
        const index: TraceIndexEntry[] = JSON.parse(indexJson);
        for (const entry of index) {
          const traceJson = localStorage.getItem(`${STORAGE_KEY_PREFIX}${entry.sessionId}`);
          if (traceJson) {
            const trace = JSON.parse(traceJson) as ChatSessionTrace;
            this.traceStore.set(entry.sessionId, trace);
          }
        }
        console.log(`[ObservabilityService] ${this.traceStore.size} Traces geladen`);
      }
    } catch (error) {
      console.error("[ObservabilityService] Fehler beim Laden gespeicherter Traces:", error);
    }

    this.initialized = true;
  }

  /**
   * Registriert einen Event-Listener.
   */
  onEvent(listener: (event: ObservabilityEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Sendet ein Event an alle Listener.
   */
  private emitEvent(event: ObservabilityEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[ObservabilityService] Event-Listener Fehler:", error);
      }
    }
  }

  /**
   * Speichert einen Trace persistent.
   */
  private async persistTrace(trace: ChatSessionTrace): Promise<void> {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      const indexJson = localStorage.getItem(TRACES_INDEX_KEY);
      const index: TraceIndexEntry[] = indexJson ? JSON.parse(indexJson) : [];

      const existingIndex = index.findIndex((e) => e.sessionId === trace.sessionId);
      const entry: TraceIndexEntry = {
        sessionId: trace.sessionId,
        startedAt: trace.startedAt,
        finishedAt: trace.finishedAt,
        targetAgent: trace.targetAgent,
        status: trace.status,
        workspaceRoot: trace.workspaceRoot
      };

      if (existingIndex >= 0) {
        index[existingIndex] = entry;
      } else {
        index.unshift(entry);
      }

      while (index.length > MAX_TRACES) {
        const removed = index.pop();
        if (removed) {
          localStorage.removeItem(`${STORAGE_KEY_PREFIX}${removed.sessionId}`);
          this.traceStore.delete(removed.sessionId);
        }
      }

      localStorage.setItem(TRACES_INDEX_KEY, JSON.stringify(index));
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${trace.sessionId}`, JSON.stringify(trace));
      this.traceStore.set(trace.sessionId, trace);
    } catch (error) {
      console.error("[ObservabilityService] Fehler beim Speichern des Traces:", error);
    }
  }

  /**
   * Verarbeitet ein Observability-Event.
   */
  handleEvent(event: ObservabilityEvent): void {
    this.emitEvent(event);

    switch (event.type) {
      case "chat_session_started": {
        console.log(`[ObservabilityService] Session gestartet: ${event.trace.sessionId}`);
        this.persistTrace(event.trace);
        break;
      }

      case "chat_session_finished": {
        console.log(`[ObservabilityService] Session beendet: ${event.trace.sessionId} (${event.trace.status})`);
        this.persistTrace(event.trace);
        break;
      }

      case "context_proof_created": {
        const trace = this.traceStore.get(event.sessionId);
        if (trace) {
          trace.contextProofs.push(event.proof);
          this.persistTrace(trace);
        }
        break;
      }

      case "agent_handoff_initiated": {
        const trace = this.traceStore.get(event.sessionId);
        if (trace) {
          trace.handoffLogs.push(event.handoff);
          this.persistTrace(trace);
        }
        break;
      }

      case "agent_handoff_completed": {
        const trace = this.traceStore.get(event.sessionId);
        if (trace) {
          const handoff = trace.handoffLogs.find((h) => h.id === event.handoffId);
          if (handoff) {
            handoff.status = "completed";
            handoff.actualOutput = event.output;
            handoff.durationMs = Date.now() - new Date(handoff.timestamp).getTime();
            this.persistTrace(trace);
          }
        }
        break;
      }

      case "tool_execution_started": {
        const trace = this.traceStore.get(event.sessionId);
        if (trace) {
          trace.toolExecutionLogs.push(event.toolCall);
          this.persistTrace(trace);
        }
        break;
      }

      case "tool_execution_completed": {
        const trace = this.traceStore.get(event.sessionId);
        if (trace) {
          const toolLog = trace.toolExecutionLogs.find((t) => t.id === event.toolCallId);
          if (toolLog) {
            toolLog.output = event.output;
            toolLog.durationMs = Date.now() - new Date(toolLog.timestamp).getTime();
            this.persistTrace(trace);
          }
        }
        break;
      }
    }
  }

  /**
   * Ruft einen gespeicherten Trace ab.
   */
  getTrace(sessionId: string): ChatSessionTrace | undefined {
    return this.traceStore.get(sessionId);
  }

  /**
   * Ruft alle gespeicherten Traces ab (sortiert nach Startzeit, neueste zuerst).
   */
  getAllTraces(): ChatSessionTrace[] {
    return Array.from(this.traceStore.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  /**
   * Ruft Traces für einen bestimmten Workspace ab.
   */
  getTracesForWorkspace(workspaceRoot: string): ChatSessionTrace[] {
    return this.getAllTraces().filter((t) => t.workspaceRoot === workspaceRoot);
  }

  /**
   * Exportiert einen Trace als JSON-String.
   */
  exportTrace(sessionId: string): string | null {
    const trace = this.getTrace(sessionId);
    if (!trace) {
      return null;
    }
    return JSON.stringify(trace, null, 2);
  }

  /**
   * Exportiert alle Traces als JSON-Array.
   */
  exportAllTraces(): string {
    return JSON.stringify(this.getAllTraces(), null, 2);
  }

  /**
   * Löscht einen gespeicherten Trace.
   */
  deleteTrace(sessionId: string): boolean {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      const indexJson = localStorage.getItem(TRACES_INDEX_KEY);
      if (indexJson) {
        const index: TraceIndexEntry[] = JSON.parse(indexJson);
        const filtered = index.filter((e) => e.sessionId !== sessionId);
        localStorage.setItem(TRACES_INDEX_KEY, JSON.stringify(filtered));
      }
    }
    return this.traceStore.delete(sessionId);
  }

  /**
   * Löscht alle gespeicherten Traces.
   */
  clearAllTraces(): void {
    if (typeof localStorage !== "undefined") {
      const indexJson = localStorage.getItem(TRACES_INDEX_KEY);
      if (indexJson) {
        const index: TraceIndexEntry[] = JSON.parse(indexJson);
        for (const entry of index) {
          localStorage.removeItem(`${STORAGE_KEY_PREFIX}${entry.sessionId}`);
        }
        localStorage.removeItem(TRACES_INDEX_KEY);
      }
    }
    this.traceStore.clear();
  }

  /**
   * Erstellt eine Statistik der gespeicherten Traces.
   */
  getStatistics(): {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    failedSessions: number;
    totalToolCalls: number;
    totalHandoffs: number;
    averageSessionDurationMs: number;
  } {
    const traces = this.getAllTraces();
    const completed = traces.filter((t) => t.status === "completed");
    const failed = traces.filter((t) => t.status === "failed");
    const active = traces.filter((t) => t.status === "active");

    const totalToolCalls = traces.reduce((sum, t) => sum + t.toolExecutionLogs.length, 0);
    const totalHandoffs = traces.reduce((sum, t) => sum + t.handoffLogs.length, 0);

    const durations = completed
      .filter((t) => t.finishedAt)
      .map((t) => new Date(t.finishedAt!).getTime() - new Date(t.startedAt).getTime());

    const avgDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    return {
      totalSessions: traces.length,
      activeSessions: active.length,
      completedSessions: completed.length,
      failedSessions: failed.length,
      totalToolCalls,
      totalHandoffs,
      averageSessionDurationMs: avgDuration
    };
  }
}

export const observabilityService = new ObservabilityServiceClass();
