import { BrowserWindow } from "electron";

export interface WindowCoordinatorDeps {
  preloadPath: string;
  rendererIndexPath: string;
  devRendererUrl?: string;
  configureWindowSecurity: (window: BrowserWindow) => void;
}

/**
 * Owns splash + main window lifecycle so the main window can never be
 * shown before boot actually completes (the bug this whole feature fixes —
 * previously `createWindow()` ran unconditionally and immediately in
 * `app.whenReady()`, before the backend was even spawned).
 *
 * Sequence: splash created + shown first. Main window is created hidden
 * (`show:false`) and starts loading in the background immediately, so its
 * bundle/first paint isn't wasted boot time. `releaseMainWindow()` waits
 * for the main window's own first paint, shows it, and only then closes
 * the splash — never the other way around, so there is no blank/flash
 * transition.
 */
export class WindowCoordinator {
  private splash: BrowserWindow | null = null;
  private main: BrowserWindow | null = null;
  private mainReadyToShow: Promise<void> | null = null;

  constructor(private readonly deps: WindowCoordinatorDeps) {}

  getMainWindow(): BrowserWindow | null {
    return this.main;
  }

  getSplashWindow(): BrowserWindow | null {
    return this.splash;
  }

  getAllWindows(): BrowserWindow[] {
    return [this.splash, this.main].filter((w): w is BrowserWindow => w != null && !w.isDestroyed());
  }

  createSplashWindow(): BrowserWindow {
    const splash = new BrowserWindow({
      width: 560,
      height: 440,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: "#070b10",
      title: "DBZS Code Assistant",
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.deps.configureWindowSecurity(splash);
    splash.once("ready-to-show", () => {
      splash.show();
    });
    this.loadView(splash, "splash");
    this.splash = splash;
    return splash;
  }

  createMainWindowHidden(): BrowserWindow {
    const main = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1120,
      minHeight: 720,
      backgroundColor: "#070b10",
      title: "DBZS Code Assistant",
      show: false,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.deps.configureWindowSecurity(main);
    this.mainReadyToShow = new Promise<void>((resolve) => {
      main.once("ready-to-show", () => resolve());
    });
    this.loadView(main, null);
    this.main = main;
    return main;
  }

  /** Shows the main window (after its first paint) and only then closes
   * the splash. Called once the BootOrchestrator run resolves "ready" or
   * "degraded" (a "failed" run keeps the splash open with the error panel
   * instead — callers must not invoke this on a failed BootState). */
  async releaseMainWindow(): Promise<void> {
    const main = this.main;
    if (!main || main.isDestroyed()) {
      throw new Error("Main window was not created before releaseMainWindow() was called.");
    }
    if (this.mainReadyToShow) {
      await this.mainReadyToShow;
    }
    main.show();
    main.focus();

    if (this.splash && !this.splash.isDestroyed()) {
      this.splash.close();
    }
    this.splash = null;
  }

  private loadView(window: BrowserWindow, view: "splash" | null): void {
    if (this.deps.devRendererUrl) {
      const base = this.deps.devRendererUrl.split("#")[0]?.split("?")[0] ?? this.deps.devRendererUrl;
      const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
      const url = view ? `${normalizedBase}/?view=${view}#${view}` : `${normalizedBase}/`;
      void window.loadURL(url);
      return;
    }

    if (view) {
      void window.loadFile(this.deps.rendererIndexPath, { query: { view }, hash: view });
    } else {
      void window.loadFile(this.deps.rendererIndexPath);
    }
  }
}
