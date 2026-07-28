import type { IndexedModel, MultimodalPair } from "@dbzs/shared";
import {
  ProbeEvidencePanel,
  type ProbeEvidenceItem,
  type ProbeOutcomeSummary,
  ToneBadge,
  type UiTone
} from "./RuntimeModelsTab.primitives";

export interface PairingUiController {
  pairingSelections: Record<string, string>;
  onSelectionChange: (artifactId: string, value: string) => void;
  pairingSaving: Record<string, boolean>;
  pairingProbing: Record<string, boolean>;
  pairingFeedback: Record<string, string>;
  pairingOutcome: Record<string, ProbeOutcomeSummary>;
  pairingEvidence: Record<string, ProbeEvidenceItem[]>;
  saveManualPairing: (artifactId: string, baseModelId: string) => Promise<void>;
  probePairing: (artifactId: string, baseModelId: string) => Promise<void>;
}

export function defaultPairingSelection(
  artifactId: string,
  pair: MultimodalPair,
  pairingSelections: Record<string, string>
): string {
  return pairingSelections[artifactId] ?? pair.base_model_id ?? pair.candidate_base_model_ids[0] ?? "";
}

export function describeBaseModelSelection(
  selectedBaseModelId: string,
  modelsById: Map<string, IndexedModel>
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (!selectedBaseModelId) {
    return { label: "Keine Auswahl", tone: "info" };
  }
  const selectedModel = modelsById.get(selectedBaseModelId);
  if (selectedModel) {
    return { label: selectedModel.name, tone: "ok" };
  }
  return { label: selectedBaseModelId, tone: "warn" };
}

export function describePairingTargetBadge(
  selectedBaseModelId: string,
  selectedBaseModel: { label: string; tone: "ok" | "warn" | "error" | "info" }
): { label: string; tone: "ok" | "warn" | "error" | "info" } {
  if (!selectedBaseModelId) {
    return { label: "Ziel offen", tone: "warn" };
  }
  return { label: `Ziel ${selectedBaseModel.label}`, tone: selectedBaseModel.tone };
}

export function formatPairingSaveButtonLabel(source: string | undefined, isSaving: boolean): string {
  if (isSaving) {
    return "Speichert ...";
  }
  return source === "manual" ? "Neu zuordnen" : "Zuordnen";
}

export function formatPairingProbeButtonLabel(isProbing: boolean): string {
  return isProbing ? "Prueft ..." : "Probe";
}

export function PairingFeedbackDetails({
  pairingUi,
  feedbackKey,
  align
}: {
  pairingUi: PairingUiController;
  feedbackKey: string;
  align: "left" | "right";
}) {
  if (!pairingUi.pairingFeedback[feedbackKey] || !pairingUi.pairingOutcome[feedbackKey]) {
    return null;
  }

  return (
    <ProbeEvidencePanel
      align={align}
      evidence={pairingUi.pairingEvidence[feedbackKey] ?? []}
      feedback={pairingUi.pairingFeedback[feedbackKey]}
      outcome={pairingUi.pairingOutcome[feedbackKey]}
    />
  );
}

export function PairingSelectionControls({
  feedbackKey,
  selectedBaseModelId,
  targetBadge,
  pairingCandidates,
  pairingUi,
  saveSource,
  canProbePair,
  probeBaseModelId,
  align = "left"
}: {
  feedbackKey: string;
  selectedBaseModelId: string;
  targetBadge: { label: string; tone: UiTone };
  pairingCandidates: IndexedModel[];
  pairingUi: PairingUiController;
  saveSource?: string;
  canProbePair: boolean;
  probeBaseModelId?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex min-w-[280px] flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
      <ToneBadge fit tone={targetBadge.tone}>
        {targetBadge.label}
      </ToneBadge>
      <div className="flex w-full gap-1">
        <select
          className="min-w-0 flex-1 border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-text"
          onChange={(event) => pairingUi.onSelectionChange(feedbackKey, event.target.value)}
          value={selectedBaseModelId}
        >
          <option value="">Basismodell waehlen</option>
          {pairingCandidates.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-text disabled:opacity-40"
          disabled={!selectedBaseModelId || pairingUi.pairingSaving[feedbackKey] === true}
          onClick={() => void pairingUi.saveManualPairing(feedbackKey, selectedBaseModelId)}
          type="button"
        >
          {formatPairingSaveButtonLabel(saveSource, pairingUi.pairingSaving[feedbackKey] === true)}
        </button>
        <button
          className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
          disabled={!canProbePair || pairingUi.pairingProbing[feedbackKey] === true}
          onClick={() => {
            if (probeBaseModelId) {
              void pairingUi.probePairing(feedbackKey, probeBaseModelId);
            }
          }}
          type="button"
        >
          {formatPairingProbeButtonLabel(pairingUi.pairingProbing[feedbackKey] === true)}
        </button>
      </div>
      <PairingFeedbackDetails align={align} feedbackKey={feedbackKey} pairingUi={pairingUi} />
    </div>
  );
}

export function PairingProbeButton({
  feedbackKey,
  canProbePair,
  probeBaseModelId,
  pairingUi
}: {
  feedbackKey: string;
  canProbePair: boolean;
  probeBaseModelId?: string;
  pairingUi: PairingUiController;
}) {
  return (
    <button
      className="border border-dbzs-cyan/30 bg-dbzs-cyan/10 px-2 py-1 text-[10px] text-dbzs-cyan disabled:opacity-40"
      disabled={!canProbePair || pairingUi.pairingProbing[feedbackKey] === true}
      onClick={() => {
        if (probeBaseModelId) {
          void pairingUi.probePairing(feedbackKey, probeBaseModelId);
        }
      }}
      type="button"
    >
      {formatPairingProbeButtonLabel(pairingUi.pairingProbing[feedbackKey] === true)}
    </button>
  );
}
