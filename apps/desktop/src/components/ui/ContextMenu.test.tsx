import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  it("renders items and closes after an action", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onClose = vi.fn();
    const action = vi.fn();

    act(() => {
      root.render(
        <ContextMenu
          items={[
            { label: "Open", action },
            { label: "Close", action: onClose }
          ]}
          onClose={onClose}
          x={24}
          y={32}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toContain("Open");

    act(() => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the first item and closes on escape", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onClose = vi.fn();

    act(() => {
      root.render(
        <ContextMenu
          items={[
            { label: "Open", action: vi.fn() },
            { label: "Rename", action: vi.fn() }
          ]}
          onClose={onClose}
          x={24}
          y={32}
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const firstButton = container.querySelector("button");
    expect(firstButton).toHaveFocus();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
