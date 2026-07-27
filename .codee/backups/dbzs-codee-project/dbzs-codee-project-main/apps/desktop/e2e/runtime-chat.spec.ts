import { test, expect } from "@playwright/test";
import { installTestBridge, openRuntimeChatPanel, runtimeChatScope } from "./helpers/test-bridge";
import { loadFixtureRecords } from "./helpers/fixture-workspace";

const fixture = loadFixtureRecords();

test.describe("Runtime Chat E2E", () => {
  test.beforeEach(async ({ page }) => {
    await installTestBridge(page);
  });

  test("Runtime Chat ist mit Test-Workspace sichtbar", async ({ page }) => {
    await openRuntimeChatPanel(page);
    const chat = runtimeChatScope(page);
    await expect(chat.getByPlaceholder(/Analysiere, plane oder implementiere/i)).toBeVisible();
    await expect(page.getByText(fixture.name).first()).toBeVisible({ timeout: 15_000 });
  });

  test("Composer ist aktiv wenn Runtime laeuft", async ({ page }) => {
    await openRuntimeChatPanel(page);
    const composer = runtimeChatScope(page).getByPlaceholder(/Analysiere, plane oder implementiere/i);
    await expect(composer).toBeEnabled();
    await composer.fill("Erklaere den subtract-Bug");
    await runtimeChatScope(page).getByRole("button", { name: "Senden" }).click();
    await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/subtract-Bug|subtrahieren/i).first()).toBeVisible();
  });

  test("Freitext-Antwort erzeugt keinen Patch-Fehler", async ({ page }) => {
    await openRuntimeChatPanel(page);
    const chat = runtimeChatScope(page);
    await chat.getByPlaceholder(/Analysiere, plane oder implementiere/i).fill("Was ist in calculator.ts?");
    await chat.getByRole("button", { name: "Senden" }).click();
    await expect(page.getByText(/Patch-Vorschlag konnte nicht angewendet werden/i)).toHaveCount(0, {
      timeout: 10_000
    });
  });

  test("Agent-Modus umschalten und senden", async ({ page }) => {
    await openRuntimeChatPanel(page);
    const chat = runtimeChatScope(page);
    await chat.getByRole("button", { name: "Agent", exact: true }).click();
    await chat.getByPlaceholder(/Analysiere, plane oder implementiere/i).fill("Implementiere multiply");
    await chat.getByRole("button", { name: "Senden" }).click();
    await expect(chat.getByText("Du").first()).toBeVisible();
    await expect(page.getByText("Assistant").first()).toBeVisible({ timeout: 15_000 });
  });

  test("Preset Plan sendet Anfrage", async ({ page }) => {
    await openRuntimeChatPanel(page);
    const chat = runtimeChatScope(page);
    await chat.locator("div.border-b.border-dbzs-border button", { hasText: "Plan" }).first().click();
    await expect(chat.getByText("Du").first()).toBeVisible({ timeout: 15_000 });
  });

  test("Freitext erzeugt keine ungeprüfte Umsetzen-Aktion", async ({ page }) => {
    await openRuntimeChatPanel(page);
    const chat = runtimeChatScope(page);
    await chat.getByPlaceholder(/Analysiere, plane oder implementiere/i).fill("Schlage einen Fix vor");
    await chat.getByRole("button", { name: "Senden" }).click();
    await expect(chat.getByText(/subtract-Bug|subtrahieren/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(chat.getByRole("button", { name: "Umsetzen" })).toHaveCount(0);
  });
});
