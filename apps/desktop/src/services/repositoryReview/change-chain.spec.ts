// e2e/change-chain.spec.ts
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs/promises';

// Pfade zum Test-Workspace und zur zu ändernden Datei
const TEST_FIXTURE_DIR = path.resolve(__dirname, '../test-fixtures/change-chain-project');
const CLEAN_FIXTURE_SOURCE = path.resolve(__dirname, '../test-fixtures/clean-change-chain-project-source');
const TARGET_FILE_PATH = 'src/example.ts';
const ORIGINAL_FILE_CONTENT = 'export function add(a: number, b: number): number {\n  return a + b;\n}'; // Der erwartete Inhalt vor der Änderung und nach dem Rollback

test.beforeAll(async () => {
  // Sicherstellen, dass der Test-Workspace vor allen Tests in einem sauberen Zustand ist.
  // Dies beinhaltet das Kopieren einer sauberen Version des Fixtures.
  await fs.rm(TEST_FIXTURE_DIR, { recursive: true, force: true }).catch(() => {}); // Sicherstellen, dass der Ordner leer ist
  await fs.cp(CLEAN_FIXTURE_SOURCE, TEST_FIXTURE_DIR, { recursive: true });
});

test.afterEach(async () => {
  // Nach jedem Test den Workspace wieder in den sauberen Zustand versetzen.
  await fs.rm(TEST_FIXTURE_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.cp(CLEAN_FIXTURE_SOURCE, TEST_FIXTURE_DIR, { recursive: true });
});

test('End-to-End Änderungskette mit Testfehler und Rollback', async ({ page }) => {
  // 1. Setup: Anwendung starten und Workspace öffnen
  await page.goto('http://localhost:3000'); // Passe die URL bei Bedarf an

  // Workspace-Selektor finden und klicken
  await page.locator('[data-test-id="workspace-selector"]').click();
  // Pfad eingeben und Workspace öffnen
  await page.locator('[data-test-id="workspace-path-input"]').fill(TEST_FIXTURE_DIR);
  await page.locator('[data-test-id="open-workspace-button"]').click();

  // Warten, bis der Workspace geladen und das Modell verbunden ist
  await expect(page.locator('[data-test-id="workspace-name"]')).toHaveText('change-chain-project');
  await expect(page.locator('[data-test-id="model-status"]')).toHaveText(/Verbunden/);

  // 2. Review initiieren & Änderungsvorschlag erhalten
  // Die Nachricht sollte den Agenten dazu bringen, eine Änderung vorzuschlagen, die Tests fehlschlagen lässt.
  await page.locator('[data-test-id="chat-input"]').fill(`Review ${TARGET_FILE_PATH} and propose a change that causes tests to fail.`);
  await page.locator('[data-test-id="chat-send-button"]').click();

  // Warten, bis der Agent einen Änderungsvorschlag macht (kann etwas dauern)
  await expect(page.locator('[data-test-id="chat-message-action-show-diff"]')).toBeVisible({ timeout: 60000 });

  // 3. Diff-Anzeige & Freigabe
  await page.locator('[data-test-id="chat-message-action-show-diff"]').click();
  await expect(page.locator('[data-test-id="patch-preview-diff-viewer"]')).toBeVisible();
  await expect(page.locator('[data-test-id="patch-preview-apply-button"]')).toBeVisible();
  await expect(page.locator('[data-test-id="patch-preview-cancel-button"]')).toBeVisible();

  await page.locator('[data-test-id="patch-preview-apply-button"]').click();

  // 4. Änderung anwenden & Testausführung (Fehler simulieren)
  // Der Status "Tests laufen..." sollte angezeigt werden
  await expect(page.locator('[data-test-id="patch-status-validating"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-test-id="patch-status-validating"]')).toHaveText(/Tests laufen.../);

  // Warten, bis die Validierung abgeschlossen ist und fehlschlägt
  await expect(page.locator('[data-test-id="patch-status-failed"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-test-id="patch-status-failed"]')).toHaveText(/Validierung fehlgeschlagen./);

  // Überprüfen, ob die stderr-Ausgabe des fehlgeschlagenen Tests sichtbar ist
  await expect(page.locator('[data-test-id="patch-validation-stderr"]')).toBeVisible();
  // Passe den Text an die tatsächliche Fehlermeldung deines Test-Fixtures an
  await expect(page.locator('[data-test-id="patch-validation-stderr"]')).toContainText(/Expected test failure/);

  // Überprüfen, ob der Rollback-Button sichtbar ist
  await expect(page.locator('[data-test-id="patch-rollback-button"]')).toBeVisible();

  // 5. Rollback auslösen
  await page.locator('[data-test-id="patch-rollback-button"]').click();

  // Warten, bis der Rollback abgeschlossen ist
  await expect(page.locator('[data-test-id="patch-status-rolled-back"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-test-id="patch-status-rolled-back"]')).toHaveText(/Änderungen wurden erfolgreich zurückgesetzt./);

  // 6. Verifikation: Dateiinhalt prüfen
  // Den Inhalt der Datei direkt vom Dateisystem lesen, um den Rollback zu bestätigen
  const currentFileContent = await fs.readFile(path.join(TEST_FIXTURE_DIR, TARGET_FILE_PATH), 'utf8');
  expect(currentFileContent).toBe(ORIGINAL_FILE_CONTENT);
});
