import { vi } from "vitest";

export function ensureLocalStorage(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (descriptor && "value" in descriptor && descriptor.value) {
    return;
  }

  let store: Record<string, string> = {};
  const mock = {
    clear: () => {
      store = {};
    },
    getItem: (key: string) => store[key] ?? null,
    key: (index: number) => Object.keys(store)[index] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    get length() {
      return Object.keys(store).length;
    }
  };

  vi.stubGlobal("localStorage", mock);
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: mock
    });
  }
}
