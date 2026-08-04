# DBZS Codee UI Refactor QA

Automatisiertes Testprojekt für das vollständige Neural-Workbench-UI-Refactoring von **DBZS Codee V4**.

**Abgeglichen mit:** `devdbzemusic/dbzs-codee-v4`  
**Baseline:** `main @ a3cb7bed8e075c0ef7f006bf1d4fa65852b36a17`

## Zweck

Das Projekt prüft den Refactoring-Plan in vier Ebenen:

1. **Repository- und Architekturregeln**
2. **UI-Contract- und Quarantäne-Regeln**
3. **Playwright-E2E- und visuelle Tests**
4. **Qualitätsgates und maschinenlesbarer Bericht**

Es ist so aufgebaut, dass es in das Codee-V4-Repository kopiert werden kann, ohne Backend-, Electron-, Store- oder Runtime-Verträge zu verändern.

## Installation in Codee V4

Den Ordner nach folgendem Ziel kopieren:

```text
dbzs-codee-v4/tools/ui-refactor-qa/
```

Danach im Repository-Root:

```powershell
pnpm install
node tools/ui-refactor-qa/scripts/install-into-repo.mjs
```

Der Installer ergänzt keine Dependencies automatisch. Er legt nur die E2E-Spezifikationen und npm-Script-Vorschläge ab.

## Schnellstart

```powershell
node tools/ui-refactor-qa/scripts/run-all.mjs
```

Optional mit UI-Referenzordner:

```powershell
$env:DBZS_UI_REFERENCE_ROOT="C:\Users\ralle\source\ui-reference\dbzs-codee-chat-app-ui-ux"
node tools/ui-refactor-qa/scripts/run-all.mjs
```

## Einzelprüfungen

```powershell
node tools/ui-refactor-qa/scripts/check-repository-baseline.mjs
node tools/ui-refactor-qa/scripts/check-ui-reference-quarantine.mjs
node tools/ui-refactor-qa/scripts/check-neural-shell-contract.mjs
node tools/ui-refactor-qa/scripts/check-css-contract.mjs
node tools/ui-refactor-qa/scripts/check-changed-ui-files.mjs
```

Playwright:

```powershell
pnpm --filter @dbzs/desktop e2e e2e/ui-refactor
```

## Modi

### Baseline

Prüft den bestehenden Stand, ohne Neural-Shell vorauszusetzen:

```powershell
$env:DBZS_UI_QA_PHASE="baseline"
```

### Migration

Prüft Shell, Navigation, Layout, Statussemantik und Feature Flag:

```powershell
$env:DBZS_UI_QA_PHASE="migration"
```

### Final

Prüft die vollständige Neural Workbench:

```powershell
$env:DBZS_UI_QA_PHASE="final"
```

## Berichte

Ergebnisse werden geschrieben nach:

```text
artifacts/ui-refactor-qa/
├── summary.json
├── summary.md
├── screenshots/
├── playwright-report/
└── logs/
```

## Wichtige Testphilosophie

- Ein Timeout darf niemals als Erfolg erscheinen.
- Mockdaten aus der UI-Vorbereitung dürfen nicht produktiv eingebunden werden.
- `/manus-storage/`-Pfade sind verboten.
- Demo-Backend, tRPC, Drizzle, MySQL, Express, S3 und Manus-Runtime sind verboten.
- Neue UI-Dateien dürfen keine neuen Lint-Fehler erzeugen.
- Die Classic Shell bleibt testbar, bis die Neural Shell vollständig abgenommen ist.
