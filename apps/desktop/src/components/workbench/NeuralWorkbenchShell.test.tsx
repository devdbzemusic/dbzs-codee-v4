import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NeuralWorkbenchShell } from "./NeuralWorkbenchShell";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("NeuralWorkbenchShell", () => {
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

  it("keeps every productive slot in the workbench composition", () => {
    act(() => {
      root.render(
        <NeuralWorkbenchShell
          dock={<span>dock</span>}
          header={<span>header</span>}
          inspector={<span>inspector</span>}
          leftWidth={280}
          primary={<span>primary</span>}
          rail={<span>rail</span>}
          rightWidth={360}
          statusBar={<span>status</span>}
          workspace={<span>workspace</span>}
        />
      );
    });

    expect(container.textContent).toContain("headerrailworkspaceprimaryinspectordockstatus");
  });
});
