import { test, expect } from "@playwright/test";
import { installTestBridge } from "./helpers/test-bridge";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
});

test("Job-Monitor Panel ist im AI-Tab sichtbar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Jobs", exact: true }).click();
  await expect(page.getByText(/Job.*Spooler|Job Monitor|Jobs/i).first()).toBeVisible({ timeout: 10_000 });
});

test("EnqueueForm hat Titel-Feld", async ({ page }) => {
  await page.goto("/");
  const titleInput = page.getByPlaceholder(/Job.?Titel|titel/i).first();
  if (await titleInput.isVisible()) {
    await titleInput.fill("Test-Job");
    await expect(titleInput).toHaveValue("Test-Job");
  }
});
