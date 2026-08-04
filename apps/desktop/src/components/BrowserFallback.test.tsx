import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserFallback } from "./BrowserFallback";

declare global {
   
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("BrowserFallback", () => {
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

  it("renders Electron startup guidance without window.dbzs", () => {
    act(() => {
      root.render(<BrowserFallback />);
    });

    expect(container.textContent).toContain("Browser-Modus");
    expect(container.textContent).toContain("pnpm dev");
    expect(container.textContent).toContain("keine Electron-Bridge");
  });
});
