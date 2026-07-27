import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { promptTextInput } from "./promptInput";

type IpcHandler = (event: unknown, value: string | null) => void;

const { instances, MockBrowserWindow } = vi.hoisted(() => {
  class MockBrowserWindow {
    destroyed = false;
    handlers = new Map<string, () => void>();

    isDestroyed(): boolean {
      return this.destroyed;
    }

    once(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }

    loadURL = vi.fn(async () => {
      this.handlers.get("ready-to-show")?.();
    });

    show = vi.fn();
    focus = vi.fn();

    close = vi.fn(() => {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      this.handlers.get("closed")?.();
    });
  }

  const instances: InstanceType<typeof MockBrowserWindow>[] = [];
  return { instances, MockBrowserWindow };
});

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(function (this: unknown) {
    const instance = new MockBrowserWindow();
    instances.push(instance);
    return instance;
  }),
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));

function latestWindow(): InstanceType<typeof MockBrowserWindow> {
  return instances[instances.length - 1];
}

function latestHandler(): IpcHandler {
  const calls = vi.mocked(ipcMain.on).mock.calls;
  return calls[calls.length - 1][1] as IpcHandler;
}

describe("promptTextInput", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.mocked(ipcMain.on).mockClear();
    vi.mocked(ipcMain.removeListener).mockClear();
  });

  it("resolves with the entered value when confirmed", async () => {
    const promise = promptTextInput({ title: "Neue Datei", label: "Relativer Pfad", value: "neu.txt" });
    await Promise.resolve();
    await Promise.resolve();

    latestHandler()({}, "src/neue-datei.ts");

    await expect(promise).resolves.toBe("src/neue-datei.ts");
    expect(latestWindow().close).toHaveBeenCalled();
    expect(ipcMain.removeListener).toHaveBeenCalled();
  });

  it("resolves with null when the submitted value is blank", async () => {
    const promise = promptTextInput({ title: "Neue Datei", label: "Relativer Pfad", value: "neu.txt" });
    await Promise.resolve();
    await Promise.resolve();

    latestHandler()({}, "   ");

    await expect(promise).resolves.toBeNull();
  });

  it("resolves with null when the window is closed without a submission", async () => {
    const promise = promptTextInput({ title: "Neue Datei", label: "Relativer Pfad", value: "neu.txt" });
    await Promise.resolve();
    await Promise.resolve();

    latestWindow().close();

    await expect(promise).resolves.toBeNull();
  });

  it("only settles once when both a submission and a close event occur", async () => {
    const promise = promptTextInput({ title: "Neue Datei", label: "Relativer Pfad", value: "neu.txt" });
    await Promise.resolve();
    await Promise.resolve();

    latestHandler()({}, "src/neue-datei.ts");
    latestWindow().close();

    await expect(promise).resolves.toBe("src/neue-datei.ts");
  });
});
