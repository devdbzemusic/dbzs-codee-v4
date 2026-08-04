import { test, expect } from "@playwright/test";
import { installTestBridge } from "../helpers/test-bridge";

const phase = process.env.DBZS_UI_QA_PHASE || "baseline";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible({ timeout: 15_000 });
});

test("App bootet mit produktiver Test-Bridge", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible();
});

test("Neural Workbench Contract", async ({ page }) => {
  test.skip(phase === "baseline", "Neural Shell ist in der Baseline noch optional.");

  for (const id of [
    "dbzs-workbench",
    "workbench-header",
    "activity-rail",
    "workspace-sidebar",
    "primary-workspace",
    "inspector-sidebar",
    "bottom-dock",
    "workbench-statusbar"
  ]) {
    await expect(page.getByTestId(id), `${id} fehlt`).toBeVisible();
  }
});

test("Kernpanels kollabieren nicht auf 0 Pixel", async ({ page }) => {
  test.skip(phase === "baseline", "Gilt für die Neural Shell.");

  for (const id of ["workspace-sidebar", "primary-workspace", "inspector-sidebar", "bottom-dock"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} ohne Bounding Box`).not.toBeNull();
    expect(box!.width, `${id} Breite`).toBeGreaterThan(8);
    expect(box!.height, `${id} Höhe`).toBeGreaterThan(8);
  }
});

for (const viewport of [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 }
]) {
  test(`Layout ${viewport.name}`, async ({ page }) => {
    test.skip(phase === "baseline", "Visuelles Neural-Shell-Gate ist in Baseline optional.");
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    await expect(page.getByTestId("dbzs-workbench")).toBeVisible();
    await expect(page.getByTestId("primary-workspace")).toBeInViewport();
    await page.screenshot({
      path: `artifacts/ui-refactor-qa/screenshots/workbench-${viewport.name}.png`,
      fullPage: true
    });
  });
}
