import { create } from "zustand";
import type {
  AppSettings,
  BackendHealth,
  BackendStartupStatus,
  SettingsDiagnostics,
  SettingsPatchRequest,
} from "@dbzs/shared";
import { DEFAULT_SETTINGS } from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

const ROLE_MODEL_KEYS = [
  "defaultModelId",
  "defaultChatModelId",
  "defaultPlannerModelId",
  "defaultCoderModelId",
  "defaultReviewerModelId",
  "defaultDebugModelId",
  "defaultUtilityModelId",
  "defaultOrchestratorModelId",
] as const;

function roleModelsChanged(previous: AppSettings, next: AppSettings): boolean {
  return ROLE_MODEL_KEYS.some((key) => {
    const left = previous[key as keyof AppSettings] ?? "";
    const right = next[key as keyof AppSettings] ?? "";
    return String(left) !== String(right);
  });
}

interface SettingsState {
  settings: AppSettings;
  /** Monotonic revision bumped when settings are loaded or role models change. */
  settingsRevision: number;
  roleModelConfiguredAt: string | null;
  backendHealth: BackendHealth | null;
  backendStartupStatus: BackendStartupStatus | null;
  diagnostics: SettingsDiagnostics | null;
  isLoading: boolean;
  error: string | null;
  loadInitialState: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<boolean>;
  patchSettings: (changes: Partial<AppSettings>) => Promise<boolean>;
  loadDiagnostics: () => Promise<SettingsDiagnostics | null>;
  setBackendStartupStatus: (status: BackendStartupStatus) => void;
  setError: (error: string | null) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsRevision: 0,
  roleModelConfiguredAt: null,
  backendHealth: null,
  backendStartupStatus: null,
  diagnostics: null,
  isLoading: false,
  error: null,
  setBackendStartupStatus: (status) => {
    set({ backendStartupStatus: status });
    if (status.state === "failed" && status.message) {
      set({ error: status.message });
    }
    if (status.state === "ready") {
      set({ error: null });
    }
  },
  setError: (error) => set({ error }),
  loadInitialState: async () => {
    set({ isLoading: true, error: null });
    try {
      const [backendHealth, settings] = await Promise.all([
        backendClient.getBackendHealth(),
        backendClient.getSettings(),
      ]);
      set((state) => ({
        backendHealth,
        settings,
        settingsRevision: settings.revision ?? state.settingsRevision + 1,
        isLoading: false,
        error: null,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unbekannter Backend-Fehler",
        isLoading: false,
      });
    }
  },
  updateSettings: async (settings) => {
    set({ isLoading: true, error: null });
    try {
      const previous = get().settings;
      const saved = await backendClient.updateSettings(settings);
      const rolesChanged = roleModelsChanged(previous, saved);
      set((state) => ({
        settings: saved,
        isLoading: false,
        settingsRevision: saved.revision ?? (rolesChanged ? state.settingsRevision + 1 : state.settingsRevision),
        roleModelConfiguredAt: rolesChanged
          ? new Date().toISOString()
          : state.roleModelConfiguredAt,
      }));
      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Settings konnten nicht gespeichert werden",
        isLoading: false,
      });
      return false;
    }
  },
  patchSettings: async (changes) => {
    set({ isLoading: true, error: null });
    try {
      const previous = get().settings;
      const request: SettingsPatchRequest = {
        baseRevision: previous.revision ?? 0,
        changes,
      };
      const response = await backendClient.patchSettings(request);
      const saved = response.settings;
      const rolesChanged = roleModelsChanged(previous, saved);
      set((state) => ({
        settings: saved,
        isLoading: false,
        settingsRevision: response.revision,
        roleModelConfiguredAt: rolesChanged
          ? new Date().toISOString()
          : state.roleModelConfiguredAt,
      }));
      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Settings-Patch fehlgeschlagen",
        isLoading: false,
      });
      return false;
    }
  },
  loadDiagnostics: async () => {
    try {
      const diagnostics = await backendClient.getSettingsDiagnostics();
      set({ diagnostics });
      return diagnostics;
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Settings-Diagnose konnte nicht geladen werden",
      });
      return null;
    }
  },
}));
