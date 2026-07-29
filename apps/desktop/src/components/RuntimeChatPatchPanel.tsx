import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { DiffChangeView } from "@/components/runtime-chat/DiffChangeView";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/PanelComponents";
import { resolveStatusVocabulary } from "@/utils/statusVocabulary";

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
  const statusVocabulary = resolveStatusVocabulary(patchState ?? "proposed");

  return (
    <section className="border-b border-dbzs-cyan/30 bg-dbzs-cyan/5 px-3 py-2 text-[11px] text-dbzs-text">
      <div className="mb-2 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-dbzs-cyan">Patch Review</div>
          <h3 className="truncate text-sm font-semibold">{activePatchProposal.title}</h3>
          <p className="mt-0.5 text-dbzs-muted">{activePatchProposal.summary}</p>
        </div>
        <StatusPill label="Status" tone={statusVocabulary.tone} value={patchState ?? "PROPOSED"} />
      </div>

      <div className="mb-2 space-y-2">
        {(activePatchPreview?.previews ?? []).map((preview) => {
          const change = activePatchProposal.changes.find((entry) => entry.id === preview.changeId);
          return (
            <DiffChangeView
              key={preview.changeId}
              fileLabel={preview.filePath}
              diff={preview.diff}
              source={change?.changeType}
              reason={change?.reason}
              risk={change?.riskLevel}
            />
          );
        })}
        {!activePatchPreview?.previews.length
          ? activePatchProposal.changes.map((change) => (
              <div className="rounded border border-dbzs-border/70 bg-dbzs-bg/60 px-2 py-1" key={change.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="font-mono text-xs">{change.filePath}</strong>
                  <span className="text-dbzs-muted">{change.changeType}</span>
                  <span className="text-dbzs-muted">Risiko: {change.riskLevel}</span>
                </div>
                <p className="mt-1 text-dbzs-muted">{change.reason}</p>
              </div>
            ))
          : null}
      </div>

      {activePatchProposal.validationCommands?.length ? (
        <div className="mb-2 text-dbzs-muted">
          Validierung: {activePatchProposal.validationCommands.join(", ")}
        </div>
      ) : null}

      {patchValidationResult ? (
        <div className="mb-2 rounded border border-dbzs-border bg-dbzs-bg/60 px-2 py-1">
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
        <Button variant="primary" disabled={!canApply || busy} onClick={() => void applyPatch()}>
          Übernehmen
        </Button>
        <Button
          disabled={busy || patchState === "REJECTED" || patchState === "APPLIED" || patchState === "PASSED"}
          onClick={() => void rejectPatch()}
        >
          Ablehnen
        </Button>
        <Button disabled={busy || !patchApplyResult?.applied} onClick={() => void validatePatch()}>
          Tests starten
        </Button>
        <Button variant="danger" disabled={busy || !canRollback} onClick={() => void rollbackPatch()}>
          Zurücksetzen
        </Button>
      </div>
    </section>
  );
}
