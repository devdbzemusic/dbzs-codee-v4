# Vorgeschlagene Root-Scripts

Manuell in die Root-`package.json` einfügen:

```json
{
  "scripts": {
    "test:ui-refactor": "node tools/ui-refactor-qa/scripts/run-all.mjs",
    "test:ui-refactor:baseline": "cross-env DBZS_UI_QA_PHASE=baseline node tools/ui-refactor-qa/scripts/run-all.mjs",
    "test:ui-refactor:migration": "cross-env DBZS_UI_QA_PHASE=migration node tools/ui-refactor-qa/scripts/run-all.mjs",
    "test:ui-refactor:final": "cross-env DBZS_UI_QA_PHASE=final node tools/ui-refactor-qa/scripts/run-all.mjs",
    "test:ui-refactor:e2e": "pnpm --filter @dbzs/desktop e2e e2e/ui-refactor"
  }
}
```

`cross-env` ist optional. Unter PowerShell kann die Phase direkt gesetzt werden:

```powershell
$env:DBZS_UI_QA_PHASE="migration"
node tools/ui-refactor-qa/scripts/run-all.mjs
```
