import { useState } from "react";
import type { ModelFleetCertificationKind, ModelLabModel } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";
import { formatBytes } from "./ModelLabTab.primitives";

const CERTIFICATION_KINDS: ModelFleetCertificationKind[] = [
  "CHAT_VERIFIED",
  "INSTRUCTION_FOLLOWING_VERIFIED",
  "STRUCTURED_OUTPUT_VERIFIED",
  "TOOL_CALLING_VERIFIED",
  "READ_ONLY_AGENT_VERIFIED",
  "WRITE_AGENT_VERIFIED",
  "CODING_VERIFIED",
  "REPOSITORY_QA_VERIFIED",
  "DEEP_RESEARCH_VERIFIED",
  "LONG_HORIZON_VERIFIED",
  "REPORT_GENERATION_VERIFIED",
  "GPU_PROFILE_VERIFIED"
];

export function ModelLabExpandedDetails({
  entry,
  onAssignAndEnable,
  certifyModel,
  certifyingModel
}: {
  entry: ModelLabModel;
  onAssignAndEnable: (bundleId: string) => void;
  certifyModel?: (request: { bundle_id: string; certification: ModelFleetCertificationKind; status: "passed" }) => void;
  certifyingModel?: boolean;
}) {
  const { bundle, artifacts } = entry;
  const [startingSlot, setStartingSlot] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [startSuccess, setStartSuccess] = useState<string | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null);
  const [selectedCertification, setSelectedCertification] = useState<ModelFleetCertificationKind>(
    "CHAT_VERIFIED"
  );

  const handleStartSlot = async (slotId: string, withVision = false) => {
    setStartingSlot(slotId);
    setStartError(null);
    setStartSuccess(null);
    try {
      // Resolve model id and start
      const modelId = await runtimeSlotManager.resolveModelId(bundle.name, slotId as any);
      
      const result = await runtimeSlotManager.startSlot(slotId as any, modelId);
      if (result.success) {
        setStartSuccess(`Erfolgreich in ${slotId} gestartet.`);
      } else {
        setStartError(result.error || `Fehler beim Start in ${slotId}.`);
      }
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Unbekannter Fehler.");
    } finally {
      setStartingSlot(null);
    }
  };

  const handleBenchmark = async () => {
    if (!backendClient.benchmarkModel) {
      setBenchmarkResult("Benchmark API nicht verfügbar.");
      return;
    }
    setBenchmarking(true);
    setBenchmarkResult(null);
    try {
      const run = await backendClient.benchmarkModel({
        bundle_id: bundle.bundle_id,
        adapter_id: "llama.cpp",
        profile: "safe_balanced"
      });
      setBenchmarkResult(`Gestartet (Run ID: ${run.id}). Status: ${run.status}`);
    } catch (error) {
      setBenchmarkResult(`Fehler: ${error instanceof Error ? error.message : "Unbekannt"}`);
    } finally {
      setBenchmarking(false);
    }
  };

  const capabilities = bundle.capabilities.length > 0 ? bundle.capabilities.join(", ") : "keine";
  const hasVision = bundle.capabilities.includes("vision");
  
  // Bestimme empfohlene Test-Slots
  const testSlots = [
    { id: "orchestrator_cpu", label: "CPU Model Test", requireVision: false },
    { id: "fast_gpu", label: "GPU Model Test", requireVision: false },
    { id: "utility", label: "Hybrid Model Test", requireVision: false },
    { id: "vision_gpu", label: "Primär MM Model + MMPROJ Test > GPU", requireVision: true }
  ];

  return (
    <div className="bg-dbzs-panel/50 p-4 border-b border-dbzs-border/60 ml-4">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Sektion 1: Metadaten */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-medium text-dbzs-text uppercase tracking-widest text-dbzs-muted">Metadaten & Infos</h4>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px] text-dbzs-muted">
            <dt className="font-medium text-dbzs-text/70">Capabilities:</dt>
            <dd>{capabilities}</dd>
            <dt className="font-medium text-dbzs-text/70">Architektur:</dt>
            <dd>{bundle.health.architecture || "-"}</dd>
            <dt className="font-medium text-dbzs-text/70">Quantisierung:</dt>
            <dd>{bundle.health.quantization || "-"}</dd>
            <dt className="font-medium text-dbzs-text/70">Kontextlänge:</dt>
            <dd>{bundle.health.context_length || "-"}</dd>
            <dt className="font-medium text-dbzs-text/70">Artefakte:</dt>
            <dd>{artifacts.length} Dateien</dd>
          </dl>
          {hasVision && (
            <div className="mt-2 inline-block px-2 py-0.5 bg-dbzs-cyan/10 border border-dbzs-cyan/20 text-dbzs-cyan text-[10px] rounded-sm">
              Vision Feature erkannt
            </div>
          )}
        </div>

        {/* Sektion 2: Test-Starts */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-medium text-dbzs-text uppercase tracking-widest text-dbzs-muted">Test-Starts (Runtime)</h4>
          <div className="flex flex-col gap-2">
            {testSlots.map((slot) => {
              if (slot.requireVision && !hasVision) return null;
              
              const isStarting = startingSlot === slot.id;
              return (
                <button
                  key={slot.id}
                  className="text-left px-3 py-1.5 border border-dbzs-border bg-dbzs-bg text-[11px] text-dbzs-text hover:border-dbzs-cyan/50 hover:bg-dbzs-cyan/5 transition-colors disabled:opacity-50"
                  onClick={() => void handleStartSlot(slot.id, slot.requireVision)}
                  disabled={startingSlot !== null}
                  type="button"
                >
                  {isStarting ? "Startet..." : slot.label}
                  <span className="block text-[10px] text-dbzs-muted mt-0.5 opacity-70">
                    Slot: {slot.id}
                  </span>
                </button>
              );
            })}
          </div>
          {startError && <p className="text-[10px] text-dbzs-red mt-1 break-words">{startError}</p>}
          {startSuccess && <p className="text-[10px] text-dbzs-cyan mt-1 break-words">{startSuccess}</p>}
        </div>

        {/* Sektion 3: Benchmarks */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-medium text-dbzs-text uppercase tracking-widest text-dbzs-muted">Benchmarks</h4>
          <p className="text-[10px] text-dbzs-muted">GPU Layer / Aufwärm- Ladedauer Messung</p>
          <button
            className="w-full text-center px-3 py-1.5 border border-dbzs-border bg-dbzs-bg text-[11px] text-dbzs-text hover:border-dbzs-cyan/50 hover:bg-dbzs-cyan/5 transition-colors disabled:opacity-50"
            onClick={() => void handleBenchmark()}
            disabled={benchmarking}
            type="button"
          >
            {benchmarking ? "Benchmark läuft..." : "Benchmark starten"}
          </button>
          {benchmarkResult && (
            <div className="mt-2 p-2 bg-dbzs-bg/50 border border-dbzs-border/50 text-[10px] text-dbzs-muted break-words">
              {benchmarkResult}
            </div>
          )}
        </div>

        {/* Sektion 3b: Zertifizierung — Voraussetzung dafuer, dass eine Rollenzuweisung
            (unten) ueberhaupt erfolgreich sein kann; die meisten Fleet-Rollen verlangen
            mindestens eine bestandene Zertifizierung, bevor sie aktiviert werden koennen. */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-medium text-dbzs-text uppercase tracking-widest text-dbzs-muted">
            Zertifizierung
          </h4>
          <p className="text-[10px] text-dbzs-muted">
            Vor dem Aktivieren einer Rolle noetig. Auf Basis der Test-Starts/Benchmarks oben als bestanden
            markieren.
          </p>
          <div className="space-y-2">
            <select
              className="w-full bg-dbzs-bg border border-dbzs-border text-[10px] text-dbzs-text px-2 py-1"
              onChange={(event) => setSelectedCertification(event.target.value as ModelFleetCertificationKind)}
              value={selectedCertification}
            >
              {CERTIFICATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <button
              className="w-full text-center px-3 py-1.5 border border-dbzs-border bg-dbzs-bg text-[11px] text-dbzs-text hover:border-dbzs-cyan/50 hover:bg-dbzs-cyan/5 transition-colors disabled:opacity-50"
              disabled={!certifyModel || certifyingModel}
              onClick={() =>
                certifyModel?.({ bundle_id: bundle.bundle_id, certification: selectedCertification, status: "passed" })
              }
              type="button"
            >
              {certifyingModel ? "..." : "Als bestanden markieren"}
            </button>
          </div>
        </div>

        {/* Sektion 4: Codee Integration */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-medium text-dbzs-text uppercase tracking-widest text-dbzs-muted">Codee Datenbestand</h4>
          <p className="text-[10px] text-dbzs-muted">
            Einpflegen der Daten / Parameter / Konfiguration in Codee´s Datenbestand (ModelIndex usw.)
          </p>
          <button
            className="w-full text-center px-3 py-2 border border-dbzs-cyan/60 bg-dbzs-cyan/10 text-[11px] font-medium text-dbzs-cyan hover:bg-dbzs-cyan/20 transition-colors"
            onClick={() => onAssignAndEnable(bundle.bundle_id)}
            type="button"
          >
            Zum System hinzufügen & aktivieren
          </button>
          <p className="text-[9px] text-dbzs-muted/70 text-center">
            Weist die Fleet-Rolle "FAST_GENERAL_AGENT" zu und setzt das Chat-Rollenmodell in den Einstellungen —
            erfordert vorher CHAT_VERIFIED und STRUCTURED_OUTPUT_VERIFIED.
          </p>
        </div>

      </div>
    </div>
  );
}
