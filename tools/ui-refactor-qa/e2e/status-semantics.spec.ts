import { test, expect } from "@playwright/test";
import { installTestBridge } from "../helpers/test-bridge";

const phase = process.env.DBZS_UI_QA_PHASE || "baseline";

test.beforeEach(async ({ page }) => {
  await installTestBridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DBZS Code Assistant" })).toBeVisible({ timeout: 15_000 });
});

test("Timeout wird nicht als Erfolg dargestellt", async ({ page }) => {
  test.skip(phase === "baseline", "Erfordert migrierte Workflow-Statusdarstellung.");

  const timeoutRows = page.locator(
    '[data-status="timed_out"], [data-outcome="timed_out"], [data-status="timeout"]'
  );

  const count = await timeoutRows.count();
  for (let i = 0; i < count; i += 1) {
    const row = timeoutRows.nth(i);
    await expect(row).not.toHaveAttribute("data-tone", "success");
    await expect(row).not.toHaveClass(/success|completed|green/i);
  }
});

test("Failed und Partial sind als eigene Zustände zulässig", async ({ page }) => {
  test.skip(phase === "baseline", "Erfordert migrierte Workflow-Statusdarstellung.");

  const statuses = await page.locator("[data-status]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-status"))
  );
  const allowed = new Set([
    "queued", "routing", "loading_context", "starting_model", "running",
    "waiting_for_tool", "waiting_for_approval", "completed", "partial",
    "failed", "timed_out", "cancelled"
  ]);
  for (const status of statuses) {
    if (status) expect(allowed.has(status), `Unbekannter Status ${status}`).toBeTruthy();
  }
});
