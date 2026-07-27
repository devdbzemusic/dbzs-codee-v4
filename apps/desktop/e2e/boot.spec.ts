import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const MAIN_ENTRY = path.resolve(__dirname, "../out/main/main.js");

async function waitForWindow(app: ElectronApplication, matcher: (page: Page) => Promise<boolean>): Promise<Page> {
  await expect
    .poll(async () => {
      const pages = app.windows();
      for (const page of pages) {
        if (await matcher(page)) {
          return true;
        }
      }
      return false;
    }, { timeout: 30_000 })
    .toBe(true);

  const pages = app.windows();
  for (const page of pages) {
    if (await matcher(page)) {
      return page;
    }
  }
  throw new Error("Expected window was not found.");
}

async function getBootState(page: Page) {
  return page.evaluate(async () => window.dbzs.getBootState?.());
}

test("bootet mit Splash zuerst, hält das Hauptfenster bis zum Render-Ack verborgen und gibt dann sauber frei", async () => {
  test.slow();
  expect(existsSync(MAIN_ENTRY), `Missing Electron main entry: ${MAIN_ENTRY}. Run the desktop build first.`).toBe(true);

  const electronApp = await electron.launch({ args: [MAIN_ENTRY] });
  try {
    const splashPage = await waitForWindow(
      electronApp,
      async (page) => (page.url().includes("view=splash") || page.url().endsWith("#splash"))
    );
    const mainPage = await waitForWindow(
      electronApp,
      async (page) => !page.url().includes("view=splash") && !page.url().endsWith("#splash")
    );

    await splashPage.waitForLoadState("domcontentloaded");
    await mainPage.waitForLoadState("domcontentloaded");

    const splashWindow = await electronApp.browserWindow(splashPage);
    const mainWindow = await electronApp.browserWindow(mainPage);

    await expect.poll(() => splashWindow.evaluate((window) => window.isVisible())).toBe(true);
    await expect.poll(() => mainWindow.evaluate((window) => window.isVisible())).toBe(false);

    const initialState = await getBootState(mainPage);
    expect(initialState?.status).toBeTruthy();
    expect(initialState?.phases.length).toBeGreaterThanOrEqual(17);

    const finalState = await expect
      .poll(async () => {
        const state = await getBootState(mainPage);
        if (!state) {
          return null;
        }
        if (state.status === "ready" || state.status === "degraded") {
          return state;
        }
        return null;
      }, { timeout: 90_000 })
      .not.toBeNull();

    const readyState = (await getBootState(mainPage))!;
    const renderedPhase = readyState.phases.find((phase) => phase.id === "main-window-rendered");
    const releasedPhase = readyState.phases.find((phase) => phase.id === "main-app-released");

    expect(renderedPhase?.state).toBe("success");
    expect(releasedPhase?.state).toBe("success");
    expect(renderedPhase?.finishedAt).toBeTruthy();
    expect(releasedPhase?.finishedAt).toBeTruthy();
    expect((renderedPhase?.finishedAt ?? 0)).toBeLessThanOrEqual(releasedPhase?.finishedAt ?? 0);

    await expect.poll(() => mainWindow.evaluate((window) => window.isVisible())).toBe(true);
    await expect.poll(() => splashPage.isClosed()).toBe(true);

    await expect(mainPage).toHaveTitle(/DBZS Code Assistant/);
    await expect(mainPage.locator("body")).toContainText(/Desktop/i);
    await expect(mainPage.locator("body")).toContainText(/Backend/i);
  } finally {
    await electronApp.close();
  }
});
