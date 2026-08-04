import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomDock } from "./BottomDock";

describe("BottomDock", () => {
  it("renders dock tabs, badge counts and forwards interactions", () => {
    const onTabChange = vi.fn();
    const onCollapse = vi.fn();
    const onResizeStart = vi.fn();

    render(
      <BottomDock
        activeTab="terminal"
        badges={{ jobs: 2, tests: 150 }}
        height={240}
        onCollapse={onCollapse}
        onResizeStart={onResizeStart}
        onTabChange={onTabChange}
        open
      >
        <div>Terminal Ausgabe</div>
      </BottomDock>
    );

    expect(screen.getByLabelText("Bottom Dock")).toBeInTheDocument();
    expect(screen.getByText("Terminal Ausgabe")).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Jobs/i }));
    fireEvent.click(screen.getByRole("button", { name: "Dock einklappen" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Dock-Höhe anpassen" }));

    expect(onTabChange).toHaveBeenCalledWith("jobs");
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it("returns null when closed", () => {
    const { container } = render(
      <BottomDock
        activeTab="terminal"
        height={240}
        onCollapse={vi.fn()}
        onResizeStart={vi.fn()}
        onTabChange={vi.fn()}
        open={false}
      >
        <div>Hidden</div>
      </BottomDock>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
