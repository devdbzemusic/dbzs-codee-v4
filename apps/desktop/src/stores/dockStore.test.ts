import { beforeEach, describe, expect, it, vi } from "vitest";

describe("dockStore persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("hydrates the persisted tab and maximized flag", async () => {
    window.localStorage.setItem("dbzs-bottom-dock-tab", "git");
    window.localStorage.setItem("dbzs-bottom-dock-maximized", "1");

    const { useDockStore } = await import("./dockStore");

    expect(useDockStore.getState().activeTab).toBe("git");
    expect(useDockStore.getState().maximized).toBe(true);
  });

  it("falls back for invalid persisted values", async () => {
    window.localStorage.setItem("dbzs-bottom-dock-tab", "broken");
    window.localStorage.setItem("dbzs-bottom-dock-maximized", "0");

    const { useDockStore } = await import("./dockStore");

    expect(useDockStore.getState().activeTab).toBe("terminal");
    expect(useDockStore.getState().maximized).toBe(false);
  });

  it("writes tab and maximize changes back to localStorage", async () => {
    const { useDockStore } = await import("./dockStore");

    useDockStore.getState().setActiveTab("output");
    useDockStore.getState().toggleMaximized();

    expect(window.localStorage.getItem("dbzs-bottom-dock-tab")).toBe("output");
    expect(window.localStorage.getItem("dbzs-bottom-dock-maximized")).toBe("1");
  });
});
