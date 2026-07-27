import { backendClient } from "./backendClient";

/**
 * SSE Client für Job-Spooler Live-Updates
 * 
 * Zweck:
 *   Stellt eine EventSource-Verbindung zum Backend-SSE-Endpoint her
 *   und aktualisiert den jobSpoolerStore bei Job-Änderungen.
 * 
 * Warum:
 *   Polling allein verursacht Latenz und unnötige Requests.
 *   SSE ermöglicht Echtzeit-Updates bei Job-Statusänderungen.
 * 
 * Wozu:
 *   JobMonitorPanel zeigt Job-Updates ohne manuelle Refresh.
 */

let eventSource: EventSource | null = null;
let reconnectTimeout: number | null = null;
let isConnecting = false;

export interface SseJobUpdatePayload {
  type: "job_updated";
  job: {
    id: string;
    title: string;
    status: string;
    assigned_agent_role?: string | null;
    priority: number;
    created_at: string;
    updated_at: string;
  };
}

function connectToSse(onJobUpdate?: (payload: SseJobUpdatePayload) => void): void {
  if (isConnecting || eventSource) {
    return;
  }

  isConnecting = true;

  try {
    // Backend-URL aus backendClient verwenden
    const baseUrl = (backendClient as any)._baseUrl || "http://127.0.0.1:8876";
    const sseUrl = `${baseUrl}/job-spooler/stream`;

    console.log("[SSE] Connecting to", sseUrl);
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      console.log("[SSE] Connection established");
      isConnecting = false;
    };

    eventSource.onerror = (error) => {
      console.error("[SSE] Connection error", error);
      isConnecting = false;
      eventSource?.close();
      eventSource = null;

      // Reconnect nach 3 Sekunden
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connectToSse(onJobUpdate);
      }, 3000);
    };

    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as SseJobUpdatePayload;
        if (data.type === "job_updated") {
          console.log("[SSE] Job update received", data.job.id, data.job.status);
          onJobUpdate?.(data);
        }
      } catch (err) {
        console.error("[SSE] Failed to parse event data", err);
      }
    });
  } catch (err) {
    console.error("[SSE] Failed to create EventSource", err);
    isConnecting = false;
  }
}

export function disconnectFromSse(): void {
  if (reconnectTimeout) {
    window.clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (eventSource) {
    console.log("[SSE] Disconnecting");
    eventSource.close();
    eventSource = null;
  }

  isConnecting = false;
}

export function useSseJobUpdates(onJobUpdate: (payload: SseJobUpdatePayload) => void): void {
  // Hook-ähnliche Funktion für manuelle Steuerung
  // Wird typischerweise in useEffect aufgerufen
  connectToSse(onJobUpdate);
}

export function isSseConnected(): boolean {
  return eventSource !== null && !isConnecting;
}

// Für Store-Integration exportieren
export { connectToSse };
