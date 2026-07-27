import { create } from "zustand";

interface CommandPaletteState {
  open: boolean;
  query: string;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  query: "",
  openPalette: () => set({ open: true, query: "" }),
  closePalette: () => set({ open: false, query: "" }),
  setQuery: (q) => set({ query: q }),
}));
