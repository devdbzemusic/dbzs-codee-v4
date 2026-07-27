/**
 * P2 Phase 6: Routing Diagnostics Card
 * 
 * Shows routing decision, slot validation, timeout stage, and error classification.
 */

import type { RoutingDiagnostics, RuntimeWarmupDiagnostics } from "@/types/runtimeRoutingDiagnostics";

function DiagnosticRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-dbzs-border/60 py-1.5">
      <div className="font-semibold text-dbzs-textSoft">{label}</div>
      <div className="col-span-2 break-words text-dbzs-text">{value}</div>
    </div>
  );
}

function WarmupDiagnostics({ diagnostics }: { diagnostics: RuntimeWarmupDiagnostics }) {
  return (
    <div className="mt-2 rounded border border-dbzs-red/30 bg-dbzs-red/5 p-2">
      <h3 className="font-bold text-dbzs-red">Warm-up Fehlerdiagnose</h3>
      <div className="mt-1 text-xs">
        <DiagnosticRow label="Endpoint" value={diagnostics.endpoint} />
        <DiagnosticRow label="API Modus" value={diagnostics.apiMode} />
        <DiagnosticRow label="HTTP Status" value={diagnostics.httpStatus} />
        <DiagnosticRow label="Parser-Entscheidung" value={diagnostics.parserDecision} />
        <DiagnosticRow label="Chat Template" value={diagnostics.chatTemplateUsed} />
        <DiagnosticRow
          label="Request Body"
          value={diagnostics.requestBody ? <pre className="whitespace-pre-wrap font-mono text-[9px]">{diagnostics.requestBody}</pre> : null}
        />
        <DiagnosticRow
          label="Rohantwort (Auszug)"
          value={diagnostics.rawResponsePreview ? <pre className="whitespace-pre-wrap font-mono text-[9px]">{diagnostics.rawResponsePreview}</pre> : null}
        />
      </div>
    </div>
  );
}

export function RoutingDiagnosticsCard({ diagnostics }: { diagnostics: RoutingDiagnostics | null }) {
  if (!diagnostics || !diagnostics.decision) {
    return <div className="p-2 text-[10px] text-dbzs-muted">Keine Diagnosedaten verfügbar.</div>;
  }

  const { decision, validation, errorClassification } = diagnostics;
  const isDegraded = decision?.source === "fallback" || decision?.source === "explicit_fallback";

  return (
    <div className="rounded border border-dbzs-border bg-dbzs-bg-secondary p-2 text-[10px]">
      {/* Routing Decision */}
      {isDegraded && (
        <div className="mb-2 rounded border border-dbzs-amber/50 bg-dbzs-amber/10 px-2 py-1 font-bold text-dbzs-amber">
          DEGRADED: Fallback-Modell wird verwendet.
        </div>
      )}
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

      {diagnostics.warmup && <WarmupDiagnostics diagnostics={diagnostics.warmup} />}

      {/* Timestamp */}
      <div className="mt-2 border-t border-dbzs-border pt-1 text-[9px] text-dbzs-muted">
        {new Date(decision.decidedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}
