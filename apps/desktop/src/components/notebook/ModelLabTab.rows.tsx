import { useState } from "react";
import type {
  ModelFleetRole,
  ModelLabModel,
  ModelLabRoleAssignment,
  ModelLabRoleAssignmentRequest,
  ModelLabSource,
  ModelResidencyIntent,
  ModelSettingsFieldRole,
  RuntimeSlotId
} from "@dbzs/shared";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { formatBytes, ModelLabStatusBadge } from "./ModelLabTab.primitives";
import { ToneBadge } from "./RuntimeModelsTab.primitives";

/**
 * Vorschlags-Default fuer Residency Intent (Plan 15, Phase 8 / Stufenplan Stufe 4).
 * Reine Konfigurations-Vorschlagslogik ohne Backend-Aenderung - der Nutzer kann den
 * Wert im Dropdown jederzeit ueberschreiben. Nie automatisch KEEP_RESIDENT ohne
 * explizite Nutzeraktion.
 *
 * Reihenfolge (siehe Stufenplan Stufe 4):
 * 1. vision-Capability gesetzt -> IDLE_EVICT (Zeitteilung mit fast_gpu).
 * 2. Bundle-Status UNSUPPORTED/BROKEN oder noch kein Zertifikat -> MANUAL.
 * 3. sonst IDLE_EVICT.
 */
function suggestResidencyIntent(entry: ModelLabModel, hasCertification: boolean): ModelResidencyIntent {
  const { bundle } = entry;
  if (bundle.capabilities.includes("vision")) {
    return "idle_evict";
  }
  if (bundle.status === "UNSUPPORTED" || bundle.status === "BROKEN" || !hasCertification) {
    return "manual";
  }
  return "idle_evict";
}

/**
 * Zertifizierungs-Badge fuer eine Rollen-Zuweisung (Plan 15, Phase 7).
 * Gleiches Muster wie das "Ungetestet (GPU)"-Badge in RuntimeModelsTab.rows.tsx:
 * ein auffaelliges Warn-Badge, solange noch keine gemessene Zertifizierung fuer
 * diesen Bundle vorliegt, sonst ein Erfolgs-/Fehler-Badge mit dem Score.
 */
function CertificationBadge({ assignment }: { assignment: ModelLabRoleAssignment }) {
  if (assignment.last_certification_score === null) {
    return (
      <ToneBadge title="Noch keine gemessene Zertifizierung fuer dieses Modell gelaufen" tone="warn" uppercase={false}>
        Unzertifiziert
      </ToneBadge>
    );
  }
  const score = assignment.last_certification_score;
  return (
    <ToneBadge
      title={`Letzter Zertifizierungslauf: ${assignment.last_certification_run_id ?? "-"}`}
      tone={score >= 80 ? "ok" : "error"}
      uppercase={false}
    >
      Zertifiziert: {score}%
    </ToneBadge>
  );
}

const FLEET_ROLES: ModelFleetRole[] = [
  "MAIN_AGENT",
  "DEEP_RESEARCH_AGENT",
  "FAST_GENERAL_AGENT",
  "MICRO_TOOL_AGENT",
  "CODING_EXECUTOR",
  "ALGORITHM_SPECIALIST",
  "REASONING_VALIDATOR",
  "REPORT_GENERATOR"
];

const SETTINGS_FIELDS: ModelSettingsFieldRole[] = [
  "defaultModelId",
  "defaultChatModelId",
  "defaultPlannerModelId",
  "defaultCoderModelId",
  "defaultReviewerModelId",
  "defaultDebugModelId",
  "defaultVisionModelId",
  "defaultOrchestratorModelId"
];

const RESIDENCY_INTENTS: ModelResidencyIntent[] = ["manual", "idle_evict", "keep_resident"];

const RUNTIME_SLOTS: RuntimeSlotId[] = ["fast_gpu", "utility", "orchestrator_cpu", "quality_cpu", "vision_gpu"];

export function SourceRow({ source, onScan, isScanning }: { source: ModelLabSource; onScan: () => void; isScanning: boolean }) {
  return (
    <tr className="border-b border-dbzs-border/60">
      <td className="px-2 py-1.5 text-xs text-dbzs-text">{source.name ?? source.path}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{source.path}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
        {source.enabled ? "aktiv" : "deaktiviert"}
        {source.trusted ? " - vertrauenswuerdig" : ""}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
        {source.last_scan_status ?? "noch nicht gescannt"}
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-40"
          disabled={isScanning || !source.enabled}
          onClick={onScan}
          type="button"
        >
          {isScanning ? "Scannt..." : "Scan"}
        </button>
      </td>
    </tr>
  );
}

import { ModelLabExpandedDetails } from "./ModelLabTab.expanded";

export function ModelBundleRow({
  entry,
  isSelected,
  onSelect,
  onAssignAndEnable,
  certifyModel,
  certifyingModel
}: {
  entry: ModelLabModel;
  isSelected: boolean;
  onSelect: () => void;
  onAssignAndEnable: (bundleId: string) => void;
  certifyModel?: (request: { bundle_id: string; certification: import("@dbzs/shared").ModelFleetCertificationKind; status: "passed" }) => void;
  certifyingModel?: boolean;
}) {
  const { bundle } = entry;
  const [isExpanded, setIsExpanded] = useState(false);
  const totalSize = entry.artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);

  const handleRowClick = () => {
    onSelect();
    setIsExpanded(!isExpanded);
  };

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-dbzs-border/60 transition-colors ${isSelected ? "bg-dbzs-cyan/5" : "hover:bg-dbzs-bg"}`}
        onClick={handleRowClick}
      >
        <td className="px-2 py-1.5 text-xs text-dbzs-text">
          {bundle.is_favorite ? "* " : ""}
          <span className="inline-block w-4 text-dbzs-muted">{isExpanded ? "▼" : "▶"}</span>
          {bundle.name}
        </td>
        <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
          <ModelLabStatusBadge status={bundle.status} />
        </td>
        <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{bundle.health.quantization ?? "-"}</td>
        <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{formatBytes(totalSize)}</td>
        <td className="px-2 py-1.5 text-[11px] text-dbzs-muted max-w-xs truncate">{bundle.capabilities.join(", ") || "-"}</td>
        <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">{entry.artifacts.length}</td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="p-0 border-b border-dbzs-border/60">
            <ModelLabExpandedDetails
              entry={entry}
              onAssignAndEnable={onAssignAndEnable}
              certifyModel={certifyModel}
              certifyingModel={certifyingModel}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export function RoleAssignmentRow({
  entry,
  assignments,
  hasConflict,
  assigningRole,
  onAssignRole
}: {
  entry: ModelLabModel;
  assignments: ModelLabRoleAssignment[];
  hasConflict: boolean;
  assigningRole: boolean;
  onAssignRole: (request: ModelLabRoleAssignmentRequest) => void;
}) {
  const { bundle } = entry;
  const [role, setRole] = useState<ModelFleetRole>(assignments[0]?.role ?? FLEET_ROLES[0]);
  const [settingsField, setSettingsField] = useState<ModelSettingsFieldRole | "">(
    assignments[0]?.settings_field ?? ""
  );
  const [residencyIntent, setResidencyIntent] = useState<ModelResidencyIntent>(
    assignments[0]?.residency_intent ?? suggestResidencyIntent(entry, assignments[0]?.last_certification_score != null)
  );
  const [enabled, setEnabled] = useState(assignments[0]?.enabled ?? false);

  const [slotId, setSlotId] = useState<RuntimeSlotId>(RUNTIME_SLOTS[0]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleAssign = () => {
    onAssignRole({
      bundle_id: bundle.bundle_id,
      role,
      settings_field: settingsField || null,
      residency_intent: residencyIntent,
      enabled
    });
  };

  const handleStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const modelId = await runtimeSlotManager.resolveModelId(bundle.name, slotId);
      const result = await runtimeSlotManager.startSlot(slotId, modelId);
      if (!result.success) {
        setStartError(result.error || "Start fehlgeschlagen.");
      }
    } catch (error) {
      setStartError(
        error instanceof Error
          ? `${error.message} Evtl. muss die Model-Lab-Runtime-Bridge aktiviert werden (Phase 2, separat).`
          : "Unbekannter Fehler."
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <tr className="border-b border-dbzs-border/60">
      <td className="px-2 py-1.5 text-xs text-dbzs-text">{bundle.name}</td>
      <td className="px-2 py-1.5 text-[11px] text-dbzs-muted">
        <ModelLabStatusBadge status={bundle.status} />
      </td>
      <td className="px-2 py-1.5 text-[11px]">
        {assignments.length === 0 ? (
          <span className="text-dbzs-muted">keine Zuordnung</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            {assignments.map((assignment) => (
              <div className="flex items-center gap-1" key={assignment.id}>
                <span className="text-dbzs-text">
                  {assignment.role}
                  {assignment.settings_field ? ` -> ${assignment.settings_field}` : ""}
                  {assignment.enabled ? "" : " (manuell)"}
                </span>
                <CertificationBadge assignment={assignment} />
              </div>
            ))}
          </div>
        )}
        {hasConflict ? <span className="ml-1 text-dbzs-red">Konflikt</span> : null}
      </td>
      <td className="px-2 py-1.5">
        <select
          className="border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[11px] text-dbzs-text"
          onChange={(event) => setRole(event.target.value as ModelFleetRole)}
          value={role}
        >
          {FLEET_ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          className="border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[11px] text-dbzs-text"
          onChange={(event) => setSettingsField(event.target.value as ModelSettingsFieldRole | "")}
          value={settingsField}
        >
          <option value="">- keine -</option>
          {SETTINGS_FIELDS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          className="border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[11px] text-dbzs-text"
          onChange={(event) => setResidencyIntent(event.target.value as ModelResidencyIntent)}
          value={residencyIntent}
        >
          {RESIDENCY_INTENTS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <label className="flex items-center gap-1 text-[11px] text-dbzs-muted">
          <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          aktiv
        </label>
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-40"
          disabled={assigningRole}
          onClick={handleAssign}
          type="button"
        >
          Zuweisen
        </button>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <select
            className="border border-dbzs-border bg-dbzs-bg px-1 py-0.5 text-[11px] text-dbzs-text"
            onChange={(event) => setSlotId(event.target.value as RuntimeSlotId)}
            value={slotId}
          >
            {RUNTIME_SLOTS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            className="border border-dbzs-border bg-dbzs-bg px-2 py-1 text-[10px] text-dbzs-muted hover:text-dbzs-text disabled:opacity-40"
            disabled={starting}
            onClick={() => void handleStart()}
            type="button"
          >
            {starting ? "Startet..." : "Start"}
          </button>
        </div>
        {startError ? <p className="mt-1 text-[10px] text-dbzs-red">{startError}</p> : null}
      </td>
    </tr>
  );
}
