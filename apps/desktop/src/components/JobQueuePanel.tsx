/**
 * DBZS – Division By Zeros
 * Datei: JobQueuePanel.tsx
 * Bereich: Desktop Components / Job Queue Panel
 *
 * Zweck:
 *   Zeigt die Job-Queue mit Fortschritt und Task-Status an.
 *
 * Warum:
 *   Benutzer müssen den Fortschritt der Job-Ausführung verfolgen können.
 *
 * Wozu:
 *   Ermöglicht Transparenz über laufende, abgeschlossene und fehlgeschlagene Jobs.
 *
 * HINWEIS (Codebase-Revision): Diese Komponente wird aktuell nirgends importiert/gerendert.
 * Die produktive Job-Anzeige läuft über JobMonitorPanel.tsx, das den Fortschritt bereits
 * korrekt aus echten Waypoint-Events berechnet (siehe maxProgress() dort). Der Progress-
 * Platzhalter unten (0/50/100) betrifft daher aktuell keine sichtbare Funktion — vor einer
 * Reaktivierung dieser Komponente bitte echte Waypoint-Daten als Prop durchreichen, analog
 * zu JobMonitorPanel.
 */

import React, { useMemo } from "react";
import type { JobRecord, JobStatus } from "@dbzs/shared";

export interface JobQueuePanelProps {
  jobs: JobRecord[];
  isLoading?: boolean;
  onJobClick?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
}

export const JobQueuePanel: React.FC<JobQueuePanelProps> = ({
  jobs,
  isLoading = false,
  onJobClick,
  onRetry,
  onCancel
}) => {
  // Job-Statistiken
  const stats = useMemo(() => {
    const statusCount: Record<string, number> = {};
    for (const job of jobs) {
      statusCount[job.status] = (statusCount[job.status] ?? 0) + 1;
    }
    return {
      total: jobs.length,
      queued: statusCount["queued"] ?? 0,
      running: statusCount["running"] ?? 0,
      completed: statusCount["completed"] ?? 0,
      failed: statusCount["failed"] ?? 0,
      cancelled: statusCount["cancelled"] ?? 0
    };
  }, [jobs]);

  // Nach Status gruppieren
  const groupedJobs = useMemo(() => {
    const groups: Record<string, JobRecord[]> = {
      running: [],
      queued: [],
      completed: [],
      failed: [],
      cancelled: []
    };

    for (const job of jobs) {
      if (groups[job.status]) {
        groups[job.status].push(job);
      }
    }

    // Nach Priorität sortieren
    for (const status of Object.keys(groups)) {
      groups[status].sort((a, b) => b.priority - a.priority);
    }

    return groups;
  }, [jobs]);

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-1/4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="p-6 bg-gray-900 rounded-lg border border-gray-700 text-center text-gray-400">
        Keine Jobs in der Queue
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Job-Warteschlange</h3>
        <div className="flex gap-2 text-xs">
          <span className="px-2 py-1 bg-purple-600 text-white rounded">
            ▶ {stats.running} läuft
          </span>
          <span className="px-2 py-1 bg-blue-600 text-white rounded">
            ⏸ {stats.queued} wartend
          </span>
          <span className="px-2 py-1 bg-green-600 text-white rounded">
            ✓ {stats.completed} erledigt
          </span>
          <span className="px-2 py-1 bg-red-600 text-white rounded">
            ✗ {stats.failed} fehlgeschlagen
          </span>
        </div>
      </div>

      {/* Laufende Jobs */}
      {groupedJobs.running.length > 0 && (
        <JobSection
          title="In Arbeit"
          icon="▶"
          color="purple"
          jobs={groupedJobs.running}
          onJobClick={onJobClick}
          onCancel={onCancel}
        />
      )}

      {/* Wartende Jobs */}
      {groupedJobs.queued.length > 0 && (
        <JobSection
          title="Wartend"
          icon="⏸"
          color="blue"
          jobs={groupedJobs.queued}
          onJobClick={onJobClick}
          onCancel={onCancel}
        />
      )}

      {/* Abgeschlossene Jobs */}
      {groupedJobs.completed.length > 0 && (
        <JobSection
          title="Abgeschlossen"
          icon="✓"
          color="green"
          jobs={groupedJobs.completed}
          onJobClick={onJobClick}
        />
      )}

      {/* Fehlgeschlagene Jobs */}
      {groupedJobs.failed.length > 0 && (
        <JobSection
          title="Fehlgeschlagen"
          icon="✗"
          color="red"
          jobs={groupedJobs.failed}
          onJobClick={onJobClick}
          onRetry={onRetry}
        />
      )}

      {/* Abgebrochene Jobs */}
      {groupedJobs.cancelled.length > 0 && (
        <JobSection
          title="Abgebrochen"
          icon="⊘"
          color="gray"
          jobs={groupedJobs.cancelled}
          onJobClick={onJobClick}
        />
      )}
    </div>
  );
};

/**
 * Job-Sektion.
 */
interface JobSectionProps {
  title: string;
  icon: string;
  color: string;
  jobs: JobRecord[];
  onJobClick?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
}

const JobSection: React.FC<JobSectionProps> = ({
  title,
  icon,
  color,
  jobs,
  onJobClick,
  onRetry,
  onCancel
}) => {
  const colorClasses: Record<string, string> = {
    purple: "border-purple-600 bg-purple-900/10",
    blue: "border-blue-600 bg-blue-900/10",
    green: "border-green-600 bg-green-900/10",
    red: "border-red-600 bg-red-900/10",
    gray: "border-gray-600 bg-gray-800/10"
  };

  return (
    <div className={`rounded border ${colorClasses[color] || colorClasses.gray}`}>
      <div className="px-3 py-2 border-b border-gray-700">
        <h4 className="text-sm font-medium text-gray-300">
          {icon} {title} ({jobs.length})
        </h4>
      </div>
      <div className="divide-y divide-gray-700">
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            onClick={() => onJobClick?.(job.id)}
            onRetry={() => onRetry?.(job.id)}
            onCancel={() => onCancel?.(job.id)}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Job-Zeile.
 */
interface JobRowProps {
  job: JobRecord;
  onClick: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}

const JobRow: React.FC<JobRowProps> = ({ job, onClick, onRetry, onCancel }) => {
  const statusStyles: Record<string, string> = {
    queued: "text-blue-400",
    claimed: "text-blue-400",
    running: "text-purple-400 animate-pulse",
    waiting_verification: "text-yellow-400",
    completed: "text-green-400",
    failed: "text-red-400",
    cancelled: "text-gray-400"
  };

  const statusLabels: Record<string, string> = {
    queued: "Gequeued",
    claimed: "Beansprucht",
    running: "Läuft",
    waiting_verification: "Validierung",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen"
  };

  // Fortschritt aus Metadata extrahieren
  const progress = useMemo(() => {
    // Grober Fallback nach Status, da diese Komponente keine Waypoint-Events als Prop
    // erhält (siehe Datei-Hinweis oben). Für echten Fortschritt siehe JobMonitorPanel.tsx.
    if (job.status === "completed") return 100;
    if (job.status === "running") return 50;
    if (job.status === "queued") return 0;
    return 0;
  }, [job.status]);

  return (
    <div
      className="flex items-center gap-3 p-3 hover:bg-gray-800/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      {/* Status Icon */}
      <span className={`text-lg ${statusStyles[job.status]}`}>
        {job.status === "running" && "▶"}
        {job.status === "queued" && "⏸"}
        {job.status === "completed" && "✓"}
        {job.status === "failed" && "✗"}
        {job.status === "cancelled" && "⊘"}
        {job.status === "claimed" && "◐"}
        {job.status === "waiting_verification" && "⚙"}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{job.title}</p>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          <span>{statusLabels[job.status]}</span>
          <span>·</span>
          <span className="font-mono">{job.id.slice(0, 8)}</span>
          {job.assigned_worker && (
            <>
              <span>·</span>
              <span>{job.assigned_worker}</span>
            </>
          )}
          {job.error_message && (
            <>
              <span>·</span>
              <span className="text-red-400 truncate max-w-xs">{job.error_message}</span>
            </>
          )}
        </div>

        {/* Fortschrittsbalken */}
        {job.status === "running" && (
          <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Priorität */}
      <span className="text-xs font-medium text-gray-400 w-12 text-right">
        P{job.priority}
      </span>

      {/* Versuche */}
      {job.attempt_count > 0 && (
        <span className="text-xs text-gray-500 w-16 text-right">
          {job.attempt_count}/{job.max_attempts}
        </span>
      )}

      {/* Actions */}
      <div className="flex gap-1">
        {job.status === "failed" && onRetry && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition-colors"
            title="Erneut versuchen"
          >
            ↻
          </button>
        )}

        {job.status === "running" && onCancel && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs transition-colors"
            title="Abbrechen"
          >
            ⏹
          </button>
        )}
      </div>
    </div>
  );
};

export default JobQueuePanel;
