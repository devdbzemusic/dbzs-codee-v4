import { expect, test, type Page } from "@playwright/test";
import type { FixtureFileRecord } from "../e2e/helpers/fixture-workspace";
import { loadFixtureRecords } from "../e2e/helpers/fixture-workspace";
import { gotoApp, installRealcheckBridge, openNotebookTab, runtimeComposer } from "./helpers/realcheck-bridge";

const fixture = loadFixtureRecords();
const viewports = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 }
] as const;

function withLongTree(): FixtureFileRecord[] {
  const records = [...fixture.files];
  for (let index = 0; index < 24; index += 1) {
    records.push({
      relativePath: `src/feature-${index.toString().padStart(2, "0")}/component-${index.toString().padStart(2, "0")}.ts`,
      content: `export const value${index} = ${index};`,
      language: "typescript"
    });
  }
  return records;
}

async function expectScreenshot(page: Page, state: string, viewport: string) {
  await expect(page).toHaveScreenshot(`${state}-${viewport}.png`, {
    fullPage: true,
    animations: "disabled"
  });
}

test.describe("Phase 16 Realitätscheck – visuelle Regression", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} Neural Shell`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page);
      await gotoApp(page);
      await expectScreenshot(page, "neural-shell", viewport.name);
    });

    test(`${viewport.name} Classic Shell`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page);
      await gotoApp(page);
      await page.getByRole("button", { name: "Classic" }).click();
      await expectScreenshot(page, "classic-shell", viewport.name);
    });

    test(`${viewport.name} Loading`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page, { scanDelayMs: 4_000 });
      await page.goto("/");
      await expect(page.getByText(/Scanne Projekt/i)).toBeVisible();
      await expectScreenshot(page, "loading", viewport.name);
    });

    test(`${viewport.name} Empty`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page, { initialWorkspaceFiles: [] });
      await gotoApp(page);
      await expect(page.getByText(/Workspace offen, Dateibaum leer/i)).toBeVisible();
      await expectScreenshot(page, "empty", viewport.name);
    });

    test(`${viewport.name} Error`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page, { runtimeState: "error" });
      await gotoApp(page);
      await openNotebookTab(page, "Runtime");
      await expect(page.getByText(/Runtime konnte llama-server nicht starten/i)).toBeVisible();
      await expectScreenshot(page, "error", viewport.name);
    });

    test(`${viewport.name} Degraded`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page, { bootState: "degraded" });
      await gotoApp(page);
      await openNotebookTab(page, "Mission Control");
      await expect(page.getByText(/Backend: beeinträchtigt/i)).toBeVisible();
      await expectScreenshot(page, "degraded", viewport.name);
    });

    test(`${viewport.name} Running`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page, { runtimeState: "running" });
      await gotoApp(page);
      await openNotebookTab(page, "Runtime");
      await expectScreenshot(page, "running", viewport.name);
    });

    test(`${viewport.name} Modal-Dialog`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page);
      await gotoApp(page);
      await page.keyboard.press("Control+K");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectScreenshot(page, "modal-dialog", viewport.name);
    });

    test(`${viewport.name} Long File Tree`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page, { initialWorkspaceFiles: withLongTree() });
      await gotoApp(page);
      await expectScreenshot(page, "long-file-tree", viewport.name);
    });

    test(`${viewport.name} Long Chat`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRealcheckBridge(page);
      await gotoApp(page);
      for (let index = 1; index <= 6; index += 1) {
        await runtimeComposer(page).fill(`Nachricht ${index}`);
        await page.getByRole("button", { name: "Senden" }).click();
        await expect(page.getByText(`Mock-Antwort: Nachricht ${index}`)).toBeVisible();
      }
      await expectScreenshot(page, "long-chat", viewport.name);
    });
  }
});
