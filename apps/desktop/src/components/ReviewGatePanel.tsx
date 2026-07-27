/**
 * DBZS – Division By Zeros
 * Datei: ReviewGatePanel.tsx
 * Bereich: Desktop Components / Review Gate Panel
 *
 * Zweck:
 *   Zeigt Review-Gates an und ermöglicht Genehmigungen/Ablehnungen.
 *
 * Warum:
 *   Review-Gates müssen vom Benutzer geprüft und entschieden werden.
 *
 * Wozu:
 *   Ermöglicht manuelle Review-Entscheidungen für kritische Änderungen.
 */

import React, { useState } from "react";
import type { ReviewGate } from "@dbzs/shared";
import type { ReviewCriteria } from "@/services/jobReviewGateService";

type ReviewProposedChange = ReviewGate["proposedChanges"][number];

export interface ReviewGatePanelProps {
  gate?: ReviewGate | null;
  isLoading?: boolean;
  criteria?: ReviewCriteria;
  onApprove?: (gateId: string, comment?: string) => void;
  onReject?: (gateId: string, reason: string) => void;
}

export const ReviewGatePanel: React.FC<ReviewGatePanelProps> = ({
  gate,
  isLoading = false,
  criteria,
  onApprove,
  onReject
}) => {
  const [comment, setComment] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const handleApprove = () => {
    if (!gate) return;
    onApprove?.(gate.id, comment || undefined);
    setComment("");
  };

  const handleReject = () => {
    if (!gate || !rejectionReason.trim()) return;
    onReject?.(gate.id, rejectionReason);
    setRejectionReason("");
    setShowRejectForm(false);
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-1/3"></div>
          <div className="h-4 bg-gray-700 rounded w-2/3"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!gate) {
    return (
      <div className="p-6 bg-gray-900 rounded-lg border border-gray-700 text-center text-gray-400">
        Kein Review-Gate vorhanden
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Review-Gate</h3>
          <p className="text-sm text-gray-400 mt-1">
            Job: {gate.jobId} · Schritt {gate.stepNumber}
          </p>
        </div>
        <ReviewStatusBadge gate={gate} />
      </div>

      {/* Review-Kriterien */}
      {criteria && (
        <div className="p-3 bg-gray-800 rounded border border-gray-600">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Validierungskriterien</h4>
          <div className="space-y-2">
            <CriterionRow
              label="Tests bestanden"
              passed={criteria.testsPassed}
              description="Alle Testkommandos mit Exit-Code 0"
            />
            <CriterionRow
              label="Akzeptanzkriterien erfüllt"
              passed={criteria.acceptanceCriteriaMet}
              description="Alle definierten Akzeptanzkriterien erfüllt"
            />
            <CriterionRow
              label="Keine kritischen Änderungen"
              passed={criteria.noCriticalChangesWithoutApproval}
              description="Keine sicherheitskritischen Änderungen ohne Freigabe"
            />
            <CriterionRow
              label="Code-Qualität"
              passed={criteria.codeQualityAcceptable}
              description="Code-Qualität ausreichend"
            />
            <CriterionRow
              label="Keine Sicherheitsprobleme"
              passed={criteria.noSecurityIssues}
              description="Keine Sicherheitslücken erkannt"
            />
          </div>
        </div>
      )}

      {/* Vorgeschlagene Änderungen */}
      {gate.proposedChanges.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-300">Vorgeschlagene Änderungen ({gate.proposedChanges.length})</h4>
          <div className="space-y-2">
            {gate.proposedChanges.map((change, i) => (
              <ChangeCard key={i} change={change} />
            ))}
          </div>
        </div>
      )}

      {/* Review-Kommentar */}
      {gate.status === "pending" && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Optionaler Kommentar
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Kommentar zur Genehmigung..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              rows={2}
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-gray-700">
            <button
              onClick={handleApprove}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors"
            >
              ✓ Genehmigen
            </button>
            {!showRejectForm ? (
              <button
                onClick={() => setShowRejectForm(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium transition-colors"
              >
                ✗ Ablehnen
              </button>
            ) : (
              <div className="flex gap-2 flex-1">
                <input
                  type="text"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Ablehnungsgrund..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                  autoFocus
                />
                <button
                  onClick={handleReject}
                  disabled={!rejectionReason.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
                >
                  Bestätigen
                </button>
                <button
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectionReason("");
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm font-medium transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Review-Historie */}
      {gate.reviewedAt && (
        <div className="p-3 bg-gray-800 rounded border border-gray-600 text-sm">
          <div className="flex items-center gap-2 text-gray-400">
            <span>
              {gate.status === "approved" ? "✓ Genehmigt" : "✗ Abgelehnt"}
            </span>
            <span>·</span>
            <span>{gate.reviewedBy ?? "unbekannt"}</span>
            <span>·</span>
            <span>{new Date(gate.reviewedAt).toLocaleString("de-DE")}</span>
          </div>
          {gate.reviewComment && (
            <p className="text-gray-300 mt-2">{gate.reviewComment}</p>
          )}
        </div>
      )}

      {/* Auto-Apply Timeout */}
      {gate.autoApplyTimeoutSeconds && gate.status === "pending" && (
        <div className="text-xs text-yellow-400">
          ⏱ Auto-Apply in {gate.autoApplyTimeoutSeconds}s bei keiner Entscheidung
        </div>
      )}
    </div>
  );
};

/**
 * Status-Badge für Review-Gate.
 */
const ReviewStatusBadge: React.FC<{ gate: ReviewGate }> = ({ gate }) => {
  const styles: Record<string, string> = {
    pending: "bg-yellow-600 text-white",
    in_progress: "bg-purple-600 text-white",
    approved: "bg-green-600 text-white",
    rejected: "bg-red-600 text-white",
    modified: "bg-blue-600 text-white",
    expired: "bg-gray-600 text-white"
  };

  const labels: Record<string, string> = {
    pending: "Ausstehend",
    in_progress: "In Prüfung",
    approved: "Bestanden",
    rejected: "Abgelehnt",
    modified: "Geändert",
    expired: "Abgelaufen"
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[gate.status]}`}>
      {labels[gate.status]}
    </span>
  );
};

/**
 * Kriterium-Zeile.
 */
const CriterionRow: React.FC<{
  label: string;
  passed: boolean;
  description: string;
}> = ({ label, passed, description }) => {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${passed ? "text-green-400" : "text-red-400"}`}>
        {passed ? "✓" : "✗"}
      </span>
      <div>
        <p className={`text-sm ${passed ? "text-gray-200" : "text-red-300"}`}>{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
};

/**
 * Änderungs-Karte.
 */
const ChangeCard: React.FC<{ change: ReviewProposedChange }> = ({ change }) => {
  const riskStyles: Record<string, string> = {
    low: "border-green-600 bg-green-900/10",
    medium: "border-yellow-600 bg-yellow-900/10",
    high: "border-red-600 bg-red-900/10"
  };

  const riskLabels: Record<string, string> = {
    low: "Niedrig",
    medium: "Mittel",
    high: "Hoch"
  };

  return (
    <div className={`p-3 rounded border ${riskStyles[change.riskLevel] || riskStyles.low}`}>
      <div className="flex items-center justify-between mb-2">
        <code className="text-sm font-mono text-blue-300">{change.filePath}</code>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          change.riskLevel === "high" ? "bg-red-600" :
          change.riskLevel === "medium" ? "bg-yellow-600" :
          "bg-green-600"
        } text-white`}>
          Risiko: {riskLabels[change.riskLevel]}
        </span>
      </div>
      {change.diff && (
        <pre className="text-xs bg-gray-800 p-2 rounded overflow-auto max-h-32 text-gray-300 font-mono">
          {change.diff.slice(0, 500)}{change.diff.length > 500 ? "..." : ""}
        </pre>
      )}
    </div>
  );
};

export default ReviewGatePanel;
