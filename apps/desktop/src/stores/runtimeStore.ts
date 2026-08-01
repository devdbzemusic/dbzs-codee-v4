import { create } from "zustand";
import type {
  RuntimeDoctorAction,
  RuntimeDoctorActionResult,
  RuntimeDoctorReport,
  RuntimeLogsResponse,
  RuntimeStatus
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";
import { runtimeSlotManager } from "@/services/runtimeSlotManager";

interface RuntimeState {
  status: RuntimeStatus | null;
  doctorReport: RuntimeDoctorReport | null;
  logs: RuntimeLogsResponse | null;
  lastDoctorAction: RuntimeDoctorAction;
  actionResult: RuntimeDoctorActionResult | null;
  isLoading: boolean;
  isRefreshing: boolean;
  doctorLoading: boolean;
  error: string | null;
  loadStatus: () => Promise<void>;
  loadDoctorReport: () => Promise<void>;
  loadLogs: () => Promise<void>;
  dryRunModel: (modelId: string, profileName?: string) => Promise<void>;
  probeModel: (modelId: string) => Promise<void>;
  startModel: (modelId: string, profile?: string) => Promise<void>;
  stopModel: () => Promise<void>;
}

async function captureFailureLogs(): Promise<RuntimeLogsResponse | null> {
  try {
    return await backendClient.getRuntimeLogs();
  } catch {
    return null;
  }
}

async function loadStatusFromSlots(): Promise<RuntimeStatus | null> {
  const slots = await runtimeSlotManager.getAllSlotsStatus();
  const active = slots.find((slot) => runtimeSlotManager.isSlotReady(slot)) ?? slots.find((slot) => slot.state === "running");
  if (!active) {
    return null;
  }

  return {
    state: active.state,
    provider: active.provider === "llama.cpp" || active.provider === "ollama" ? active.provider : null,
    model_id: active.model_id,
    model_name: active.model_name,
    port: active.port,
    pid: active.pid,
    endpoint: active.endpoint,
    message: active.message ?? `Slot ${active.slot_id} ist aktiv.`,
    stderr_tail: active.stderr_tail ?? undefined,
    stdout_tail: active.stdout_tail ?? undefined
  };
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  status: null,
  doctorReport: null,
  logs: null,
  lastDoctorAction: null,
  actionResult: null,
  isLoading: false,
  isRefreshing: false,
  doctorLoading: false,
  error: null,
  loadStatus: async () => {
    set({ isRefreshing: true, error: null });
    try {
      const status = await backendClient.getRuntimeStatus();
      set({ status, isRefreshing: false, error: null });
    } catch (error) {
      try {
        const status = await loadStatusFromSlots();
        if (status) {
          set({ status, isRefreshing: false, error: null });
          return;
        }
      } catch {
        // Der ursprüngliche Status-Fehler ist für die UI hilfreicher.
      }

      set({
        error: error instanceof Error ? error.message : "Runtime-Status konnte nicht geladen werden",
        isRefreshing: false
      });
    }
  },
  loadDoctorReport: async () => {
    set({ doctorLoading: true, error: null });
    try {
      const doctorReport = await backendClient.getRuntimeDoctor();
      set({ doctorReport, doctorLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Runtime Doctor konnte nicht geladen werden",
        doctorLoading: false
      });
    }
  },
  loadLogs: async () => {
    try {
      const logs = await backendClient.getRuntimeLogs();
      set({ logs });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Runtime-Logs konnten nicht geladen werden"
      });
    }
  },
  dryRunModel: async (modelId, profileName = "safe_cpu_coder") => {
    set({ isLoading: true, error: null, lastDoctorAction: "dry-run" });
    try {
      const response = await backendClient.dryRunRuntimeModel({
        model_id: modelId,
        profile_name: profileName
      });
      set({
        isLoading: false,
        actionResult: {
          action: "dry-run",
          success: true,
          message: "Dry Run erfolgreich.",
          command_preview: response.command_preview,
          preset: response.preset
        }
      });
    } catch (error) {
      set({
        isLoading: false,
        actionResult: {
          action: "dry-run",
          success: false,
          message: error instanceof Error ? error.message : "Dry Run fehlgeschlagen."
        }
      });
    }
  },
  probeModel: async (modelId) => {
    set({ isLoading: true, error: null, lastDoctorAction: "probe" });
    try {
      const response = await backendClient.probeRuntimeModel({
        allow_start: true,
        model_id: modelId
      });
      const status = await backendClient.getRuntimeStatus();
      if (!response.allowed) {
        const logs = await captureFailureLogs();
        set({
          status,
          isLoading: false,
          logs,
          actionResult: {
            action: "probe",
            success: false,
            message: response.message,
            stderr_tail: response.stderr_tail || logs?.stderr_tail,
            stdout_tail: response.stdout_tail || logs?.stdout_tail
          }
        });
        return;
      }
      set({
        status,
        isLoading: false,
        actionResult: {
          action: "probe",
          success: true,
          message: response.message
        }
      });
      void useRuntimeStore.getState().loadDoctorReport();
    } catch (error) {
      const logs = await captureFailureLogs();
      set({
        isLoading: false,
        logs,
        actionResult: {
          action: "probe",
          success: false,
          message: error instanceof Error ? error.message : "Probe Start fehlgeschlagen.",
          stderr_tail: logs?.stderr_tail,
          stdout_tail: logs?.stdout_tail
        }
      });
    }
  },
  startModel: async (modelId, profile) => {
    set({ isLoading: true, error: null, lastDoctorAction: "start" });
    try {
      const status = await backendClient.startRuntimeModel(modelId, profile);
      if (status.state === "error") {
        const logs = await captureFailureLogs();
        set({
          status,
          isLoading: false,
          logs,
          actionResult: {
            action: "start",
            success: false,
            message: status.message,
            stderr_tail: status.stderr_tail || logs?.stderr_tail,
            stdout_tail: status.stdout_tail || logs?.stdout_tail
          }
        });
        return;
      }
      set({
        status,
        isLoading: false,
        actionResult: {
          action: "start",
          success: true,
          message: status.message || "Runtime gestartet."
        }
      });
      void useRuntimeStore.getState().loadDoctorReport();
    } catch (error) {
      const logs = await captureFailureLogs();
      set({
        isLoading: false,
        logs,
        actionResult: {
          action: "start",
          success: false,
          message: error instanceof Error ? error.message : "Runtime konnte nicht gestartet werden.",
          stderr_tail: logs?.stderr_tail,
          stdout_tail: logs?.stdout_tail
        }
      });
    }
  },
  stopModel: async () => {
    set({ isLoading: true, error: null, lastDoctorAction: "stop" });
    try {
      const status = await backendClient.stopRuntimeModel();
      set({
        status,
        isLoading: false,
        actionResult: {
          action: "stop",
          success: true,
          message: status.message || "Runtime gestoppt."
        }
      });
      void useRuntimeStore.getState().loadDoctorReport();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Runtime konnte nicht gestoppt werden",
        isLoading: false,
        actionResult: {
          action: "stop",
          success: false,
          message: error instanceof Error ? error.message : "Runtime konnte nicht gestoppt werden."
        }
      });
    }
  }
}));
