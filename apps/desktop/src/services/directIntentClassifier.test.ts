import { describe, it, expect } from "vitest";
import { directIntentClassifier } from "./directIntentClassifier";

describe("directIntentClassifier", () => {
  it("sollte eine Zählanfrage für 'gguf modelle' korrekt erkennen", () => {
    const intent = directIntentClassifier("Zähle alle gguf modelle im Workspace");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("count_files");
    expect(intent?.pattern).toBe("*.gguf");
    expect(intent?.toolInput.operation).toBe("count");
  });

  it("sollte eine Zählanfrage mit Punkt im Muster erkennen", () => {
    const intent = directIntentClassifier("count all .md files in ws");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("count_files");
    expect(intent?.pattern).toBe("*.md");
  });

  it("sollte eine Zählanfrage ohne Dateiendung erkennen", () => {
    const intent = directIntentClassifier("zähle alle Dockerfile im workspace");
    expect(intent).not.toBeNull();
    expect(intent?.pattern).toBe("*.dockerfile");
  });

  it("sollte eine Suchanfrage für 'README-Dateien' korrekt erkennen", () => {
    const intent = directIntentClassifier("Suche alle README-Dateien");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("search_files");
    expect(intent?.pattern).toBe("*readme*");
    expect(intent?.toolInput.operation).toBe("search");
  });

  it("sollte eine Suchanfrage mit Dateiendung erkennen", () => {
    const intent = directIntentClassifier("find all .gitignore files in workspace");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("search_files");
    expect(intent?.pattern).toBe("*.gitignore*");
  });

  it("sollte eine Suchanfrage mit 'ws' als Alias erkennen", () => {
    const intent = directIntentClassifier("search all config files in ws");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("search_files");
    expect(intent?.pattern).toBe("*config*");
  });

  it("sollte eine Listenanfrage für 'tsx-Dateien' korrekt erkennen", () => {
    const intent = directIntentClassifier("Liste alle tsx-Dateien im Workspace");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("list_files");
    expect(intent?.pattern).toBe("*.tsx");
    expect(intent?.toolInput.operation).toBe("list");
  });

  it("sollte eine Listenanfrage mit 'list' als Verb erkennen", () => {
    const intent = directIntentClassifier("list all config.json files");
    expect(intent).not.toBeNull();
    expect(intent?.operation).toBe("list_files");
    expect(intent?.pattern).toBe("*.config.json");
  });

  it("sollte null für eine nicht-deterministische Anfrage zurückgeben", () => {
    const intent = directIntentClassifier("Plane eine neue Modellverwaltung");
    expect(intent).toBeNull();
  });

  it("sollte null für eine normale Chat-Nachricht zurückgeben", () => {
    const intent = directIntentClassifier("Hallo, wie geht es dir?");
    expect(intent).toBeNull();
  });

  it("sollte null für eine unvollständige Anfrage zurückgeben", () => {
    const intent = directIntentClassifier("zähle alle");
    expect(intent).toBeNull();
  });
});
