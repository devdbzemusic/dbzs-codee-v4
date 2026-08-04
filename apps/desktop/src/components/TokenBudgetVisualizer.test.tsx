import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenBudgetVisualizer, type TokenBudgetSnapshot } from "./TokenBudgetVisualizer";

declare global {
   
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("TokenBudgetVisualizer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderBudget = (budget: TokenBudgetSnapshot | null) => {
    act(() => {
      root.render(<TokenBudgetVisualizer budget={budget} />);
    });
  };

  const progressBar = () => container.querySelector('[role="progressbar"]');

  it("sollte eine Nachricht anzeigen, wenn kein Budget vorhanden ist", () => {
    renderBudget(null);
    expect(container.textContent).toContain("Keine Budget-Daten verfügbar.");
  });

  it("sollte die korrekte prozentuale Auslastung und eine cyanfarbene Leiste für geringe Auslastung anzeigen", () => {
    renderBudget({
      runtimeContextLimit: 10000,
      totalRequiredTokens: 4000,
      totalInputTokens: 3000,
      outputReserveTokens: 1000,
      toolTokens: 500
    });

    expect(container.textContent).toContain("40.0%");
    const bar = progressBar();
    expect(bar?.className).toContain("bg-dbzs-cyan");
    expect(bar?.getAttribute("style")).toContain("width: 40%");
  });

  it("sollte eine bernsteinfarbene Leiste für hohe Auslastung anzeigen", () => {
    renderBudget({
      runtimeContextLimit: 10000,
      totalRequiredTokens: 8500,
      totalInputTokens: 7000,
      outputReserveTokens: 1500,
      toolTokens: 1000
    });

    expect(container.textContent).toContain("85.0%");
    expect(progressBar()?.className).toContain("bg-dbzs-amber");
  });

  it("sollte eine rote Leiste für kritische Auslastung anzeigen", () => {
    renderBudget({
      runtimeContextLimit: 10000,
      totalRequiredTokens: 9800,
      totalInputTokens: 8000,
      outputReserveTokens: 1800,
      toolTokens: 1500
    });

    expect(container.textContent).toContain("98.0%");
    expect(progressBar()?.className).toContain("bg-dbzs-red");
  });

  it("sollte alle Budget-Posten korrekt formatieren", () => {
    renderBudget({
      runtimeContextLimit: 16384,
      totalRequiredTokens: 8192,
      totalInputTokens: 6144,
      outputReserveTokens: 1024,
      toolTokens: 512
    });

    expect(container.textContent).toContain("Bedarf (Input + Output)");
    expect(container.textContent).toContain("8,192 Tokens");

    expect(container.textContent).toContain("Limit des Modells");
    expect(container.textContent).toContain("16,384 Tokens");

    expect(container.textContent).toContain("Input (Prompt + Tools)");
    expect(container.textContent).toContain("6,144 Tokens");

    expect(container.textContent).toContain("Output-Reserve");
    expect(container.textContent).toContain("1,024 Tokens");

    expect(container.textContent).toContain("Sicherheitspuffer");
    expect(container.textContent).toContain("Tool-Definitionen");
    expect(container.textContent).toContain("512 Tokens");
  });

  it("sollte den Posten 'Tool-Definitionen' nicht anzeigen, wenn toolTokens 0 ist", () => {
    renderBudget({
      runtimeContextLimit: 8000,
      totalRequiredTokens: 4000,
      totalInputTokens: 3000,
      outputReserveTokens: 1000,
      toolTokens: 0
    });

    expect(container.textContent).not.toContain("Tool-Definitionen");
  });

  it("sollte die Warnung 'Kein Sicherheitspuffer' anzeigen, wenn kein Puffer bis zum Limit übrig bleibt", () => {
    renderBudget({
      runtimeContextLimit: 4000,
      totalRequiredTokens: 4000,
      totalInputTokens: 3000,
      outputReserveTokens: 1000,
      toolTokens: 0
    });
    expect(container.textContent).toContain("Warnung: Kein Sicherheitspuffer. Die Antwort könnte abgeschnitten werden.");
  });

  it("sollte die Warnung 'Kontextlimit fast erreicht' bei über 90% Auslastung anzeigen", () => {
    renderBudget({
      runtimeContextLimit: 10000,
      totalRequiredTokens: 9100,
      totalInputTokens: 8000,
      outputReserveTokens: 1000,
      toolTokens: 1000
    });
    expect(container.textContent).toContain("Warnung: Kontextlimit fast erreicht.");
  });

  it("sollte die Fehlerwarnung 'Kontextlimit überschritten' anzeigen", () => {
    renderBudget({
      runtimeContextLimit: 8000,
      totalRequiredTokens: 8100,
      totalInputTokens: 7000,
      outputReserveTokens: 1000,
      toolTokens: 1000
    });
    expect(container.textContent).toContain("Fehler: Kontextlimit um 100 Tokens überschritten.");
    // Die andere Warnung sollte nicht angezeigt werden, da der Overflow kritischer ist.
    expect(container.textContent).not.toContain("Warnung: Kontextlimit fast erreicht.");
  });

  it("sollte die Warnung 'Kontextlimit fast erreicht' nicht anzeigen, wenn kein Puffer übrig ist, aber kein Overflow vorliegt", () => {
    renderBudget({
      runtimeContextLimit: 9100,
      totalRequiredTokens: 9100,
      totalInputTokens: 8100,
      outputReserveTokens: 1000,
      toolTokens: 1000
    });
    // Die "fast erreicht"-Warnung erfordert einen Restpuffer > 0, wird also nicht angezeigt.
    expect(container.textContent).not.toContain("Warnung: Kontextlimit fast erreicht.");
    // Stattdessen wird die spezifischere Warnung für den fehlenden Puffer angezeigt.
    expect(container.textContent).toContain("Warnung: Kein Sicherheitspuffer. Die Antwort könnte abgeschnitten werden.");
  });
});
