import { expect, test } from "@playwright/test";
import {
  getRealcheckHooks,
  gotoApp,
  installRealcheckBridge,
  openNotebookTab,
  runtimeComposer,
  sendChat,
  workspaceTree
} from "./helpers/realcheck-bridge";

test.describe("Phase 16 Realitätscheck – E2E", () => {
  test("1 App Boot (Renderer) zeigt Shell und Status", async ({ page }) => {
    await installRealcheckBridge(page, { bootState: "ready" });
    await gotoApp(page);
    await expect(page).toHaveTitle(/DBZS Code Assistant/i);
    await expect(page.getByText(/Desktop:/i).first()).toBeVisible();
    await expect(page.getByText(/Backend:/i).first()).toBeVisible();
  });

  test("2 Workspace öffnen lädt den Fixture-Workspace", async ({ page }) => {
    await installRealcheckBridge(page, { initialWorkspaceVisible: false });
    await gotoApp(page);
    await page.getByRole("button", { name: /^Öffnen$/ }).first().click();
    await expect(page.getByText("coding-assistant-workspace").first()).toBeVisible();
    expect((await getRealcheckHooks(page)).selectedWorkspaceCount).toBe(1);
  });

  test("3 Datei öffnen legt einen Editor-Tab an", async ({ page }) => {
    await installRealcheckBridge(page);
    await gotoApp(page);
    await workspaceTree(page).getByText("calculator.ts", { exact: true }).click();
    await openNotebookTab(page, "Editor");
    await expect(page.getByText("calculator.ts", { exact: true }).first()).toBeVisible();
    expect((await getRealcheckHooks(page)).openedFiles).toContain("src/calculator.ts");
  });

  test("4 Chat senden liefert eine echte Renderer-Antwort", async ({ page }) => {
    await installRealcheckBridge(page);
    await gotoApp(page);
    await sendChat(page, "Bitte erkläre den subtract-Bug");
    await expect(page.getByText(/Mock-Antwort: Bitte erkläre den subtract-Bug/i)).toBeVisible();
  });

  test("5 Chat stoppen bricht einen Stream real ab", async ({ page }) => {
    await installRealcheckBridge(page, { chatMode: "slow-stream" });
    await gotoApp(page);
    await openNotebookTab(page, "C@dee");
    await runtimeComposer(page).fill("Langer Stream bitte");
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(page.getByRole("button", { name: "Stopp" })).toBeVisible();
    await page.getByRole("button", { name: "Stopp" }).click();
    await expect(page.getByText(/Vorgang abgebrochen/i)).toBeVisible();
    expect((await getRealcheckHooks(page)).cancelCalls).toBe(1);
  });

  test("6 Modell starten startet die Runtime aus dem Runtime-Tab", async ({ page }) => {
    await installRealcheckBridge(page, { runtimeState: "stopped" });
    await gotoApp(page);
    await openNotebookTab(page, "Runtime");
    await page.getByRole("button", { name: /Starten/i }).first().click();
    await expect(page.getByRole("button", { name: /Runtime stoppen/i })).toBeVisible();
    await expect(page.getByText(/läuft: Coder Test/i)).toBeVisible();
  });

  test("7 Runtime-Fehler anzeigen rendert die Fehlermeldung sichtbar", async ({ page }) => {
    await installRealcheckBridge(page, { runtimeState: "error" });
    await gotoApp(page);
    await openNotebookTab(page, "Runtime");
    await expect(page.getByText(/Runtime konnte llama-server nicht starten/i)).toBeVisible();
  });

  test("8 Patch prüfen zeigt ein echtes Review-Panel", async ({ page }) => {
    await installRealcheckBridge(page, { chatMode: "patch" });
    await gotoApp(page);
    await sendChat(page, "Bitte prüf den Patch für subtract");
    await expect(page.getByText("Patch Review")).toBeVisible();
    await expect(page.getByRole("button", { name: "Übernehmen" })).toBeVisible();
  });

  test("9 Patch übernehmen wendet die Änderung an", async ({ page }) => {
    await installRealcheckBridge(page, { chatMode: "patch" });
    await gotoApp(page);
    await sendChat(page, "Bitte prüf den Patch für subtract");
    await page.getByRole("button", { name: "Übernehmen" }).click();
    await expect(page.getByText(/Änderung angewendet/i)).toBeVisible();
    expect((await getRealcheckHooks(page)).appliedPatches.length).toBe(1);
  });

  test("10 Rollback setzt den angewendeten Patch zurück", async ({ page }) => {
    await installRealcheckBridge(page, { chatMode: "patch" });
    await gotoApp(page);
    await sendChat(page, "Bitte prüf den Patch für subtract");
    await page.getByRole("button", { name: "Übernehmen" }).click();
    await page.getByRole("button", { name: "Zurücksetzen" }).click();
    await expect(page.getByText(/vollständig zurückgerollt/i)).toBeVisible();
    expect((await getRealcheckHooks(page)).rolledBackPatches.length).toBe(1);
  });

  test("11 Model-Lab-Scan erzeugt einen echten Scan-Job im Renderer", async ({ page }) => {
    await installRealcheckBridge(page);
    await gotoApp(page);
    await openNotebookTab(page, "Model Lab");
    await page.getByRole("button", { name: "Alle Quellen scannen" }).click();
    await expect(page.getByText(/Scan abgeschlossen/i)).toBeVisible();
    expect((await getRealcheckHooks(page)).modelLabScans).toBe(1);
  });

  test("13 Settings ändern persistiert per Bridge-Patch", async ({ page }) => {
    await installRealcheckBridge(page);
    await gotoApp(page);
    await page.getByRole("button", { name: /^Model$/ }).click();
    await page.getByLabel("Theme").selectOption("light");
    await expect(page.getByText(/1 Änderung vorgemerkt/i)).toBeVisible();
    await page.getByRole("button", { name: /Änderungen anwenden/i }).click();
    await page.reload();
    await page.getByRole("button", { name: /^Model$/ }).click();
    await expect(page.getByLabel("Theme")).toHaveValue("light");
  });

  test("14/15 Layout-Preset wechseln und nach Reload wiederherstellen", async ({ page }) => {
    await installRealcheckBridge(page);
    await gotoApp(page);
    await page.getByRole("button", { name: /Fokus wechseln/i }).click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("dbzs-workbench-layout-v2") ?? ""))
      .toContain("\"activePresetId\":\"chat-focus\"");
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("dbzs-workbench-layout-v2") ?? ""))
      .toContain("\"activePresetId\":\"chat-focus\"");
  });
});
