import "@testing-library/jest-dom/vitest";

/*
 * DBZS – Division By Zeros
 * Datei: setup.ts
 * Bereich: Desktop Tests
 *
 * Zweck:
 *   Installiert vor jedem Testmodul einen vollständig isolierten Web-Storage.
 *
 * Warum:
 *   Neuere Node-Versionen stellen ein experimentelles globales localStorage
 *   bereit, das ohne --localstorage-file bei Zugriff eine Warnung ausgibt.
 *   Renderer-Tests benötigen stattdessen die browserähnliche, flüchtige
 *   Semantik eines frischen jsdom-Workspaces.
 */

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  const target: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(String(key)) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    }
  };
  return new Proxy(target, {
    deleteProperty(_target, property) {
      return typeof property === "string" ? values.delete(property) : true;
    },
    get(current, property, receiver) {
      if (typeof property === "string" && values.has(property)) {
        return values.get(property);
      }
      return Reflect.get(current, property, receiver);
    },
    getOwnPropertyDescriptor(current, property) {
      if (typeof property === "string" && values.has(property)) {
        return {
          configurable: true,
          enumerable: true,
          value: values.get(property),
          writable: true
        };
      }
      return Reflect.getOwnPropertyDescriptor(current, property);
    },
    ownKeys() {
      return [...values.keys()];
    },
    set(_target, property, value) {
      if (typeof property === "string") {
        values.set(property, String(value));
      }
      return true;
    }
  });
}

const storage = createMemoryStorage();

// Nicht zuerst globalThis.localStorage lesen: Schon der Getter des
// experimentellen Node-WebStorage würde die zu behebende Warnung erzeugen.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  enumerable: true,
  value: storage,
  writable: true
});
