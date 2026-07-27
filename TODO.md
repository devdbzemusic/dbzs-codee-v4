# TODO

Stand: 2026-07-25

## Nächster Fix

- [ ] Repository-Review-Startpfad prüfen:
      `apps/desktop/src/stores/runtimeChatStore.ts` darf bei
      `scope === "full_repository"` kein `selectedPaths` aus `activeFile`
      mitschicken.
- [ ] Batch-Planer härten:
      `apps/desktop/src/services/repositoryReview/reviewBatchPlanner.ts`
      soll `selectedPaths` nur für `active_file` und `selected_paths`
      als Filter verwenden.
- [ ] Regressionstest ergänzen:
      `full_repository` mit versehentlich gesetzten `selectedPaths`
      muss weiterhin mindestens einen Batch erzeugen.

## Verifikation nach Fix

- [ ] `apps/desktop/src/services/repositoryReview/repositoryReview.test.ts`
      erweitern und lokal grün ausführen.
- [ ] Zielgerichteter Vitest-Lauf für Repository Review starten.
- [ ] Review im Fixture
      `test-fixtures/coding-capability-project`
      erneut ausführen.
- [ ] Erwartung prüfen:
      `review-plan.json` enthält Batches,
      `REVIEW_REPORT.md` und `findings.json` werden erzeugt.

## Optional danach

- [ ] Fehlerklassifikation verbessern:
      leerer Plan sollte als eigener Diagnosefall erkennbar sein,
      nicht nur als generisches `failed`.
- [ ] Diagnose-Export ergänzen:
      bei `batches: []` Ursache im Run-Protokoll explizit notieren.
