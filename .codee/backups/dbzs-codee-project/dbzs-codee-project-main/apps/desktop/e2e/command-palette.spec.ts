import { test, expect } from "@playwright/test";
import { installTestBridge } from "./helpers/test-bridge";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
});

async function openPalette(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Control+k");
}

test("Cmd+K öffnet die Befehlspalette", async ({ page }) => {
  await openPalette(page);
  await expect(page.getByRole("dialog", { name: "Befehlspalette" })).toBeVisible({ timeout: 5_000 });
});

test("Escape schließt die Befehlspalette", async ({ page }) => {
  await openPalette(page);
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  const input = dialog.getByPlaceholder(/Suchen/i);
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.focus();
  await input.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 3_000 });
});

test("Tippen filtert Ergebnisse in der Palette", async ({ page }) => {
  await openPalette(page);
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  const input = dialog.getByPlaceholder(/Suchen/i);
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("backend");
  await expect(dialog.getByText(/Backend neu laden/i)).toBeVisible({ timeout: 3_000 });
});
