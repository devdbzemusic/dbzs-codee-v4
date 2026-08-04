import { test, expect } from "@playwright/test";
import { installTestBridge } from "../helpers/test-bridge";

const phase = process.env.DBZS_UI_QA_PHASE || "baseline";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible({ timeout: 15_000 });
});

test("Panel-Collapse bleibt nach Reload erhalten", async ({ page }) => {
  test.skip(phase !== "final", "Layout-Persistenz ist ein Final-Gate.");

  const toggle = page.getByTestId("toggle-inspector");
  await expect(toggle).toBeVisible();

  const before = await page.getByTestId("inspector-sidebar").getAttribute("data-collapsed");
  await toggle.click();
  const changed = await page.getByTestId("inspector-sidebar").getAttribute("data-collapsed");
  expect(changed).not.toBe(before);

  await page.reload();
  await expect(page.getByTestId("inspector-sidebar")).toHaveAttribute("data-collapsed", changed || "true");
});
