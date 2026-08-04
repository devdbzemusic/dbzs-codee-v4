/**
 * DBZS – Division By Zeros
 * Datei: RuntimeSlotPanel.tsx
 * Bereich: Desktop Components / Runtime Slot Panel
 *
 * Zweck:
 *   Zeigt Runtime-Slots mit Status, Start/Stop-Controls und Diagnostik.
 *
 * Warum:
 *   Benutzer müssen Slots einfach verwalten können.
 *
 * Wozu:
 *   Ermöglicht kontrollierte Slot-Verwaltung im Runtime Chat.
 */

import React, { useEffect, useState, useCallback } from "react";
import type { RuntimeSlotHealthEvent } from "@dbzs/shared";
import type { RuntimeSlotId } from "@/services/modelSelectionBroker";
import { runtimeSlotManager, getRecentRoutingEvents, type RuntimeSlotStatus } from "@/services/runtimeSlotManager";
import { getAllSlotHealthStates, getSlotHealthState } from "@/services/runtimeProcessSupervisor";
import { modelContextCacheClient } from "@/services/modelContextCacheClient";
import { backendClient } from "@/services/backendClient";
import { openPlatformDiagnosticsWindow } from "@/utils/platformDiagnosticsWindow";

const RUNTIME_PROFILES = ["fast", "balanced", "hybrid", "large_context", "cpu_safe"] as const;
type RuntimeProfileName = (typeof RUNTIME_PROFILES)[number];

export interface RuntimeSlotPanelProps {
  compact?: boolean;
  autoStart?: boolean;
  onSlotStart?: (slotId: RuntimeSlotId) => void;
  onSlotStop?: (slotId: RuntimeSlotId) => void;
}

export const RuntimeSlotPanel: React.FC<RuntimeSlotPanelProps> = ({
  compact = false,
  autoStart = false,
  onSlotStart,
  onSlotStop
}) => {
  const [slots, setSlots] = useState<RuntimeSlotStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState<Record<string, boolean>>({});
  const [isStopping, setIsStopping] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [profileBySlot, setProfileBySlot] = useState<Record<string, RuntimeProfileName>>({});
  const [previewBySlot, setPreviewBySlot] = useState<Record<string, string>>({});
  const [isPreviewing, setIsPreviewing] = useState<Record<string, boolean>>({});
  const [cacheClearStatus, setCacheClearStatus] = useState<string | null>(null);
  const [diagnosticsExportStatus, setDiagnosticsExportStatus] = useState<string | null>(null);
  const [routingEvents, setRoutingEvents] = useState(getRecentRoutingEvents(5));
  const [eventFilter, setEventFilter] = useState<"all" | "info" | "warn">("all");

  // Slots laden
  const loadSlots = useCallback(async () => {
    setIsLoading(true);
    try {
      const allSlots = await runtimeSlotManager.getAllSlotsStatus();
      setSlots(allSlots);
      setRoutingEvents(getRecentRoutingEvents(5));
    } catch (error) {
      console.error("[RuntimeSlotPanel] Fehler beim Laden:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial laden + Polling
  useEffect(() => {
    loadSlots();
    const interval = setInterval(loadSlots, 5000); // 5s Polling
    return () => clearInterval(interval);
  }, [loadSlots]);

  // Auto-Start beim Mount
  useEffect(() => {
    if (autoStart && slots.length > 0) {
      const runningSlots = slots.filter(s => runtimeSlotManager.isSlotReady(s));
      if (runningSlots.length === 0) {
        // Keiner läuft → Default starten
        runtimeSlotManager.autoStartSlots();
      }
    }
  }, [autoStart, slots]);

  // Slot starten
  const handleStart = async (slotId: RuntimeSlotId) => {
    setIsStarting(prev => ({ ...prev, [slotId]: true }));
    setErrors(prev => ({ ...prev, [slotId]: "" }));

    try {
      const modelId = await runtimeSlotManager.resolveDefaultModelForSlot(slotId);
      const result = await runtimeSlotManager.startSlot(slotId, modelId);

      if (result.success) {
        onSlotStart?.(slotId);
        await loadSlots(); // Refresh
      } else {
        setErrors(prev => ({ ...prev, [slotId]: result.error || "Start fehlgeschlagen" }));
      }
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        [slotId]: error instanceof Error ? error.message : "Unbekannter Fehler"
      }));
    } finally {
      setIsStarting(prev => ({ ...prev, [slotId]: false }));
    }
  };

  // Slot stoppen
  const handleStop = async (slotId: RuntimeSlotId) => {
    setIsStopping(prev => ({ ...prev, [slotId]: true }));

    try {
      const result = await runtimeSlotManager.stopSlot(slotId);

      if (result.success) {
        onSlotStop?.(slotId);
        await loadSlots(); // Refresh
      } else {
        setErrors(prev => ({ ...prev, [slotId]: result.error || "Stop fehlgeschlagen" }));
      }
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        [slotId]: error instanceof Error ? error.message : "Unbekannter Fehler"
      }));
    } finally {
      setIsStopping(prev => ({ ...prev, [slotId]: false }));
    }
  };

  // Slot neu starten
  const handleRestart = async (slotId: RuntimeSlotId) => {
    await handleStop(slotId);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await handleStart(slotId);
  };

  // Platform Diagnostics öffnen
  const handleOpenDiagnostics = () => {
    openPlatformDiagnosticsWindow();
  };

  // "Neu vermessen" — Resource Plan ohne Start berechnen
  const handleRemeasure = async (slotId: RuntimeSlotId, currentModelId: string | null) => {
    setIsPreviewing((prev) => ({ ...prev, [slotId]: true }));
    try {
      const modelId = currentModelId || (await runtimeSlotManager.resolveDefaultModelForSlot(slotId));
      const plan = await runtimeSlotManager.previewResourcePlan(slotId, modelId, profileBySlot[slotId] ?? "balanced");
      if (plan) {
        setPreviewBySlot((prev) => ({
          ...prev,
          [slotId]: `GPU-Layer ${plan.gpu_layers} · Kontext ${plan.context_size} · VRAM ${
            plan.estimated_total_vram_bytes ? Math.round(Number(plan.estimated_total_vram_bytes) / (1024 * 1024)) : "?"
          } MB`
        }));
      } else {
        setPreviewBySlot((prev) => ({ ...prev, [slotId]: "Vermessung fehlgeschlagen." }));
      }
    } finally {
      setIsPreviewing((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  // "Profil speichern" — Slot mit gewähltem Profil neu starten (persistiert den resultierenden Plan)
  const handleSaveProfile = async (slotId: RuntimeSlotId, currentModelId: string | null) => {
    const modelId = currentModelId || (await runtimeSlotManager.resolveDefaultModelForSlot(slotId));
    setIsStarting((prev) => ({ ...prev, [slotId]: true }));
    try {
      await runtimeSlotManager.stopSlot(slotId);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await runtimeSlotManager.startSlot(slotId, modelId, profileBySlot[slotId] ?? "balanced");
      if (!result.success) {
        setErrors((prev) => ({ ...prev, [slotId]: result.error || "Profil speichern fehlgeschlagen" }));
      }
      await loadSlots();
    } finally {
      setIsStarting((prev) => ({ ...prev, [slotId]: false }));
    }
  };

  // "Kontext-Cache leeren" — betrifft nur den Model-Context-Cache, nicht die Runtime-Residency.
  const handleClearCache = async () => {
    setCacheClearStatus("...");
    const success = await modelContextCacheClient.clear();
    setCacheClearStatus(success ? "Kontext-Cache geleert." : "Kontext-Cache leeren fehlgeschlagen.");
  };

  // Buendelt crash.log, redigierte Settings und den Modellindex in ein ZIP fuer Support-Zwecke.
  const handleExportFullDiagnostics = async () => {
    setDiagnosticsExportStatus("Exportiere...");
    try {
      const targetPath = await backendClient.exportFullDiagnosticsZip(getAllSlotHealthStates());
      setDiagnosticsExportStatus(targetPath ? `Exportiert: ${targetPath}` : "Export abgebrochen.");
    } catch (error) {
      setDiagnosticsExportStatus(
        error instanceof Error ? `Export fehlgeschlagen: ${error.message}` : "Export fehlgeschlagen."
      );
    }
  };

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

  return (
    <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Runtime Slots</h3>
        <div className="flex items-center gap-2">
          {cacheClearStatus && <span className="text-xs text-gray-400">{cacheClearStatus}</span>}
          <button
            onClick={handleClearCache}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
            title="Model Context Cache leeren"
          >
            🧹 Kontext-Cache leeren
          </button>
          <button
            onClick={handleOpenDiagnostics}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
            title="Platform Diagnostics öffnen"
          >
            🔍 Diagnostics
          </button>
          <button
            onClick={handleExportFullDiagnostics}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
            title="crash.log, Settings (redigiert) und Modellindex als ZIP exportieren"
          >
            📦 Vollpaket exportieren
          </button>
        </div>
      </div>
      {diagnosticsExportStatus && (
        <p className="text-xs text-gray-400 break-all">{diagnosticsExportStatus}</p>
      )}

      {/* Slot Cards */}
      <div className="space-y-3">
        {slots.map(slot => (
          <SlotCard
            key={slot.slot_id}
            slot={slot}
            compact={compact}
            isStarting={!!isStarting[slot.slot_id]}
            isStopping={!!isStopping[slot.slot_id]}
            isPreviewing={!!isPreviewing[slot.slot_id]}
            error={errors[slot.slot_id]}
            preview={previewBySlot[slot.slot_id]}
            profile={profileBySlot[slot.slot_id] ?? "balanced"}
            onProfileChange={(profile) => setProfileBySlot((prev) => ({ ...prev, [slot.slot_id]: profile }))}
            onStart={() => handleStart(slot.slot_id)}
            onStop={() => handleStop(slot.slot_id)}
            onRestart={() => handleRestart(slot.slot_id)}
            onRemeasure={() => handleRemeasure(slot.slot_id, slot.model_id)}
            onSaveProfile={() => handleSaveProfile(slot.slot_id, slot.model_id)}
          />
        ))}
      </div>

      {!compact && (
        <div className="pt-3 border-t border-gray-700 space-y-2 text-xs text-gray-400">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-200">Hardening-Events</h4>
              <select
                value={eventFilter}
                onChange={(event) => setEventFilter(event.target.value as "all" | "info" | "warn")}
                className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-[11px] text-gray-200"
                title="Hardening-Events filtern"
              >
                <option value="all">Alle</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
              </select>
            </div>
            {routingEvents.length === 0 ? (
              <p className="mt-1">Noch keine Hardening-Events registriert.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {routingEvents
                  .filter((event) => eventFilter === "all" || event.level === eventFilter)
                  .map((event, index) => {
                  const slotId = typeof event.detail.slotId === "string" ? event.detail.slotId : "n/a";
                  const reason = typeof event.detail.reason === "string" ? event.detail.reason : "n/a";
                  const resolvedAt = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : "--:--";
                  return (
                    <li key={`${event.event}-${index}`} className="rounded border border-gray-700 bg-gray-800/70 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-200">{event.event}</span>
                        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                          {event.level}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-400">
                        {slotId} · {reason} · {resolvedAt}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p>
            💡 Tipp: Slots werden automatisch gestartet bei Bedarf.
            Manueller Start nur bei spezifischen Modellen empfohlen.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Einzelne Slot-Card.
 */
interface SlotCardProps {
  slot: RuntimeSlotStatus;
  compact: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isPreviewing: boolean;
  error?: string;
  preview?: string;
  profile: RuntimeProfileName;
  onProfileChange: (profile: RuntimeProfileName) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRemeasure: () => void;
  onSaveProfile: () => void;
}

const HEALTH_EVENT_LABELS: Record<string, string> = {
  start: "Gestartet",
  stop: "Gestoppt",
  crash: "Abgestürzt",
  restart_attempt: "Neustart-Versuch",
  budget_exhausted: "Restart-Budget erschöpft",
  oom: "Speicher erschöpft (OOM)"
};

/**
 * Ausklappbare, persistente Health-/Failure-Historie eines Slots (Plan 15, Phase 6).
 * Laedt erst beim ersten Aufklappen (nicht bei jedem Slot-Poll), damit das Panel
 * nicht bei jedem der ueblichen 5s-Status-Refreshes zusaetzliche Requests feuert.
 */
const SlotHealthHistory: React.FC<{ slotId: RuntimeSlotId }> = ({ slotId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [events, setEvents] = useState<RuntimeSlotHealthEvent[]>([]);

  const toggle = useCallback(async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && !hasLoaded) {
      setIsLoading(true);
      try {
        const history = await runtimeSlotManager.listSlotHealthEvents(slotId);
        setEvents(history);
      } finally {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [isOpen, hasLoaded, slotId]);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => void toggle()}
        className="text-xs text-blue-300 underline decoration-dotted hover:text-blue-200"
      >
        {isOpen ? "Verlauf ausblenden" : "Verlauf anzeigen"}
      </button>
      {isOpen && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-700 bg-gray-900/60 p-1.5 text-xs text-gray-300">
          {isLoading && <p className="text-gray-500">Lade Verlauf…</p>}
          {!isLoading && events.length === 0 && <p className="text-gray-500">Kein Verlauf vorhanden.</p>}
          {!isLoading &&
            events.map((event) => (
              <div key={event.id} className="border-b border-gray-800 py-0.5 last:border-b-0">
                <span className="font-medium text-gray-200">
                  {HEALTH_EVENT_LABELS[event.event_type] ?? event.event_type}
                </span>{" "}
                <span className="text-gray-500">{new Date(event.occurred_at).toLocaleString()}</span>
                {event.detail && <p className="text-gray-400">{event.detail}</p>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

const SlotCard: React.FC<SlotCardProps> = ({
  slot,
  compact,
  isStarting,
  isStopping,
  isPreviewing,
  error,
  preview,
  profile,
  onProfileChange,
  onStart,
  onStop,
  onRestart,
  onRemeasure,
  onSaveProfile
}) => {
  const isReady = slot.state === "running" && slot.chat_ready;
  const isRunning = slot.state === "running" || slot.state === "starting";
  const healthState = getSlotHealthState(slot.slot_id);

  // Status Badge
  const statusStyles: Record<string, string> = {
    stopped: "bg-gray-600 text-white",
    starting: "bg-blue-600 text-white",
    running: "bg-green-600 text-white",
    error: "bg-red-600 text-white"
  };

  const statusLabels: Record<string, string> = {
    stopped: "Gestoppt",
    starting: "Startet...",
    running: "Läuft",
    error: "Fehler"
  };

  // VRAM-Anzeige (nur GPU)
  const vramPercent = slot.vram_total_bytes && slot.vram_used_bytes
    ? Math.round((slot.vram_used_bytes / slot.vram_total_bytes) * 100)
    : null;

  return (
    <div className={`p-3 rounded border ${
      isReady ? "border-green-600 bg-green-900/10" :
      slot.state === "error" ? "border-red-600 bg-red-900/10" :
      "border-gray-600 bg-gray-800/50"
    }`}>
      <div className="flex items-center gap-3">
        {/* Status Icon */}
        <span className={`text-2xl ${
          isReady ? "text-green-400" :
          slot.state === "error" ? "text-red-400" :
          "text-gray-400"
        }`}>
          {isReady ? "✓" : slot.state === "error" ? "✗" : "○"}
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">
              {slot.slot_id}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyles[slot.state]}`}>
              {statusLabels[slot.state]}
            </span>
            {isReady && (
              <span className="text-xs text-green-400">· Chat Ready</span>
            )}
          </div>

          {!compact && (
            <div className="mt-1 space-y-1 text-xs text-gray-400">
              {slot.model_name && (
                <p className="truncate">Modell: {slot.model_name}</p>
              )}
              {slot.endpoint && (
                <p className="font-mono">{slot.endpoint}</p>
              )}
              {slot.port && (
                <p>Port: {slot.port}</p>
              )}
              {vramPercent !== null && (
                <div className="flex items-center gap-2">
                  <span>VRAM: {vramPercent}%</span>
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                      style={{ width: `${vramPercent}%` }}
                    />
                  </div>
                </div>
              )}
              {(slot.gpu_layers !== null || slot.context_size !== null) && (
                <p>
                  GPU-Layer: {slot.gpu_layers ?? "-"} · Kontext: {slot.context_size ?? "-"}
                  {slot.reserved_output_tokens ? ` · Antwortreserve: ${slot.reserved_output_tokens}` : ""}
                </p>
              )}
              {(slot.batch_size || slot.micro_batch_size) && (
                <p>
                  Batch: {slot.batch_size ?? "-"} · UBatch: {slot.micro_batch_size ?? "-"}
                </p>
              )}
              {(slot.cache_type_k || slot.cache_type_v) && (
                <p>
                  KV-Cache: K {slot.cache_type_k ?? "-"} / V {slot.cache_type_v ?? "-"}
                </p>
              )}
              {slot.residency_state && (
                <p>
                  Runtime-Cache: {slot.residency_state}
                  {typeof slot.active_requests === "number" ? ` · Aktive Anfragen: ${slot.active_requests}` : ""}
                </p>
              )}
              {preview && <p className="text-blue-300">Vermessung: {preview}</p>}
            </div>
          )}

          {/* Fehlermeldung */}
          {error && (
            <p className="mt-1 text-xs text-red-400">{error}</p>
          )}
          {slot.error_message && slot.state === "error" && (
            <p className="mt-1 text-xs text-red-400">{slot.error_message}</p>
          )}
          {slot.state === "error" && healthState.lastKnownModelId && (
            <p className="mt-1 text-xs text-yellow-400">
              {healthState.budgetExhausted
                ? "Auto-Recovery: Restart-Budget erschöpft — manueller Neustart nötig."
                : `Auto-Recovery: Neustart wird versucht (${healthState.restartAttempts}/3 in diesem Fenster).`}
            </p>
          )}
          {!compact && <SlotHealthHistory slotId={slot.slot_id} />}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1.5">
          {!compact && (
            <select
              value={profile}
              onChange={(event) => onProfileChange(event.target.value as RuntimeProfileName)}
              className="bg-gray-800 border border-gray-600 text-white text-xs rounded px-1.5 py-1"
              title="Runtime-Profil"
            >
              {RUNTIME_PROFILES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-1">
            {!compact && (
              <>
                <button
                  onClick={onRemeasure}
                  disabled={isPreviewing}
                  className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded text-xs font-medium transition-colors"
                  title="Neu vermessen"
                >
                  {isPreviewing ? "..." : "📏"}
                </button>
                <button
                  onClick={onSaveProfile}
                  disabled={isStarting}
                  className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded text-xs font-medium transition-colors"
                  title="Profil speichern (Slot mit gewähltem Profil neu starten)"
                >
                  💾
                </button>
              </>
            )}
            {!isRunning && (
              <button
                onClick={onStart}
                disabled={isStarting}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
                title="Slot starten"
              >
                {isStarting ? "..." : "▶ Start"}
              </button>
            )}

            {isRunning && (
              <>
                <button
                  onClick={onRestart}
                  disabled={isStarting || isStopping}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
                  title="Runtime neu starten"
                >
                  ↻
                </button>
                <button
                  onClick={onStop}
                  disabled={isStopping}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
                  title="Slot stoppen"
                >
                  {isStopping ? "..." : "⏹ Stop"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RuntimeSlotPanel;
