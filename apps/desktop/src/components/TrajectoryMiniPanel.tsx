import type { TrajectoryEvent } from "@dbzs/shared";
import { useEffect, useState } from "react";
import { trajectoryService } from "@/services/trajectoryService";

interface TrajectoryMiniPanelProps {
  jobId: string | null;
}

function formatEventTime(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function eventTypeLabel(eventType: TrajectoryEvent["eventType"]): string {
  return eventType.replaceAll("_", " ");
}

function formatTrajectoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Trajectory konnte nicht geladen werden.";
  if (message.includes("Failed to fetch") || message.toLowerCase().includes("fetch")) {
    return "Backend nicht erreichbar (ATIF-light). Bitte Backend auf Port 8876 prüfen und Job Monitor erneut öffnen.";
  }
  if (message.includes("listJobTrajectory is unavailable")) {
    return "Trajectory-Bridge nicht verfügbar. App neu starten (Dev-Build mit Electron-IPC).";
  }
  return message;
}

export function TrajectoryMiniPanel({ jobId }: TrajectoryMiniPanelProps) {
  const [events, setEvents] = useState<TrajectoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setEvents([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void trajectoryService
      .listJobTrajectory(jobId)
      .then((loaded) => {
        if (!active) return;
        setEvents(loaded.slice(-5).reverse());
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setEvents([]);
        setError(formatTrajectoryError(loadError));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [jobId]);

  if (!jobId) {
    return null;
  }

  return (
    <section className="mt-3 border border-dbzs-border bg-dbzs-panelSoft p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-dbzs-muted">Agent Trajectory</h4>
        <span className="text-[10px] text-dbzs-muted">ATIF-light</span>
      </div>

      {loading ? <p className="text-xs text-dbzs-muted">Lade Events…</p> : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {!loading && !error && events.length === 0 ? (
        <p className="text-xs text-dbzs-muted">Noch keine Trajectory-Events für diesen Job.</p>
      ) : null}

      {!loading && !error && events.length > 0 ? (
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded border border-dbzs-border/70 bg-dbzs-bg/40 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-dbzs-cyan">
                  {eventTypeLabel(event.eventType)}
                </span>
                <span className="text-[10px] text-dbzs-muted">{formatEventTime(event.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-dbzs-text">{event.summary}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
