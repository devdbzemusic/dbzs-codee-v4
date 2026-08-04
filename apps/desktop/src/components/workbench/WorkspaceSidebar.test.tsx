import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

describe("WorkspaceSidebar", () => {
  it("renders its content, title and resize affordance when open", () => {
    const onCollapse = vi.fn();
    const onResizeStart = vi.fn();
    render(
      <WorkspaceSidebar
        onCollapse={onCollapse}
        onResizeStart={onResizeStart}
        open
        title="Explorer"
        width={320}
      >
        <div>Sidebar Inhalt</div>
      </WorkspaceSidebar>
    );

    expect(screen.getByLabelText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("Sidebar Inhalt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Explorer einklappen|Panel einklappen|Explorer schließen/i }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Linke Leiste verbreitern" }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    const { container } = render(
      <WorkspaceSidebar
        onCollapse={vi.fn()}
        onResizeStart={vi.fn()}
        open={false}
        width={320}
      >
        <div>Hidden</div>
      </WorkspaceSidebar>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
