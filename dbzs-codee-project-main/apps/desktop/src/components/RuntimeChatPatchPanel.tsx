import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

export function RuntimeChatPatchPanel() {
  const {
    activePatchProposal,
    activePatchPreview,
    patchState,
    patchError,
    patchApplyResult,
    patchValidationResult,
    applyPatch,
    rejectPatch,
    rollbackPatch,
    validatePatch
  } = useRuntimeChatStore();

  if (!activePatchProposal) {
    return null;
  }

  const busy = patchState === "APPLYING" || patchState === "VALIDATING";
  const canApply = patchState === "WAITING_FOR_APPROVAL" || patchState === "APPROVED" || patchState === "PREVIEW_READY";
  const canRollback = Boolean(patchApplyResult?.restorePointId) && patchState !== "ROLLED_BACK";

  return (
    <section className="border-b border-dbzs-cyan/30 bg-dbzs-cyan/5 px-3 py-2 text-[11px] text-dbzs-text">
      <div className="mb-2 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-dbzs-cyan">Patch Review</div>
          <h3 className="truncate text-sm font-semibold">{activePatchProposal.title}</h3>
          <p className="mt-0.5 text-dbzs-muted">{activePatchProposal.summary}</p>
        </div>
        <span className="border border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted">{patchState ?? "PROPOSED"}</span>
      </div>

      <div className="mb-2 grid gap-1">
        {activePatchProposal.changes.map((change) => (
          <div className="border border-dbzs-border/70 bg-dbzs-bg/60 px-2 py-1" key={change.id}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{change.filePath}</strong>
              <span className="text-dbzs-muted">{change.changeType}</span>
              <span className="text-dbzs-muted">Risiko: {change.riskLevel}</span>
            </div>
            <p className="mt-1 text-dbzs-muted">{change.reason}</p>
          </div>
        ))}
      </div>

      {activePatchPreview?.previews.map((preview) => (
        <details className="mb-2 border border-dbzs-border bg-dbzs-bg/70" key={preview.changeId} open>
          <summary className="cursor-pointer px-2 py-1 text-dbzs-cyan">{preview.filePath}</summary>
          <pre className="max-h-72 overflow-auto border-t border-dbzs-border p-2 text-[10px] leading-4 text-dbzs-text">
            {preview.diff}
          </pre>
        </details>
      ))}

      {activePatchProposal.validationCommands?.length ? (
        <div className="mb-2 text-dbzs-muted">
          Validierung: {activePatchProposal.validationCommands.join(", ")}
        </div>
      ) : null}

      {patchValidationResult ? (
        <div className="mb-2 border border-dbzs-border bg-dbzs-bg/60 px-2 py-1">
          <div className={patchValidationResult.success ? "text-dbzs-green" : "text-dbzs-red"}>
            Validierung {patchValidationResult.success ? "erfolgreich" : "fehlgeschlagen"}
          </div>
          {patchValidationResult.commands.map((command) => (
            <div className="text-dbzs-muted" key={command.commandId}>
              {command.commandId}: exit {command.exitCode ?? "?"}
            </div>
          ))}
        </div>
      ) : null}

      {patchError ? <div className="mb-2 text-dbzs-red">{patchError}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button
          className="border border-dbzs-cyan/50 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
          disabled={!canApply || busy}
          onClick={() => void applyPatch()}
          type="button"
        >
          Übernehmen
        </button>
        <button
          className="border border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted disabled:opacity-40"
          disabled={busy || patchState === "REJECTED" || patchState === "APPLIED" || patchState === "PASSED"}
          onClick={() => void rejectPatch()}
          type="button"
        >
          Ablehnen
        </button>
        <button
          className="border border-dbzs-border px-2 py-1 text-[10px] text-dbzs-muted disabled:opacity-40"
          disabled={busy || !patchApplyResult?.applied}
          onClick={() => void validatePatch()}
          type="button"
        >
          Tests starten
        </button>
        <button
          className="border border-dbzs-red/50 bg-dbzs-red/10 px-2 py-1 text-[10px] text-dbzs-red disabled:opacity-40"
          disabled={busy || !canRollback}
          onClick={() => void rollbackPatch()}
          type="button"
        >
          Rollback
        </button>
      </div>
    </section>
  );
}
