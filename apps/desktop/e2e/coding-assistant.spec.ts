import { test, expect } from "@playwright/test";
import { loadFixtureRecords } from "./helpers/fixture-workspace";
import { installTestBridge, openRuntimeChatPanel, runtimeChatComposer, runtimeChatScope } from "./helpers/test-bridge";

const fixture = loadFixtureRecords();

function patchJson(relativePath: string, proposedContent: string): string {
  return JSON.stringify({
    changes: [{ filePath: relativePath, proposedContent, reason: "E2E patch test" }]
  });
}

const fixedCalculator = `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}
`;

test.describe("Coding Assistant Use Cases (E2E)", () => {
  test("Use Case: Bug erklaeren (Freitext)", async ({ page }) => {
    await installTestBridge(page, {
      chatResponse: "In subtract wird faelschlich addiert. Erwartet: return a - b;"
    });
    await openRuntimeChatPanel(page);
    await runtimeChatComposer(page).fill("Erklaere den Bug in src/calculator.ts");
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(
      page.getByText("In subtract wird faelschlich addiert. Erwartet: return a - b;", { exact: true })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Use Case: Patch-JSON Antwort (via Mock)", async ({ page }) => {
    await installTestBridge(page, {
      chatResponse: patchJson("src/calculator.ts", fixedCalculator)
    });
    await openRuntimeChatPanel(page);
    const chat = runtimeChatScope(page);
    await chat.getByRole("button", { name: "Agent", exact: true }).click();
    await runtimeChatComposer(page).fill("Fix subtract bug");
    await chat.getByRole("button", { name: "Senden" }).click();
    await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Patch-Vorschlag konnte nicht angewendet werden/i)).toHaveCount(0);
  });

  test("Use Case: Job Monitor erreichbar", async ({ page }) => {
    await installTestBridge(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Jobs" }).click();
    await expect(page.getByText(/Job.*Spooler|Job Monitor/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("Use Case: Workspace-Dateien im Kontext-Chip", async ({ page }) => {
    await installTestBridge(page);
    await openRuntimeChatPanel(page);
    await expect(page.getByText(fixture.name).first()).toBeVisible();
    await expect(page.getByText(/calculator\.ts|keine Datei/i).first()).toBeVisible();
  });

  test("Use Case: Runtime offline — Composer deaktiviert", async ({ page }) => {
    await installTestBridge(page);
    await page.addInitScript(() => {
      const bridge = window.dbzs;
      if (!bridge) return;
      const stopped = { state: "stopped", message: "Runtime stopped.", provider: null, model_id: null, model_name: null, port: null, pid: null, endpoint: null };
      bridge.getRuntimeStatus = async () => stopped;
    });
    await openRuntimeChatPanel(page);
    await expect(runtimeChatComposer(page)).toBeDisabled();
  });
});
