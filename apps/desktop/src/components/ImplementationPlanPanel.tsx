/**
 * DBZS – Division By Zeros
 * Datei: ImplementationPlanPanel.tsx
 * Bereich: Desktop Components / Implementation Plan Panel
 *
 * Zweck:
 *   Zeigt Implementierungspläne an mit Freigabe-Buttons und Task-Übersicht.
 *
 * Warum:
 *   Benutzer müssen Pläne prüfen und freigeben können bevor Jobs ausgeführt werden.
 *
 * Wozu:
 *   Ermöglicht kontrollierte Plan-Freigabe im Implementation Queue System.
 */

import React, { useMemo, useState } from "react";
import type {
  ImplementationPlanV1,
  ImplementationTaskV1,
  ImplementationTaskState,
  ImplementationPlanStatus
} from "@dbzs/shared";
import { calculatePlanStatus, validateImplementationPlan } from "@dbzs/shared";

export interface ImplementationPlanPanelProps {
  plan: ImplementationPlanV1 | null;
  isLoading?: boolean;
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
  onEnqueue?: (planId: string) => void;
}

export const ImplementationPlanPanel: React.FC<ImplementationPlanPanelProps> = ({
  plan,
  isLoading = false,
  onApprove,
  onReject,
  onEnqueue
}) => {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Validierung berechnen
  const validation = useMemo(() => {
    if (!plan) return null;
    return validateImplementationPlan(plan);
  }, [plan]);

  // Plan-Status berechnen
  const planStatus: ImplementationPlanStatus = useMemo(() => {
    if (!plan) return "draft";
    return plan.status ?? calculatePlanStatus(plan.tasks);
  }, [plan]);

  // Task-Statistiken
  const taskStats = useMemo(() => {
    if (!plan) return null;
    const states = plan.tasks.map((t) => t.state ?? "proposed");
    return {
      total: plan.tasks.length,
      done: states.filter((s) => s === "done").length,
      running: states.filter((s) => s === "running" || s === "validating").length,
      blocked: states.filter((s) => s === "blocked").length,
      failed: states.filter((s) => s === "failed").length,
      pending: states.filter((s) => s === "proposed" || s === "approved" || s === "queued" || s === "ready").length
    };
  }, [plan]);

  // Fortschritt berechnen
  const progress = useMemo(() => {
    if (!taskStats || taskStats.total === 0) return 0;
    return Math.round((taskStats.done / taskStats.total) * 100);
  }, [taskStats]);

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          <div className="h-4 bg-gray-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6 bg-gray-900 rounded-lg border border-gray-700 text-center text-gray-400">
        Kein Implementierungsplan vorhanden
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Implementierungsplan</h3>
          <p className="text-sm text-gray-400 mt-1">{plan.goal}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <span className="font-mono">{plan.id}</span>
            <span>·</span>
            <span className="font-mono">{plan.branchName}</span>
            <span>·</span>
            <span>{new Date(plan.createdAt).toLocaleString("de-DE")}</span>
          </div>
        </div>

        {/* Status Badge */}
        <StatusBadge status={planStatus} />
      </div>

      {/* Validierungswarnungen */}
      {validation && !validation.valid && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
          <p className="font-medium mb-1">Plan ist ungültig:</p>
          <ul className="list-disc list-inside space-y-1">
            {validation.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {validation && validation.warnings.length > 0 && (
        <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-300">
          <p className="font-medium mb-1">Warnungen:</p>
          <ul className="list-disc list-inside space-y-1">
            {validation.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Fortschrittsanzeige */}
      {taskStats && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Fortschritt</span>
            <span className="text-white">{progress}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-green-400">✓ {taskStats.done} erledigt</span>
            <span className="text-blue-400">▶ {taskStats.running} läuft</span>
            <span className="text-yellow-400">⏸ {taskStats.pending} ausstehend</span>
            {taskStats.blocked > 0 && (
              <span className="text-orange-400">⏹ {taskStats.blocked} blockiert</span>
            )}
            {taskStats.failed > 0 && (
              <span className="text-red-400">✗ {taskStats.failed} fehlgeschlagen</span>
            )}
          </div>
        </div>
      )}

      {/* Task-Liste */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-300">
          Aufgaben ({plan.tasks.length})
        </h4>
        <div className="space-y-2">
          {plan.tasks.map((task, index) => (
            <TaskCard
              key={task.id}
              task={task}
              index={index}
              isExpanded={expandedTasks.has(task.id)}
              onToggle={() => toggleTask(task.id)}
            />
          ))}
        </div>
      </div>

      {/* Notizen */}
      {plan.notes && plan.notes.length > 0 && (
        <div className="p-3 bg-gray-800 rounded border border-gray-600">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Notizen</h4>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
            {plan.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2 border-t border-gray-700">
        {planStatus === "draft" && (
          <>
            <button
              onClick={() => onApprove?.(plan.id)}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors"
            >
              Plan freigeben
            </button>
            <button
              onClick={() => onEnqueue?.(plan.id)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
            >
              In Warteschlange übernehmen
            </button>
            <button
              onClick={() => onReject?.(plan.id)}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium transition-colors"
            >
              Verwerfen
            </button>
          </>
        )}

        {planStatus === "in_progress" && (
          <span className="text-sm text-gray-400">
            Plan wird ausgeführt...
          </span>
        )}

        {planStatus === "completed" && (
          <span className="text-sm text-green-400">
            ✓ Plan erfolgreich abgeschlossen
          </span>
        )}

        {planStatus === "failed" && (
          <span className="text-sm text-red-400">
            ✗ Plan fehlgeschlagen
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Status-Badge für den Plan.
 */
const StatusBadge: React.FC<{ status: ImplementationPlanStatus }> = ({ status }) => {
  const styles: Record<string, string> = {
    draft: "bg-gray-600 text-white",
    approved: "bg-blue-600 text-white",
    in_progress: "bg-purple-600 text-white",
    blocked: "bg-orange-600 text-white",
    completed: "bg-green-600 text-white",
    failed: "bg-red-600 text-white",
    cancelled: "bg-gray-600 text-white"
  };

  const labels: Record<string, string> = {
    draft: "Entwurf",
    approved: "Freigegeben",
    in_progress: "In Arbeit",
    blocked: "Blockiert",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen"
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
      {labels[status] || status}
    </span>
  );
};

/**
 * Task-Karte.
 */
interface TaskCardProps {
  task: ImplementationTaskV1;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, index, isExpanded, onToggle }) => {
  const stateStyles: Record<string, string> = {
    proposed: "border-gray-600 bg-gray-800/50",
    approved: "border-blue-600 bg-blue-900/20",
    queued: "border-blue-600 bg-blue-900/20",
    blocked: "border-orange-600 bg-orange-900/20",
    ready: "border-green-600 bg-green-900/20",
    running: "border-purple-600 bg-purple-900/20 animate-pulse",
    validating: "border-purple-600 bg-purple-900/20",
    done: "border-green-600 bg-green-900/20",
    failed: "border-red-600 bg-red-900/20",
    cancelled: "border-gray-600 bg-gray-800/50 opacity-50"
  };

  const stateIcons: Record<string, string> = {
    proposed: "○",
    approved: "◐",
    queued: "◐",
    blocked: "⏸",
    ready: "✓",
    running: "▶",
    validating: "⚙",
    done: "✓",
    failed: "✗",
    cancelled: "⊘"
  };

  const stateLabels: Record<string, string> = {
    proposed: "Vorgeschlagen",
    approved: "Freigegeben",
    queued: "Gequeued",
    blocked: "Blockiert",
    ready: "Bereit",
    running: "Läuft",
    validating: "Validierung",
    done: "Erledigt",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen"
  };

  const borderClass = stateStyles[task.state ?? "proposed"];

  return (
    <div className={`rounded border ${borderClass} transition-all`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-800/50"
        onClick={onToggle}
      >
        <span className="text-xs font-mono text-gray-500 w-8">T{index + 1}</span>
        <span className="text-lg">{stateIcons[task.state ?? "proposed"]}</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">{task.title}</p>
          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
            <span>{stateLabels[task.state ?? "proposed"]}</span>
            {task.jobId && (
              <>
                <span>·</span>
                <span className="font-mono">{task.jobId.slice(0, 8)}</span>
              </>
            )}
            {task.commitSha && (
              <>
                <span>·</span>
                <span className="font-mono text-green-400">{task.commitSha.slice(0, 7)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Priorität */}
          <PriorityBadge priority={task.priority} />

          {/* Abhängigkeiten */}
          {task.dependsOn.length > 0 && (
            <span className="text-xs text-gray-500" title={`Abhängig von: ${task.dependsOn.join(", ")}`}>
              ↓ {task.dependsOn.length}
            </span>
          )}

          {/* Expand-Pfeil */}
          <span className={`text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}>
            ▶
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3">
          {/* Beschreibung */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Beschreibung</p>
            <p className="text-sm text-gray-300">{task.description}</p>
          </div>

          {/* Akzeptanzkriterien */}
          {task.acceptanceCriteria.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Akzeptanzkriterien</p>
              <ul className="text-sm text-gray-300 space-y-1">
                {task.acceptanceCriteria.map((criteria, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-green-400 mt-0.5">✓</span>
                    <span>{criteria}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Testkommandos */}
          {task.testCommands.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Testkommandos</p>
              <div className="space-y-1">
                {task.testCommands.map((cmd, i) => (
                  <code key={i} className="block text-xs bg-gray-800 px-2 py-1 rounded text-gray-300 font-mono">
                    {cmd}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Erwartete Dateien */}
          {task.expectedFiles.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Erwartete Dateien</p>
              <ul className="text-sm text-gray-300 space-y-1">
                {task.expectedFiles.map((file, i) => (
                  <li key={i} className="font-mono text-xs text-blue-300">{file}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Fehlermeldung */}
          {task.errorMessage && (
            <div className="p-2 bg-red-900/30 border border-red-700 rounded">
              <p className="text-xs font-medium text-red-300 mb-1">Fehler</p>
              <p className="text-sm text-red-200">{task.errorMessage}</p>
            </div>
          )}

          {/* Metadaten */}
          <div className="flex gap-4 text-xs text-gray-500 pt-2 border-t border-gray-700">
            <span>Max. Versuche: {task.maxAttempts}</span>
            {task.attemptCount !== undefined && (
              <span>Versuche: {task.attemptCount}</span>
            )}
            {task.requiresApproval && (
              <span className="text-yellow-400">Benötigt Freigabe</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Prioritäts-Indicator.
 */
const PriorityBadge: React.FC<{ priority: number }> = ({ priority }) => {
  let color = "bg-gray-600";
  let label = "Normal";

  if (priority >= 80) {
    color = "bg-red-600";
    label = "Hoch";
  } else if (priority >= 60) {
    color = "bg-yellow-600";
    label = "Mittel";
  } else if (priority >= 40) {
    color = "bg-blue-600";
    label = "Niedrig";
  }

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${color}`} title={`Priorität: ${priority}`}>
      P{priority}
    </span>
  );
};

export default ImplementationPlanPanel;
