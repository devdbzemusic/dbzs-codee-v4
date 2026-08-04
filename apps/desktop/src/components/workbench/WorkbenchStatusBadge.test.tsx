import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkbenchStatusBadge } from "./WorkbenchStatusBadge";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("WorkbenchStatusBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the mapped semantic status tone", () => {
    act(() => {
      root.render(<WorkbenchStatusBadge label="Runtime" tone="warning" value="Modelle bereit" />);
    });

    expect(container.textContent).toContain("Runtime: Modelle bereit");
    expect(container.firstElementChild?.className).toContain("dbzs-workbench__badge--warning");
  });

  it("uses the running tone class for active runtime state", () => {
    act(() => {
      root.render(<WorkbenchStatusBadge label="Runtime" tone="running" value="llama aktiv" />);
    });

    expect(container.firstElementChild?.className).toContain("dbzs-workbench__badge--running");
  });
});
