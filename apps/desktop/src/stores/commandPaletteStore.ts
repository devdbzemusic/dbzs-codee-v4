import { create } from "zustand";

export type RuntimeChatPresetId = "plan" | "refactor" | "review" | "summarize" | "next_steps";

interface CommandPaletteState {
  open: boolean;
  query: string;
  runtimeChatCapabilitiesRequestId: number;
  runtimeChatPresetRequest: { id: number; preset: RuntimeChatPresetId } | null;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
  requestRuntimeChatCapabilities: () => void;
  requestRuntimeChatPreset: (preset: RuntimeChatPresetId) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  query: "",
  runtimeChatCapabilitiesRequestId: 0,
  runtimeChatPresetRequest: null,
  openPalette: () => set({ open: true, query: "" }),
  closePalette: () => set({ open: false, query: "" }),
  setQuery: (q) => set({ query: q }),
  requestRuntimeChatCapabilities: () =>
    set((state) => ({ runtimeChatCapabilitiesRequestId: state.runtimeChatCapabilitiesRequestId + 1 })),
  requestRuntimeChatPreset: (preset) =>
    set((state) => ({
      runtimeChatPresetRequest: {
        id: (state.runtimeChatPresetRequest?.id ?? 0) + 1,
        preset
      }
    })),
}));
