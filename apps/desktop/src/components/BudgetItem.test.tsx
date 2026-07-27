import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetItem } from "./BudgetItem";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("BudgetItem", () => {
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

  it("sollte Label und Wert korrekt rendern", () => {
    act(() => {
      root.render(<BudgetItem label="Test Label" value={1234} />);
    });
    expect(container.textContent).toContain("Test Label");
    expect(container.textContent).toContain("1,234 Tokens");
  });

  it("sollte einen Tooltip rendern, wenn er bereitgestellt wird", () => {
    act(() => {
      root.render(<BudgetItem label="Test Label" value={100} tooltip="Dies ist ein Test-Tooltip" />);
    });
    const labelElement = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "Test Label"
    );
    expect(labelElement?.getAttribute("title")).toBe("Dies ist ein Test-Tooltip");
  });

  it("sollte nichts rendern, wenn der Wert undefiniert ist", () => {
    act(() => {
      root.render(<BudgetItem label="Test Label" value={undefined} />);
    });
    expect(container.firstChild).toBeNull();
  });

  it("sollte eine benutzerdefinierte Einheit verwenden, wenn sie bereitgestellt wird", () => {
    act(() => {
      root.render(<BudgetItem label="Test Label" value={50} unit="ms" />);
    });
    expect(container.textContent).toContain("50 ms");
  });

  it("sollte den Standard-Einheit 'Tokens' verwenden, wenn keine Einheit angegeben ist", () => {
    act(() => {
      root.render(<BudgetItem label="Test Label" value={200} />);
    });
    expect(container.textContent).toContain("200 Tokens");
  });

  it("sollte den Wert korrekt mit Tausendertrennzeichen formatieren", () => {
    act(() => {
      root.render(<BudgetItem label="Großer Wert" value={1234567} />);
    });
    expect(container.textContent).toContain("1,234,567 Tokens");
  });

  it("sollte den Wert 0 korrekt rendern", () => {
    act(() => {
      root.render(<BudgetItem label="Nullwert" value={0} />);
    });
    expect(container.textContent).toContain("0 Tokens");
  });
});
