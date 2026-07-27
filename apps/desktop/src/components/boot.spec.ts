import { test, expect, _electron as electron } from "@playwright/test";

/**
 * E2E-Test für den vollständigen 17-Phasen-Boot-Prozess.
 *
 * Dieser Test stellt sicher, dass die Anwendung korrekt startet, alle
 * Phasen des Boot-Orchestrators durchläuft und am Ende einen
 * stabilen, betriebsbereiten Zustand erreicht.
 *
 * VORAUSSETZUNGEN:
 * - Playwright ist im Projekt installiert (`pnpm add -D @playwright/test`).
 * - Die Playwright-Konfiguration (`playwright.config.ts`) ist für Electron eingerichtet.
 * - Die Anwendung wurde zuvor gebaut (`pnpm build`).
 *
 * AUSFÜHRUNG (Beispiel):
 * `pnpm playwright test e2e/boot.spec.ts`
 */
test("sollte den 17-Phasen-Boot erfolgreich durchlaufen und den 'ready'-Status erreichen", async () => {
  // 1. Starte die Electron-Anwendung.
  // Der Pfad zur main.js muss an das Build-Verzeichnis angepasst werden.
  const electronApp = await electron.launch({ args: ["dist-electron/main.js"] });

  // 2. Warte, bis das Hauptfenster der Anwendung erscheint.
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // 3. Überprüfe den Titel des Fensters, um sicherzustellen, dass die richtige App geladen wurde.
  await expect(window).toHaveTitle(/DBZS Codee/);

  // 4. Warte auf die finale Statusmeldung im UI.
  // Der Boot-Prozess kann einige Sekunden dauern. Wir warten auf den finalen
  // "Backend: online"-Status, der anzeigt, dass alle 17 Phasen abgeschlossen sind.
  // Der Selektor muss ggf. an die exakte DOM-Struktur angepasst werden.
  const statusLabel = window.locator("div:has-text('Backend:')");

  // Wir geben dem Boot-Prozess bis zu 30 Sekunden Zeit.
  await expect(statusLabel).toContainText("Backend: online", { timeout: 30000 });

  // 5. (Optional) Zusätzliche Prüfungen, um den 'ready'-Zustand zu verifizieren:
  // - Prüfen, ob der Senden-Button im Chat-Fenster aktiviert ist.
  const sendButton = window.locator('button:has-text("Senden")');
  await expect(sendButton).toBeEnabled();

  // - Prüfen, ob keine kritischen Fehlermeldungen im UI sichtbar sind.
  await expect(window.locator('[role="alert"]')).not.toBeVisible();

  // 6. Schließe die Anwendung, um den Test sauber zu beenden.
  await electronApp.close();
});
