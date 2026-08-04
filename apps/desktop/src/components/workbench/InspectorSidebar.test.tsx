import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorSidebar } from "./InspectorSidebar";

describe("InspectorSidebar", () => {
  it("renders inspector tabs and forwards selection/collapse events", () => {
    const onTabChange = vi.fn();
    const onCollapse = vi.fn();
    const onResizeStart = vi.fn();

    render(
      <InspectorSidebar
        activeTab="agents"
        onCollapse={onCollapse}
        onResizeStart={onResizeStart}
        onTabChange={onTabChange}
        open
        width={320}
      >
        <div>Inspector Inhalt</div>
      </InspectorSidebar>
    );

    expect(screen.getByLabelText("Inspector")).toBeInTheDocument();
    expect(screen.getByText("Inspector Inhalt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Runtime" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspector einklappen" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Inspector verbreitern" }));

    expect(onTabChange).toHaveBeenCalledWith("runtime");
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });
});
