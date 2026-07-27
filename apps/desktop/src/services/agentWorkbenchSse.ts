import type { AgentEvent } from "@dbzs/shared";
import { agentWorkbenchService } from "@/services/agentWorkbenchService";

export type AgentWorkbenchSseHandlers = {
  onEvent?: (event: AgentEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: unknown) => void;
};

let eventSource: EventSource | null = null;
let reconnectTimeout: number | null = null;
let activeRunId: string | null = null;
let afterSequence = 0;
let handlers: AgentWorkbenchSseHandlers = {};
let isConnecting = false;

function buildStreamUrl(runId: string, sequence: number): string {
  const baseUrl = agentWorkbenchService.getBackendUrl();
  const params = new URLSearchParams({ after_sequence: String(sequence) });
  return `${baseUrl}/agent-workbench/runs/${encodeURIComponent(runId)}/stream?${params.toString()}`;
}

function scheduleReconnect(): void {
  if (reconnectTimeout !== null || !activeRunId) {
    return;
  }
  reconnectTimeout = window.setTimeout(() => {
    reconnectTimeout = null;
    if (activeRunId) {
      connectAgentWorkbenchSse(activeRunId, afterSequence, handlers);
    }
  }, 3000);
}

function handleAgentEvent(raw: string): void {
  try {
    const parsed = JSON.parse(raw) as {
      sequence: number;
      id: string;
      run_id: string;
      step_id: string | null;
      event_type: AgentEvent["eventType"];
      severity: AgentEvent["severity"];
      summary: string;
      payload_json?: Record<string, unknown>;
      payload?: Record<string, unknown>;
      created_at: string;
      schema_version?: string;
    };
    const event: AgentEvent = {
      sequence: parsed.sequence,
      id: parsed.id,
      runId: parsed.run_id,
      stepId: parsed.step_id,
      eventType: parsed.event_type,
      severity: parsed.severity,
      summary: parsed.summary,
      payload: parsed.payload_json ?? parsed.payload ?? {},
      createdAt: parsed.created_at,
      schemaVersion: parsed.schema_version
    };
    if (event.sequence > afterSequence) {
      afterSequence = event.sequence;
    }
    handlers.onEvent?.(event);
  } catch (error) {
    handlers.onError?.(error);
  }
}

export function connectAgentWorkbenchSse(
  runId: string,
  sequence = 0,
  nextHandlers: AgentWorkbenchSseHandlers = {}
): void {
  handlers = nextHandlers;
  afterSequence = sequence;
  activeRunId = runId;

  if (isConnecting || eventSource) {
    disconnectAgentWorkbenchSse(false);
  }

  isConnecting = true;

  try {
    const url = buildStreamUrl(runId, afterSequence);
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      isConnecting = false;
      handlers.onConnected?.();
    };

    eventSource.onerror = (error) => {
      isConnecting = false;
      handlers.onError?.(error);
      handlers.onDisconnected?.();
      eventSource?.close();
      eventSource = null;
      scheduleReconnect();
    };

    eventSource.addEventListener("agent_event", (message) => {
      handleAgentEvent(message.data);
    });

    eventSource.addEventListener("message", (message) => {
      handleAgentEvent(message.data);
    });
  } catch (error) {
    isConnecting = false;
    handlers.onError?.(error);
    scheduleReconnect();
  }
}

export function disconnectAgentWorkbenchSse(clearRun = true): void {
  if (reconnectTimeout !== null) {
    window.clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  isConnecting = false;

  if (clearRun) {
    activeRunId = null;
    afterSequence = 0;
    handlers = {};
  }
}

export function getAgentWorkbenchSseSequence(): number {
  return afterSequence;
}

export function isAgentWorkbenchSseConnected(): boolean {
  return eventSource !== null && !isConnecting;
}

export function getAgentWorkbenchSseRunId(): string | null {
  return activeRunId;
}
