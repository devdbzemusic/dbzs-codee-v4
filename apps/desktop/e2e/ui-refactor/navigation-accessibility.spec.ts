import { test, expect } from "@playwright/test";
import { installTestBridge } from "../helpers/test-bridge";

const phase = process.env.DBZS_UI_QA_PHASE || "baseline";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible({ timeout: 15_000 });
});

test("Command Palette bleibt erreichbar", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Befehlspalette" })).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Befehlspalette" })).not.toBeVisible();
});

test("Activity Rail ist per Tastatur erreichbar", async ({ page }) => {
  test.skip(phase === "baseline", "Activity Rail ist Teil der Neural Shell.");
  const rail = page.getByTestId("activity-rail");
  await expect(rail).toBeVisible();

  const controls = rail.getByRole("button");
  expect(await controls.count()).toBeGreaterThan(0);

  await controls.first().focus();
  await expect(controls.first()).toBeFocused();
});

test("Statusinformationen enthalten Text", async ({ page }) => {
  test.skip(phase === "baseline", "Statusbar ist Teil der Neural Shell.");
  const status = page.getByTestId("workbench-statusbar");
  await expect(status).toBeVisible();
  const text = (await status.innerText()).trim();
  expect(text.length).toBeGreaterThan(2);
});

test("Interaktive Controls haben zugängliche Namen", async ({ page }) => {
  test.skip(phase === "baseline", "Neural-Shell-A11y-Gate.");

  const unnamed = await page.locator("button, [role=button], input, select, textarea").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const html = element as HTMLElement;
        const label = html.getAttribute("aria-label")
          || html.getAttribute("aria-labelledby")
          || html.getAttribute("title")
          || html.textContent?.trim()
          || (html as HTMLInputElement).placeholder;
        return !label;
      })
      .map((element) => element.outerHTML.slice(0, 220))
  );

  expect(unnamed).toEqual([]);
});
