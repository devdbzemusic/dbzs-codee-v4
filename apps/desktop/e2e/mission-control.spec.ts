import { test, expect } from "@playwright/test";
import { installTestBridge } from "./helpers/test-bridge";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page, { workspace: false });
});

test("Mission Control ist sichtbar wenn kein Workspace gesetzt", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Mission Control", exact: true }).click();
  await expect(page.getByText("DBZS Codee Mission Control")).toBeVisible({ timeout: 10_000 });
});

test("Backend-Statuskarte zeigt Status an", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Backend:", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("Desktop-Bereitschaft ist sichtbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Desktop: bereit", { exact: true })).toBeVisible({ timeout: 10_000 });
});
