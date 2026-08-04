import { test, expect } from "@playwright/test";
import { installTestBridge } from "../helpers/test-bridge";

const phase = process.env.DBZS_UI_QA_PHASE || "baseline";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible({ timeout: 15_000 });
});

test("Workbench erzeugt keinen horizontalen Body-Overflow", async ({ page }) => {
  test.skip(phase === "baseline", "Gilt für die Neural Shell.");

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  expect(overflow.body).toBeLessThanOrEqual(2);
  expect(overflow.html).toBeLessThanOrEqual(2);
});

test("Kernbereiche besitzen kontrollierte Scroll-Container", async ({ page }) => {
  test.skip(phase !== "final", "Scroll-Ownership ist ein Final-Gate.");

  for (const id of ["workspace-sidebar", "primary-workspace", "inspector-sidebar", "bottom-dock"]) {
    const data = await page.getByTestId(id).evaluate((node) => {
      const style = getComputedStyle(node);
      return { overflowX: style.overflowX, overflowY: style.overflowY };
    });
    expect(["auto", "scroll", "hidden", "clip"]).toContain(data.overflowY);
  }
});
