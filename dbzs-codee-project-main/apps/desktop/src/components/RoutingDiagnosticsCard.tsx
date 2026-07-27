/**
 * P2 Phase 6: Routing Diagnostics Card
 * 
 * Shows routing decision, slot validation, timeout stage, and error classification.
 */

import type { RoutingDiagnostics } from "@/types/runtimeRoutingDiagnostics";

export function RoutingDiagnosticsCard({ diagnostics }: { diagnostics: RoutingDiagnostics }) {
  if (!diagnostics.decision) {
    return null;
  }

  const { decision, validation, errorClassification } = diagnostics;

  return (
    <div className="rounded border border-dbzs-border bg-dbzs-bg-secondary p-2 text-[10px]">
      {/* Routing Decision */}
      <div className="mb-2 space-y-1 border-b border-dbzs-border pb-2">
        <div className="font-mono text-dbzs-text">
          <span className="text-dbzs-cyan">Task</span>: {decision.taskType}
        </div>
        <div className="font-mono text-dbzs-text">
          <span className="text-dbzs-cyan">Agent</span>: {decision.targetAgent}
        </div>
        <div className="font-mono text-dbzs-text">
          <span className="text-dbzs-cyan">Slot</span>: {decision.slotId}
        </div>
        <div className="font-mono text-dbzs-text">
          <span className="text-dbzs-cyan">Model</span>: {decision.modelName || decision.modelId || "—"}
        </div>
        {decision.rolloutStage ? (
          <div className="font-mono text-dbzs-text">
            <span className="text-dbzs-cyan">Rollout</span>: {decision.rolloutStage}
            {decision.canaryPercent !== undefined ? ` (${decision.canaryPercent}%)` : ""}
          </div>
        ) : null}
        {decision.routingPath ? (
          <div className="font-mono text-dbzs-text">
            <span className="text-dbzs-cyan">Path</span>: {decision.routingPath}
          </div>
        ) : null}
        {decision.shadowMode ? (
          <div className="font-mono text-dbzs-text">
            <span className="text-dbzs-cyan">Shadow</span>:{" "}
            {decision.shadowMatch === null ? "unknown" : decision.shadowMatch ? "match" : "mismatch"}
            {decision.stopOnShadowMismatch ? " · stop-on-mismatch" : ""}
          </div>
        ) : null}
        <div className="text-dbzs-muted">{decision.reason}</div>
      </div>

      {/* Validation Status */}
      <div className="mb-2 space-y-1 border-b border-dbzs-border pb-2">
        <div className="font-mono font-bold text-dbzs-text">Validation:</div>
        <div className={`font-mono ${validation.slotReady ? "text-green-400" : "text-dbzs-red"}`}>
          {validation.slotReady ? "✓" : "✗"} Slot {validation.slotMessage && `(${validation.slotMessage})`}
        </div>
        <div className={`font-mono ${validation.memoryAvailable ? "text-green-400" : "text-dbzs-red"}`}>
          {validation.memoryAvailable ? "✓" : "✗"} Memory {validation.memoryMessage && `(${validation.memoryMessage})`}
        </div>
        <div className={`font-mono font-bold ${validation.canStart ? "text-green-400" : "text-dbzs-red"}`}>
          {validation.canStart ? "✓ Ready" : "✗ Blocked"}
        </div>
      </div>

      {/* Timeout Info */}
      {decision.timeoutStage && (
        <div className="mb-2 space-y-1 border-b border-dbzs-border pb-2">
          <div className="font-mono text-dbzs-text">
            <span className="text-dbzs-cyan">Stage</span>: {decision.timeoutStage}
          </div>
          {decision.timeoutDuration && (
            <div className="font-mono text-dbzs-text">
              <span className="text-dbzs-cyan">Timeout</span>: {decision.timeoutDuration}ms
            </div>
          )}
        </div>
      )}

      {/* Error Info */}
      {errorClassification && (
        <div className="space-y-1">
          <div className="font-mono font-bold text-dbzs-red">Error:</div>
          <div className="font-mono text-dbzs-text">{errorClassification.errorType}</div>
          <div className="text-dbzs-muted">{errorClassification.errorMessage}</div>
          <div className={`font-mono text-[9px] ${errorClassification.retryable ? "text-dbzs-cyan" : "text-dbzs-red"}`}>
            {errorClassification.retryable ? "↻ Retryable" : "✗ No Retry"} (attempt #{errorClassification.retryCount})
          </div>
        </div>
      )}

      {/* Timestamp */}
      <div className="mt-2 border-t border-dbzs-border pt-1 text-[9px] text-dbzs-muted">
        {new Date(decision.decidedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}
