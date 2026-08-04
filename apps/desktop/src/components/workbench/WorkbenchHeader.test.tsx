import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchHeader } from "./WorkbenchHeader";

describe("WorkbenchHeader", () => {
  it("renders branding and wires command palette + shell toggle actions", () => {
    const onOpenCommandPalette = vi.fn();
    const onToggleShell = vi.fn();

    render(
      <WorkbenchHeader
        actions={<button type="button">Status</button>}
        commandLabel="Quick Open"
        onOpenCommandPalette={onOpenCommandPalette}
        onToggleShell={onToggleShell}
      />
    );

    expect(screen.getByText("DBZS local-first workbench")).toBeInTheDocument();
    expect(screen.getByText("Codee")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Quick Open/i }));
    fireEvent.click(screen.getByRole("button", { name: "Classic" }));

    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    expect(onToggleShell).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
  });
});
