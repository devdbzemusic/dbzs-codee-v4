import { create } from "zustand";
import type { AppSettings } from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";
import { validatePatch } from "./settingsValidation";

interface SettingsDraftState {
  draft: Partial<AppSettings>;
  fieldErrors: Record<string, string>;
  saving: boolean;
  saveError: string | null;
  setDraftField: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  clearDraftField: <K extends keyof AppSettings>(key: K) => void;
  discardDraft: () => void;
  applyDraft: () => Promise<boolean>;
  dirtyCount: () => number;
}

export const useSettingsDraftStore = create<SettingsDraftState>((set, get) => ({
  draft: {},
  fieldErrors: {},
  saving: false,
  saveError: null,
  dirtyCount: () => Object.keys(get().draft).length,
  setDraftField: (key, value) => {
    set((state) => {
      const savedValue = useSettingsStore.getState().settings[key];
      const nextDraft = { ...state.draft };
      if (JSON.stringify(savedValue) === JSON.stringify(value)) {
        delete nextDraft[key];
      } else {
        nextDraft[key] = value;
      }
      const errors = validatePatch(nextDraft);
      return { draft: nextDraft, fieldErrors: errors, saveError: null };
    });
  },
  clearDraftField: (key) =>
    set((state) => {
      const nextDraft = { ...state.draft };
      delete nextDraft[key];
      return { draft: nextDraft, fieldErrors: validatePatch(nextDraft), saveError: null };
    }),
  discardDraft: () => set({ draft: {}, fieldErrors: {}, saveError: null }),
  applyDraft: async () => {
    const { draft, fieldErrors } = get();
    if (Object.keys(draft).length === 0) {
      return true;
    }
    if (Object.keys(fieldErrors).length > 0) {
      set({ saveError: "Bitte ungültige Felder korrigieren." });
      return false;
    }

    set({ saving: true, saveError: null });
    const settingsStore = useSettingsStore.getState();
    try {
      const ok =
        typeof settingsStore.patchSettings === "function"
          ? await settingsStore.patchSettings(draft)
          : await settingsStore.updateSettings({
              ...settingsStore.settings,
              ...draft,
            });
      if (ok) {
        set({ draft: {}, fieldErrors: {}, saving: false, saveError: null });
        return true;
      }
      set({
        saving: false,
        saveError: settingsStore.error ?? "Speichern fehlgeschlagen.",
      });
      return false;
    } catch (error) {
      set({
        saving: false,
        saveError: error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      });
      return false;
    }
  },
}));
