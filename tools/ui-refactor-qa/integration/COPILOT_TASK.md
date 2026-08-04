# Copilot-Auftrag: UI Refactor QA integrieren

1. Kopiere `tools/ui-refactor-qa` unverändert in das Repository.
2. Führe `node tools/ui-refactor-qa/scripts/install-into-repo.mjs` aus.
3. Ergänze die vorgeschlagenen Scripts manuell.
4. Verändere keine produktive Store-, IPC- oder Backend-API.
5. Ergänze bei neuen Neural-Workbench-Komponenten die dokumentierten `data-testid`-Attribute.
6. Starte mit Phase `baseline`.
7. Nach Shell Foundation auf `migration` umstellen.
8. Erst nach vollständiger Migration `final` ausführen.

Qualitätsgates:

```powershell
pnpm typecheck
pnpm --filter @dbzs/desktop test
pnpm lint
$env:DBZS_UI_QA_PHASE="migration"
node tools/ui-refactor-qa/scripts/run-all.mjs
pnpm --filter @dbzs/desktop e2e e2e/ui-refactor
```
